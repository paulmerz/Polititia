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
        self.speech_rows: list[tuple[int, str, str, list[str]]] = []

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
            self.speech_rows.append((pid, identity.party_at_speech, month, tokens))
        self.db.executemany("INSERT INTO politicians VALUES (?, ?, ?, ?, ?)", politicians)
        self.db.executemany("INSERT INTO speeches VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", speeches)

    def add_ngrams(self) -> dict[int, int]:
        """One pass per n-gram size keeps memory bounded on the full corpus."""
        next_gid = 1
        corpus_totals: dict[int, int] = {}
        for size in NGRAM_SIZES:
            counts: Counter[str] = Counter()
            for _pid, _party, _month, tokens in self.speech_rows:
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
            everyone: Counter[tuple[int, str]] = Counter()
            person_totals: Counter[tuple[int, str]] = Counter()
            party_totals: Counter[tuple[str, str]] = Counter()
            global_totals: Counter[str] = Counter()
            for pid, party_code, month, tokens in self.speech_rows:
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
            self.db.executemany(
                "INSERT INTO person_ngram_month VALUES (?, ?, ?, ?, ?)",
                ((pid, size, month, gid, count) for (pid, month, gid), count in person.items()),
            )
            self.db.executemany(
                "INSERT INTO party_ngram_month VALUES (?, ?, ?, ?, ?)",
                ((code, size, month, gid, count) for (code, month, gid), count in party.items()),
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
        """Announced stances checked against the speaker's next key vote on the same bill."""
        rows = self.db.execute(
            """
            WITH announced AS (
              SELECT DISTINCT s.sid, s.pid, s.date, st.stance,
                     (SELECT ta.dossier_title FROM theme_attributions ta
                      WHERE ta.sid = s.sid AND ta.dossier_title != '' LIMIT 1) AS dossier
              FROM stances st JOIN speeches s ON s.sid = st.sid
            )
            SELECT a.stance, (
              SELECT vp.position FROM votes v JOIN vote_positions vp ON vp.vid = v.vid AND vp.pid = a.pid
              WHERE v.dossier_title = a.dossier AND v.is_key = 1 AND v.vote_type != 'MOC' AND v.date >= a.date
              ORDER BY v.date LIMIT 1
            ) AS position
            FROM announced a WHERE a.dossier IS NOT NULL
            """
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
) -> dict[str, int]:
    from analyze_votes import vote_theme_matcher

    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".tmp")
    tmp.unlink(missing_ok=True)
    db = sqlite3.connect(tmp)
    db.executescript("PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;" + SCHEMA)
    builder = Builder(db, min_ngram_count)
    builder.add_speeches(raw_speeches, resolver)
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
    )
    print(
        f"Wrote {args.out}: {counts['politicians']} politicians, {counts['speeches']} speeches, "
        f"{counts['votes']} votes"
    )


if __name__ == "__main__":
    main()
