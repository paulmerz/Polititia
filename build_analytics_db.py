"""Build the SQLite database the server queries for any period.

Everything a visitor can filter by date lives here, aggregated by month:

- ``politicians`` and ``speeches`` (with the group on the day of the speech);
- n-gram counts per politician, per group and for the whole Assembly, so the
  server can rank "their words" and compute Dirichlet log-odds for the chosen
  months (``server/src/lexical.ts``);
- theme attributions with their excerpt (``analyze_themes.py``);
- public votes and positions (``--votes``), stances (``analyze_stances.py``).

N-grams said fewer than ``--min-ngram-count`` times in the whole corpus are
dropped: they can never be distinctive, and they would triple the size.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

from analyze_project_ngrams import surface_content_tokens
from asides import STYLE_FIELDS, find_mentions, mention_index, other_camps, split_name, style_counts
from lexical_stats import DEFAULT_ALPHA0
from ngram_distribution import ngrams
from reference_data import DEFAULT_OPEN_DATA_DIR, ReferenceData
from speakers import SpeakerResolver


DEFAULT_SPEECHES = Path("extracted_texts/project_full/speeches.jsonl")
DEFAULT_SPEAKER_DIR = Path("extracted_texts/project_full/by_speaker")
DEFAULT_ATTRIBUTIONS = Path("analysis_outputs/themes/attributions.jsonl")
DEFAULT_STANCES = Path("analysis_outputs/stances/stances.jsonl")
DEFAULT_LEXICON = Path("themes/lexicon.json")
DEFAULT_OUTPUT = Path("analysis_outputs/analytics.sqlite")
NGRAM_SIZES = (1, 2, 3, 4)
MIN_NGRAM_COUNT = 5
LEGISLATURE_START = "2024-07-18"
# The agenda titles a debate on two bills "Bill A – Bill B".
JOINT_DEBATE_SEPARATOR = "\u2013"

SCHEMA = (Path(__file__).resolve().parent / "analytics_schema.sql").read_text(encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--speeches", type=Path, default=DEFAULT_SPEECHES)
    parser.add_argument("--speaker-dir", type=Path, default=DEFAULT_SPEAKER_DIR)
    parser.add_argument("--attributions", type=Path, default=DEFAULT_ATTRIBUTIONS)
    parser.add_argument("--stances", type=Path, default=DEFAULT_STANCES)
    parser.add_argument("--open-data", type=Path, default=DEFAULT_OPEN_DATA_DIR)
    parser.add_argument("--lexicon", type=Path, default=DEFAULT_LEXICON)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--min-ngram-count", type=int, default=MIN_NGRAM_COUNT)
    return parser.parse_args()


def load_jsonl(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def sessions(first_day: str, last_day: str) -> list[dict[str, str]]:
    """Parliamentary years (1 October to 30 September) covered by the corpus."""

    def year_of(day: str) -> int:
        return int(day[:4]) - (1 if day[5:7] < "10" else 0)

    # The summer 2024 sittings opened the legislature: count them in 2024-2025.
    first_year = max(year_of(first_day), int(LEGISLATURE_START[:4]))
    last_year = max(year_of(last_day), first_year)
    rows = []
    for year in range(first_year, last_year + 1):
        start = min(f"{year}-10-01", max(first_day, LEGISLATURE_START)) if year == first_year else f"{year}-10-01"
        rows.append({"id": f"session-{year}", "label": f"Session {year}-{year + 1}", "from": start, "to": f"{year + 1}-09-30"})
    return rows


class Builder:
    def __init__(self, db: sqlite3.Connection, min_ngram_count: int = MIN_NGRAM_COUNT) -> None:
        self.db = db
        self.min_ngram_count = min_ngram_count
        self.pids: dict[str, int] = {}
        self.sids: dict[str, int] = {}
        # (pid, party, month, sitting, content tokens)
        self.speech_rows: list[tuple[int, str, str, str, list[str]]] = []
        self.person_style: dict[tuple[int, str], Counter[str]] = defaultdict(Counter)
        self.party_style: dict[tuple[str, str], Counter[str]] = defaultdict(Counter)
        self.global_style: dict[str, Counter[str]] = defaultdict(Counter)

    def add_speeches(self, raw_speeches: list[dict], resolver: SpeakerResolver) -> None:
        politicians: list[tuple] = []
        speeches: list[tuple] = []
        for raw in raw_speeches:
            identity = resolver.resolve(raw)
            if identity is None or not raw.get("date"):
                continue
            pid = self.pids.get(identity.politician_id)
            if pid is None:
                pid = self.pids[identity.politician_id] = len(self.pids) + 1
                politicians.append((pid, identity.politician_id, identity.name, identity.party, identity.acteur_id))
            sid = self.sids[raw["speech_id"]] = len(self.sids) + 1
            tokens = surface_content_tokens(raw.get("normalized_text") or "")
            month = raw["date"][:7]
            speeches.append((
                sid, raw["speech_id"], pid, identity.party_at_speech, raw["date"], month,
                raw.get("session_uid", ""), raw.get("debate_topic") or raw.get("point_title", ""),
                raw.get("section_code", ""), raw.get("bill_number", ""),
                len((raw.get("normalized_text") or "").split()), len(tokens),
            ))
            self.speech_rows.append((pid, identity.party_at_speech, month, raw.get("session_uid") or raw["date"], tokens))
            self._add_style(pid, identity.party_at_speech, month, raw.get("text") or "")
        self.db.executemany("INSERT INTO politicians VALUES (?, ?, ?, ?, ?)", politicians)
        self.db.executemany("INSERT INTO speeches VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", speeches)
        self._flush_style()

    def _add_style(self, pid: int, party: str, month: str, text: str) -> None:
        counts = style_counts(text)
        if counts["words"] <= 0:
            return
        for bucket, key in (
            (self.person_style, (pid, month)),
            (self.party_style, (party, month)),
            (self.global_style, month),
        ):
            current = bucket[key]
            for field in STYLE_FIELDS:
                current[field] += counts[field]

    def _flush_style(self) -> None:
        def values(counts: Counter[str]) -> tuple[int, ...]:
            return tuple(int(counts[field]) for field in STYLE_FIELDS)

        self.db.executemany(
            "INSERT INTO person_style_month VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            ((*key, *values(counts)) for key, counts in self.person_style.items()),
        )
        self.db.executemany(
            "INSERT INTO party_style_month VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            ((*key, *values(counts)) for key, counts in self.party_style.items()),
        )
        self.db.executemany(
            "INSERT INTO global_style_month VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            ((month, *values(counts)) for month, counts in self.global_style.items()),
        )

    def _ensure_politician(self, identity) -> int:
        pid = self.pids.get(identity.politician_id)
        if pid is not None:
            return pid
        pid = self.pids[identity.politician_id] = len(self.pids) + 1
        self.db.execute(
            "INSERT INTO politicians VALUES (?, ?, ?, ?, ?)",
            (pid, identity.politician_id, identity.name, identity.party, identity.acteur_id),
        )
        return pid

    def add_asides(self, rows: list[dict], resolver: SpeakerResolver) -> None:
        interruptions: list[tuple] = []
        reactions: list[tuple] = []
        for row in rows:
            if not row.get("date"):
                continue
            identity = resolver.resolve(row)
            pid = self._ensure_politician(identity) if identity is not None else None
            party = identity.party_at_speech if identity is not None else ""
            if row.get("record") == "interruption":
                interruptions.append((
                    len(interruptions) + 1, pid, party, row["date"], row.get("session_uid") or "",
                    row.get("debate_topic") or "", row.get("quote") or "", row.get("norm") or "",
                    int(row.get("words") or 0), int(row.get("keep") or 0),
                ))
            elif row.get("record") == "reaction" and pid is not None:
                groups = list(row.get("groups") or [])
                camps = other_camps(groups, bool(row.get("every_bench")), bool(row.get("unnamed_benches")), party)
                reactions.append((
                    len(reactions) + 1, pid, party, row["date"], row.get("session_uid") or "",
                    row.get("debate_topic") or "", row.get("kind") or "", row.get("quote") or "",
                    row.get("norm") or "", row.get("detail") or "", ",".join(groups), camps,
                ))
        self.db.executemany("INSERT INTO interruptions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", interruptions)
        self.db.executemany("INSERT INTO reactions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", reactions)

    def add_mentions(self, raw_speeches: list[dict], resolver: SpeakerResolver) -> None:
        # With the AMO reference, only actual people can be named, once each: a
        # speaker the report left without an id (« M Michel Barnier », « Les
        # députés du groupe ») would make the real name ambiguous.
        with_reference = bool(resolver.reference and resolver.reference.actors)
        people = []
        seen_actors: set[str] = set()
        for pid, name, acteur_id in self.db.execute("SELECT pid, name, acteur_id FROM politicians ORDER BY pid"):
            actor = resolver.reference.actor(acteur_id) if with_reference and acteur_id else None
            if actor is not None and actor.last_name and acteur_id not in seen_actors:
                seen_actors.add(acteur_id)
                people.append((pid, actor.civility, actor.first_name, actor.last_name))
            elif not with_reference:
                people.append((pid, *split_name(name)))
        index = mention_index(people)
        if not index.by_civility and not index.by_full_name:
            return
        rows = []
        for raw in raw_speeches:
            identity = resolver.resolve(raw)
            if identity is None or not raw.get("date"):
                continue
            pid = self.pids.get(identity.politician_id)
            if pid is None:
                continue
            for target, quote in find_mentions(raw.get("text") or "", index, pid):
                rows.append((pid, target, raw["date"], raw.get("session_uid") or "", quote))
        self.db.executemany("INSERT INTO mentions VALUES (?, ?, ?, ?, ?)", rows)

    def add_ngrams(self) -> dict[int, int]:
        """One pass per n-gram size keeps memory bounded on the full corpus."""
        next_gid = 1
        corpus_totals: dict[int, int] = {}
        for size in NGRAM_SIZES:
            counts: Counter[str] = Counter()
            for _pid, _party, _month, _sitting, tokens in self.speech_rows:
                counts.update(ngrams(tokens, size))
            corpus_totals[size] = sum(counts.values())
            kept: dict[str, int] = {}
            rows = []
            for text, total in counts.items():
                if total >= self.min_ngram_count:
                    kept[text] = next_gid
                    rows.append((next_gid, size, text, total))
                    next_gid += 1
            del counts
            self.db.executemany("INSERT INTO ngrams VALUES (?, ?, ?, ?)", rows)

            person: Counter[tuple[int, str, int]] = Counter()
            party: Counter[tuple[str, str, int]] = Counter()
            person_sittings: Counter[tuple[int, str, int]] = Counter()
            party_sittings: Counter[tuple[str, str, int]] = Counter()
            everyone: Counter[tuple[int, str]] = Counter()
            person_totals: Counter[tuple[int, str]] = Counter()
            party_totals: Counter[tuple[str, str]] = Counter()
            global_totals: Counter[str] = Counter()
            # Sitting by sitting, so "said in this sitting" needs a small set only.
            current_sitting = None
            seen_person: set[tuple[int, int]] = set()
            seen_party: set[tuple[str, int]] = set()
            for pid, party_code, month, sitting, tokens in sorted(self.speech_rows, key=lambda row: row[3]):
                if sitting != current_sitting:
                    current_sitting = sitting
                    seen_person.clear()
                    seen_party.clear()
                grams = ngrams(tokens, size)
                person_totals[(pid, month)] += len(grams)
                party_totals[(party_code, month)] += len(grams)
                global_totals[month] += len(grams)
                for gram in grams:
                    gid = kept.get(gram)
                    if gid is not None:
                        person[(pid, month, gid)] += 1
                        party[(party_code, month, gid)] += 1
                        everyone[(gid, month)] += 1
                        if (pid, gid) not in seen_person:
                            seen_person.add((pid, gid))
                            person_sittings[(pid, month, gid)] += 1
                        if (party_code, gid) not in seen_party:
                            seen_party.add((party_code, gid))
                            party_sittings[(party_code, month, gid)] += 1
            self.db.executemany(
                "INSERT INTO person_ngram_month VALUES (?, ?, ?, ?, ?, ?)",
                ((pid, size, month, gid, count, person_sittings[(pid, month, gid)]) for (pid, month, gid), count in person.items()),
            )
            self.db.executemany(
                "INSERT INTO party_ngram_month VALUES (?, ?, ?, ?, ?, ?)",
                ((code, size, month, gid, count, party_sittings[(code, month, gid)]) for (code, month, gid), count in party.items()),
            )
            self.db.executemany(
                "INSERT INTO global_ngram_month VALUES (?, ?, ?)",
                ((gid, month, count) for (gid, month), count in everyone.items()),
            )
            self.db.executemany(
                "INSERT INTO person_totals VALUES (?, ?, ?, ?)",
                ((pid, size, month, total) for (pid, month), total in person_totals.items()),
            )
            self.db.executemany(
                "INSERT INTO party_totals VALUES (?, ?, ?, ?)",
                ((code, size, month, total) for (code, month), total in party_totals.items()),
            )
            self.db.executemany(
                "INSERT INTO global_totals VALUES (?, ?, ?)",
                ((size, month, total) for month, total in global_totals.items()),
            )
        return corpus_totals

    def add_themes(self, attributions: list[dict]) -> None:
        rows = []
        for item in attributions:
            sid = self.sids.get(item["speech_id"])
            if sid is None:
                continue
            rows.append((
                sid, item["theme_id"], item.get("domain_id") or "", item["method"], item.get("relevance"),
                json.dumps(item.get("terms") or [], ensure_ascii=False), item.get("excerpt") or "",
                item.get("dossier_title") or "",
            ))
        self.db.executemany("INSERT OR IGNORE INTO theme_attributions VALUES (?, ?, ?, ?, ?, ?, ?, ?)", rows)

    def add_votes(self, reference: ReferenceData, vote_themes) -> int:
        from analyze_votes import dossier_for_vote, is_key_vote

        by_acteur = {
            acteur_id: pid
            for acteur_id, pid in self.db.execute("SELECT acteur_id, pid FROM politicians WHERE acteur_id != ''")
        }
        votes = reference.votes()
        vote_rows, position_rows, theme_rows = [], [], []
        for vid, vote in enumerate(votes, start=1):
            dossier = dossier_for_vote(reference, vote)
            vote_rows.append((
                vid, vote.uid, vote.number, vote.date, vote.title, int(vote.adopted), vote.vote_type,
                int(is_key_vote(vote)), dossier.title if dossier else "", json.dumps(vote.group_majority),
                json.dumps(vote.group_counts),
            ))
            for acteur_id, position in vote.positions.items():
                pid = by_acteur.get(acteur_id)
                actor = reference.actor(acteur_id)
                if pid is None or actor is None:
                    continue
                position_rows.append((vid, pid, actor.party_on(vote.date), position))
            for theme in vote_themes(vote, dossier):
                theme_rows.append((vid, theme))
        self.db.executemany("INSERT INTO votes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", vote_rows)
        self.db.executemany("INSERT OR IGNORE INTO vote_positions VALUES (?, ?, ?, ?)", position_rows)
        self.db.executemany("INSERT OR IGNORE INTO vote_themes VALUES (?, ?)", theme_rows)
        return len(vote_rows)

    def add_stances(self, stances: list[dict]) -> None:
        rows = []
        for item in stances:
            sid = self.sids.get(item["speech_id"])
            if sid is not None:
                rows.append((sid, item["theme_id"], item["stance"], item["confidence"], item["method"], item.get("quote", "")))
        self.db.executemany("INSERT OR IGNORE INTO stances VALUES (?, ?, ?, ?, ?, ?)", rows)

    def stance_vote_agreement(self) -> dict[str, int]:
        """Announced stances checked against the speaker's next key vote on the same bill.

        Joint debates ("Soins palliatifs – Aide à mourir") cover two bills while the
        speech is attributed to one, so "je voterai contre ce texte" may be about the
        other: they are left out rather than compared with the wrong vote.
        """
        rows = self.db.execute(
            """
            WITH announced AS (
              SELECT DISTINCT s.sid, s.pid, s.date, st.stance,
                     (SELECT ta.dossier_title FROM theme_attributions ta
                      WHERE ta.sid = s.sid AND ta.dossier_title != '' LIMIT 1) AS dossier
              FROM stances st JOIN speeches s ON s.sid = st.sid
              WHERE instr(s.debate_title, ?) = 0
            )
            SELECT a.stance, (
              SELECT vp.position FROM votes v JOIN vote_positions vp ON vp.vid = v.vid AND vp.pid = a.pid
              WHERE v.dossier_title = a.dossier AND v.is_key = 1 AND v.vote_type != 'MOC' AND v.date >= a.date
              ORDER BY v.date, v.number LIMIT 1
            ) AS position
            FROM announced a WHERE a.dossier IS NOT NULL
            """,
            (JOINT_DEBATE_SEPARATOR,),
        ).fetchall()
        expected = {"favorable": "pour", "defavorable": "contre", "abstention": "abstention"}
        compared = [(stance, position) for stance, position in rows if position in ("pour", "contre", "abstention")]
        return {
            "compared": len(compared),
            "agreeing": sum(1 for stance, position in compared if expected.get(stance) == position),
        }

    def add_meta(
        self, corpus_totals: dict[int, int], catalog: list[dict] | None = None, stance_check: dict | None = None
    ) -> None:
        first_day, last_day = self.db.execute("SELECT MIN(date), MAX(date) FROM speeches").fetchone()
        months = [row[0] for row in self.db.execute("SELECT DISTINCT month FROM speeches ORDER BY month")]
        meta = {
            "firstDate": first_day or "",
            "lastDate": last_day or "",
            "months": months,
            "sessions": sessions(first_day, last_day) if first_day else [],
            "alpha0": DEFAULT_ALPHA0,
            "corpusTotals": {str(size): total for size, total in corpus_totals.items()},
            "builtOn": date.today().isoformat(),
            "themes": catalog or [],
            "stanceVoteAgreement": stance_check or {"compared": 0, "agreeing": 0},
        }
        self.db.executemany("INSERT INTO meta VALUES (?, ?)", [(key, json.dumps(value)) for key, value in meta.items()])


def theme_catalog(lexicon: Path) -> list[dict]:
    """Domains (the permanent committees) and their themes, in lexicon order."""
    if not lexicon.is_file():
        return []
    payload = json.loads(lexicon.read_text(encoding="utf-8"))
    rows = [
        {"id": item["id"], "label": item["label"], "type": "domain", "parent": None, "committee": item.get("committee", "")}
        for item in payload.get("domains", [])
    ]
    rows += [
        {"id": item["id"], "label": item["label"], "type": "theme", "parent": item.get("parent"), "committee": ""}
        for item in payload.get("themes", [])
    ]
    return rows


def build(
    out: Path,
    raw_speeches: list[dict],
    attributions: list[dict],
    reference: ReferenceData,
    resolver: SpeakerResolver,
    stances: list[dict] | None = None,
    min_ngram_count: int = MIN_NGRAM_COUNT,
    lexicon: Path = DEFAULT_LEXICON,
    asides: list[dict] | None = None,
) -> dict[str, int]:
    from analyze_votes import vote_theme_matcher

    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".tmp")
    tmp.unlink(missing_ok=True)
    db = sqlite3.connect(tmp)
    db.executescript("PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;" + SCHEMA)
    builder = Builder(db, min_ngram_count)
    builder.add_speeches(raw_speeches, resolver)
    builder.add_asides(asides or [], resolver)
    builder.add_mentions(raw_speeches, resolver)
    corpus_totals = builder.add_ngrams()
    builder.add_themes(attributions)
    vote_count = builder.add_votes(reference, vote_theme_matcher())
    builder.add_stances(stances or [])
    builder.add_meta(corpus_totals, theme_catalog(lexicon), builder.stance_vote_agreement())
    db.commit()
    db.execute("ANALYZE")
    db.close()
    tmp.replace(out)
    return {"politicians": len(builder.pids), "speeches": len(builder.sids), "votes": vote_count}


def main() -> None:
    args = parse_args()
    if not args.speeches.is_file():
        raise SystemExit(f"Speech index not found: {args.speeches}")
    reference = ReferenceData(args.open_data)
    counts = build(
        args.out,
        load_jsonl(args.speeches),
        load_jsonl(args.attributions),
        reference,
        SpeakerResolver(reference, args.speaker_dir),
        load_jsonl(args.stances),
        args.min_ngram_count,
        args.lexicon,
        load_jsonl(args.speeches.with_name("asides.jsonl")),
    )
    print(
        f"Wrote {args.out}: {counts['politicians']} politicians, {counts['speeches']} speeches, "
        f"{counts['votes']} votes"
    )


if __name__ == "__main__":
    main()
