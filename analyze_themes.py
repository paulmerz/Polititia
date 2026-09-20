"""Attribute dated speeches to lexical political themes and detect bursts."""

from __future__ import annotations

import argparse
import json
import math
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

from analyze_project_ngrams import (
    CONTENT_EXCLUDE_TERMS,
    build_party_lookup,
    infer_party_and_name,
    read_speaker_files,
    resolve_party,
    surface_content_tokens,
)
from extract_speeches import normalize_for_ngrams
from ngram_distribution import ngrams


DEFAULT_SPEECHES = Path("extracted_texts/project_full/speeches.jsonl")
DEFAULT_SPEAKER_DIR = Path("extracted_texts/project_full/by_speaker")
DEFAULT_LEXICON = Path("themes/lexicon.json")
DEFAULT_OUTPUT_DIR = Path("analysis_outputs/themes")
EXCERPT_WINDOW = 280
RECENT_WEEKS = 4


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build lexical theme aggregates from dated speeches.")
    parser.add_argument("--speeches", type=Path, default=DEFAULT_SPEECHES)
    parser.add_argument("--speaker-dir", type=Path, default=DEFAULT_SPEAKER_DIR)
    parser.add_argument("--lexicon", type=Path, default=DEFAULT_LEXICON)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--min-burst-count", type=int, default=2)
    parser.add_argument("--min-burst-speakers", type=int, default=2)
    parser.add_argument("--max-emerging", type=int, default=15)
    return parser.parse_args()


def slugify(value: str) -> str:
    simple = unicodedata.normalize("NFKD", value)
    simple = "".join(char for char in simple if not unicodedata.combining(char)).lower()
    simple = re.sub(r"[^a-z0-9]+", "-", simple).strip("-")
    return simple or "unknown"


def politician_id(speaker_name: str, party: str) -> str:
    return f"{slugify(speaker_name)}--{slugify(party)}"


def parse_iso_date(value: str) -> date | None:
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return None


def iso_week_key(value: date) -> str:
    iso = value.isocalendar()
    return f"{iso.year:04d}-W{iso.week:02d}"


def week_start(value: date) -> date:
    return value - timedelta(days=value.weekday())


def load_jsonl(path: Path) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def load_lexicon(path: Path) -> list[dict[str, object]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    themes = payload.get("themes", payload)
    prepared: list[dict[str, object]] = []
    for raw in themes:
        aliases = []
        for alias in raw.get("aliases", []):
            normalized = normalize_for_ngrams(str(alias))
            if normalized:
                aliases.append(normalized)
        prepared.append({
            "id": raw["id"],
            "label": raw["label"],
            "type": raw.get("type", "domain"),
            "parent": raw.get("parent"),
            "aliases": aliases,
        })
    return prepared


def alias_tokens(alias: str) -> list[str]:
    return alias.split()


def contains_alias(tokens: list[str], alias: str) -> bool:
    needle = alias_tokens(alias)
    if not needle or len(needle) > len(tokens):
        return False
    width = len(needle)
    for index in range(len(tokens) - width + 1):
        if tokens[index : index + width] == needle:
            return True
    return False


def speech_tokens(record: dict[str, str]) -> list[str]:
    normalized = record.get("normalized_text") or normalize_for_ngrams(record.get("text", ""))
    return normalized.split()


def match_themes(tokens: list[str], themes: list[dict[str, object]]) -> list[str]:
    hits: list[str] = []
    for theme in themes:
        if any(contains_alias(tokens, str(alias)) for alias in theme["aliases"]):  # type: ignore[index]
            hits.append(str(theme["id"]))
    return hits


def first_alias_in_text(text: str, aliases: list[str]) -> str | None:
    folded = normalize_for_ngrams(text)
    for alias in aliases:
        if alias and alias in folded:
            return alias
    return None


def excerpt_for(text: str, aliases: list[str], window: int = EXCERPT_WINDOW) -> str:
    compact = re.sub(r"\s+", " ", text).strip()
    if not compact:
        return ""
    alias = first_alias_in_text(compact, aliases)
    haystack = compact.casefold()
    start = 0
    if alias:
        needle = alias.casefold()
        found = haystack.find(needle)
        if found < 0:
            found = normalize_for_ngrams(compact).find(alias)
            if found >= 0:
                # Fall back to a prefix window when diacritics differ.
                start = max(0, min(found, max(0, len(compact) - window)))
            else:
                start = 0
        else:
            start = max(0, found - window // 3)
    snippet = compact[start : start + window].strip()
    if start > 0:
        snippet = "…" + snippet
    if start + window < len(compact):
        snippet = snippet + "…"
    return snippet


def known_alias_set(themes: list[dict[str, object]]) -> set[str]:
    aliases: set[str] = set()
    for theme in themes:
        for alias in theme["aliases"]:  # type: ignore[attr-defined]
            aliases.add(str(alias))
    return aliases


def emerging_candidates(
    speeches: list[dict[str, object]],
    known_aliases: set[str],
    min_count: int,
    min_speakers: int,
    max_emerging: int,
    recent_weeks: int = RECENT_WEEKS,
) -> list[dict[str, object]]:
    dated = [row for row in speeches if row.get("parsed_date")]
    if not dated:
        return []

    max_date = max(row["parsed_date"] for row in dated)  # type: ignore[arg-type]
    recent_start = week_start(max_date) - timedelta(weeks=recent_weeks - 1)  # type: ignore[arg-type]
    recent_counts: Counter[str] = Counter()
    baseline_counts: Counter[str] = Counter()
    recent_speakers: dict[str, set[str]] = defaultdict(set)

    for row in dated:
        tokens = [token for token in surface_content_tokens(row["normalized_text"])]  # type: ignore[arg-type]
        grams = ngrams(tokens, 2)
        bucket = recent_counts if row["parsed_date"] >= recent_start else baseline_counts
        speaker = str(row["speaker_slug"])
        seen: set[str] = set()
        for gram in grams:
            bucket[gram] += 1
            if row["parsed_date"] >= recent_start and gram not in seen:
                recent_speakers[gram].add(speaker)
                seen.add(gram)

    scored: list[tuple[float, str, int, int]] = []
    for gram, recent in recent_counts.items():
        if recent < min_count:
            continue
        if gram in known_aliases:
            continue
        if len(recent_speakers[gram]) < min_speakers:
            continue
        baseline = baseline_counts[gram]
        score = ((recent + 1) / (baseline + 1)) * math.log1p(recent)
        scored.append((score, gram, recent, baseline))

    emerging: list[dict[str, object]] = []
    for rank, (score, gram, recent, baseline) in enumerate(
        sorted(scored, reverse=True)[:max_emerging],
        start=1,
    ):
        emerging.append({
            "id": f"signal-{slugify(gram)}",
            "label": gram,
            "type": "emerging",
            "parent": None,
            "aliases": [gram],
            "burstScore": score,
            "rank": rank,
            "recentCount": recent,
            "baselineCount": baseline,
        })
    return emerging


def trend_label(dates: list[date], max_date: date | None) -> str:
    if not dates or max_date is None:
        return "stable"
    recent_start = week_start(max_date) - timedelta(weeks=RECENT_WEEKS - 1)
    previous_start = recent_start - timedelta(weeks=RECENT_WEEKS)
    recent = sum(1 for item in dates if item >= recent_start)
    previous = sum(1 for item in dates if previous_start <= item < recent_start)
    if previous == 0 and recent > 0:
        return "new"
    if recent > previous * 1.2:
        return "rising"
    if recent < previous * 0.8:
        return "falling"
    return "stable"


def build_bundle(
    speeches: list[dict[str, str]],
    lexicon_themes: list[dict[str, object]],
    speaker_dir: Path,
    min_burst_count: int,
    min_burst_speakers: int,
    max_emerging: int,
) -> dict[str, object]:
    speaker_files = read_speaker_files(speaker_dir) if speaker_dir.is_dir() else []
    party_lookup = build_party_lookup(speaker_files) if speaker_files else {}

    enriched: list[dict[str, object]] = []
    party_speech_totals: Counter[str] = Counter()
    politician_speech_totals: Counter[str] = Counter()

    for raw in speeches:
        party, speaker_name, _source = resolve_party(raw["speaker_slug"], party_lookup)
        if party == "UNLABELED":
            inferred_party, inferred_name = infer_party_and_name(raw["speaker_slug"])
            speaker_name = inferred_name
            if inferred_name in party_lookup:
                party = party_lookup[inferred_name]
            else:
                party = inferred_party
        person_id = politician_id(speaker_name, party)
        parsed = parse_iso_date(raw.get("date", ""))
        tokens = speech_tokens(raw)
        row = {
            **raw,
            "party": party,
            "speaker_name": speaker_name,
            "politician_id": person_id,
            "parsed_date": parsed,
            "tokens": tokens,
        }
        enriched.append(row)
        party_speech_totals[party] += 1
        politician_speech_totals[person_id] += 1

    known_aliases = known_alias_set(lexicon_themes)
    emerging = emerging_candidates(
        enriched,
        known_aliases,
        min_burst_count,
        min_burst_speakers,
        max_emerging,
    )
    all_themes = [*lexicon_themes, *emerging]
    theme_by_id = {str(theme["id"]): theme for theme in all_themes}

    attributions: list[tuple[dict[str, object], str]] = []
    for row in enriched:
        for theme_id in match_themes(row["tokens"], all_themes):  # type: ignore[arg-type]
            attributions.append((row, theme_id))

    dates_by_theme: dict[str, list[date]] = defaultdict(list)
    party_theme_counts: dict[str, Counter[str]] = defaultdict(Counter)
    politician_theme_counts: dict[str, Counter[str]] = defaultdict(Counter)
    politician_theme_dates: dict[str, dict[str, list[date]]] = defaultdict(lambda: defaultdict(list))
    week_theme_party: dict[str, dict[str, Counter[str]]] = defaultdict(lambda: defaultdict(Counter))
    week_theme_total: dict[str, Counter[str]] = defaultdict(Counter)
    excerpts_pool: dict[str, list[dict[str, object]]] = defaultdict(list)
    politician_excerpts_pool: dict[str, dict[str, list[dict[str, object]]]] = defaultdict(
        lambda: defaultdict(list)
    )

    for row, theme_id in attributions:
        theme = theme_by_id[theme_id]
        party = str(row["party"])
        person_id = str(row["politician_id"])
        parsed = row["parsed_date"]
        party_theme_counts[theme_id][party] += 1
        politician_theme_counts[person_id][theme_id] += 1
        if isinstance(parsed, date):
            dates_by_theme[theme_id].append(parsed)
            politician_theme_dates[person_id][theme_id].append(parsed)
            week = iso_week_key(parsed)
            week_theme_party[theme_id][week][party] += 1
            week_theme_total[theme_id][week] += 1

        snippet = excerpt_for(str(row.get("text") or ""), list(theme["aliases"]))  # type: ignore[arg-type]
        excerpt = {
            "speechId": row["speech_id"],
            "politicianId": person_id,
            "speaker": row["speaker_name"],
            "party": party,
            "date": row.get("date") or "",
            "snippet": snippet,
        }
        excerpts_pool[theme_id].append(excerpt)
        if len(politician_excerpts_pool[person_id][theme_id]) < 2:
            politician_excerpts_pool[person_id][theme_id].append(excerpt)

    corpus_total = len(enriched)
    max_date = max((row["parsed_date"] for row in enriched if row["parsed_date"]), default=None)

    catalog: list[dict[str, object]] = []
    ownership: dict[str, list[dict[str, object]]] = {}
    series: dict[str, dict[str, list[dict[str, object]]]] = {}
    excerpts: dict[str, list[dict[str, object]]] = {}

    for theme in all_themes:
        theme_id = str(theme["id"])
        dates = sorted(dates_by_theme.get(theme_id, []))
        theme_total = sum(party_theme_counts[theme_id].values())
        politicians = [
            person_id
            for person_id, counts in politician_theme_counts.items()
            if counts.get(theme_id)
        ]
        opener_party = ""
        if dates:
            first_date = dates[0]
            for row, attributed in attributions:
                if attributed == theme_id and row["parsed_date"] == first_date:
                    opener_party = str(row["party"])
                    break

        catalog.append({
            "id": theme_id,
            "label": theme["label"],
            "type": theme["type"],
            "parent": theme.get("parent"),
            "aliases": theme["aliases"],
            "firstDate": dates[0].isoformat() if dates else "",
            "trend": trend_label(dates, max_date if isinstance(max_date, date) else None),
            "speechCount": theme_total,
            "politicianCount": len(politicians),
            "openerParty": opener_party,
            "burstScore": theme.get("burstScore"),
        })

        ownership_rows: list[dict[str, object]] = []
        for party, count in party_theme_counts[theme_id].items():
            party_total = party_speech_totals[party]
            theme_share = count / theme_total if theme_total else 0
            corpus_share = party_total / corpus_total if corpus_total else 0
            lift = theme_share / corpus_share if corpus_share else 0
            ownership_rows.append({
                "party": party,
                "speechCount": count,
                "lift": lift,
            })
        ownership_rows.sort(key=lambda item: (-float(item["lift"]), str(item["party"])))
        ownership[theme_id] = ownership_rows

        party_series: dict[str, list[dict[str, object]]] = defaultdict(list)
        for week in sorted(week_theme_total[theme_id]):
            week_total = week_theme_total[theme_id][week]
            for party, count in sorted(week_theme_party[theme_id][week].items()):
                party_series[party].append({
                    "week": week,
                    "speechCount": count,
                    "share": count / week_total if week_total else 0,
                })
        series[theme_id] = dict(party_series)

        selected: list[dict[str, object]] = []
        seen_parties: set[str] = set()
        for excerpt in excerpts_pool[theme_id]:
            party = str(excerpt["party"])
            if party in seen_parties and len(selected) >= 3:
                continue
            if party not in seen_parties or len(selected) < 3:
                selected.append(excerpt)
                seen_parties.add(party)
            if len(selected) >= 3 and len(seen_parties) >= 2:
                break
        excerpts[theme_id] = selected[:3]

    politician_scores: dict[str, dict[str, dict[str, object]]] = {}
    for person_id, counts in politician_theme_counts.items():
        total = politician_speech_totals[person_id]
        politician_scores[person_id] = {}
        for theme_id, count in counts.items():
            dates = sorted(politician_theme_dates[person_id][theme_id])
            politician_scores[person_id][theme_id] = {
                "speechCount": count,
                "share": count / total if total else 0,
                "firstDate": dates[0].isoformat() if dates else "",
                "lastDate": dates[-1].isoformat() if dates else "",
            }

    return {
        "themes": catalog,
        "politicianThemeScores": politician_scores,
        "partyThemeSeries": series,
        "themeOwnership": ownership,
        "themeExcerpts": excerpts,
        "politicianThemeExcerpts": {
            person_id: dict(theme_map)
            for person_id, theme_map in politician_excerpts_pool.items()
        },
        "summary": {
            "speechCount": corpus_total,
            "themeCount": len(catalog),
            "domainCount": sum(1 for theme in catalog if theme["type"] == "domain"),
            "emergingCount": sum(1 for theme in catalog if theme["type"] == "emerging"),
            "attributionCount": len(attributions),
        },
    }


def write_bundle(bundle: dict[str, object], out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "themes_bundle.json"
    path.write_text(json.dumps(bundle, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (out_dir / "summary.json").write_text(
        json.dumps(bundle["summary"], ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return path


def main() -> None:
    args = parse_args()
    if not args.speeches.is_file():
        raise SystemExit(f"Speech index not found: {args.speeches}")
    if not args.lexicon.is_file():
        raise SystemExit(f"Lexicon not found: {args.lexicon}")

    speeches = load_jsonl(args.speeches)
    lexicon = load_lexicon(args.lexicon)
    bundle = build_bundle(
        speeches,
        lexicon,
        args.speaker_dir,
        args.min_burst_count,
        args.min_burst_speakers,
        args.max_emerging,
    )
    path = write_bundle(bundle, args.out_dir)
    summary = bundle["summary"]
    print(
        f"Wrote {summary['themeCount']} themes "
        f"({summary['domainCount']} domains, {summary['emergingCount']} signals) "
        f"from {summary['speechCount']} speeches to {path}"
    )


if __name__ == "__main__":
    main()
