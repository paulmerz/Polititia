#!/usr/bin/env python3
"""Fit lexical topics with TF-IDF + NMF and export party / monthly shares."""

from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from analyze_project_ngrams import (  # noqa: E402
    build_party_lookup,
    resolve_party,
    surface_content_tokens,
)
from extract_speeches import normalize_for_ngrams  # noqa: E402
from scripts.index_session_dates import index_session_dates, normalize_session_date  # noqa: E402


DEFAULT_SPEECH_DIR = Path("extracted_texts/project_full")
DEFAULT_XML_DIR = Path("data/raw/xml/compteRendu")
DEFAULT_OUT_DIR = Path("analysis_outputs/plain_project_content_stable")
DEFAULT_TOPIC_COUNT = 15
MIN_CONTENT_TOKENS = 20


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fit NMF topics on individual speeches.")
    parser.add_argument("--speech-dir", type=Path, default=DEFAULT_SPEECH_DIR)
    parser.add_argument("--xml-dir", type=Path, default=DEFAULT_XML_DIR)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    parser.add_argument("--dates", type=Path, default=DEFAULT_OUT_DIR / "session_dates.json")
    parser.add_argument("--topic-count", type=int, default=DEFAULT_TOPIC_COUNT)
    parser.add_argument("--min-df", type=int, default=30)
    parser.add_argument("--max-features", type=int, default=8000)
    parser.add_argument("--top-terms", type=int, default=10)
    parser.add_argument("--min-content-tokens", type=int, default=MIN_CONTENT_TOKENS)
    return parser.parse_args()


def parse_speech_filename(path: Path) -> tuple[str, str] | None:
    parts = path.stem.split("__")
    if len(parts) < 3:
        return None
    return parts[0], parts[-1]


def load_or_build_dates(dates_path: Path, xml_dir: Path) -> dict[str, str]:
    if dates_path.exists():
        raw = json.loads(dates_path.read_text(encoding="utf-8"))
        return {
            stem: normalized
            for stem, value in raw.items()
            if (normalized := normalize_session_date(str(value)))
        }
    if not xml_dir.is_dir():
        raise SystemExit(f"XML directory not found: {xml_dir}")
    dates = index_session_dates(xml_dir)
    dates_path.parent.mkdir(parents=True, exist_ok=True)
    dates_path.write_text(json.dumps(dates, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(dates)} session dates to {dates_path}")
    return dates


def write_csv(path: Path, rows: list[dict[str, object]], fieldnames: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def collect_speeches(
    speech_dir: Path,
    dates: dict[str, str],
    min_content_tokens: int,
) -> tuple[list[str], list[str], list[str], list[str]]:
    files = sorted(
        path
        for path in speech_dir.glob("*.txt")
        if path.parent.name != "by_speaker" and path.parent.name != "by_session"
    )
    if not files:
        raise SystemExit(f"No speech files found in {speech_dir}")

    slugs = []
    parsed: list[tuple[Path, str, str]] = []
    for path in files:
        parsed_name = parse_speech_filename(path)
        if parsed_name is None:
            continue
        session_stem, slug = parsed_name
        parsed.append((path, session_stem, slug))
        slugs.append(slug)

    unique_slug_paths = [Path(f"{slug}.txt") for slug in sorted(set(slugs))]
    party_lookup = build_party_lookup(unique_slug_paths)

    documents: list[str] = []
    parties: list[str] = []
    months: list[str] = []
    kept_slugs: list[str] = []
    skipped_short = 0
    skipped_date = 0

    for path, session_stem, slug in parsed:
        date = dates.get(session_stem)
        if not date:
            skipped_date += 1
            continue
        text = path.read_text(encoding="utf-8")
        tokens = surface_content_tokens(normalize_for_ngrams(text))
        if len(tokens) < min_content_tokens:
            skipped_short += 1
            continue
        party, _name, _source = resolve_party(slug, party_lookup)
        documents.append(" ".join(tokens))
        parties.append(party)
        months.append(date[:7])
        kept_slugs.append(slug)

    if not documents:
        raise SystemExit("No speeches left after date and length filters.")
    print(
        f"Using {len(documents)} speeches "
        f"({skipped_short} short, {skipped_date} without dates, {len(files)} files)"
    )
    return documents, parties, months, kept_slugs


def fit_nmf(
    documents: list[str],
    topic_count: int,
    min_df: int,
    max_features: int,
    top_terms: int,
) -> tuple[list[dict[str, object]], list[int]]:
    try:
        from sklearn.decomposition import NMF
        from sklearn.feature_extraction.text import TfidfVectorizer
    except ImportError as exc:
        raise SystemExit(
            "scikit-learn is required. Install it with: uv sync --extra topics"
        ) from exc

    vectorizer = TfidfVectorizer(
        min_df=min_df,
        max_df=0.55,
        max_features=max_features,
        ngram_range=(1, 2),
    )
    matrix = vectorizer.fit_transform(documents)
    model = NMF(
        n_components=topic_count,
        random_state=0,
        init="nndsvda",
        max_iter=400,
    )
    weights = model.fit_transform(matrix)
    feature_names = vectorizer.get_feature_names_out()
    topics: list[dict[str, object]] = []
    for topic_id, component in enumerate(model.components_):
        top_indices = component.argsort()[::-1][:top_terms]
        terms = [str(feature_names[index]) for index in top_indices]
        topics.append(
            {
                "topic_id": topic_id,
                "label": ", ".join(terms[:4]),
                "terms": " | ".join(terms),
            }
        )
    assignments = weights.argmax(axis=1).tolist()
    return topics, assignments


def aggregate(
    parties: list[str],
    months: list[str],
    assignments: list[int],
    topic_count: int,
) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    party_totals: Counter[str] = Counter(parties)
    party_topic_counts: dict[str, Counter[int]] = defaultdict(Counter)
    monthly_totals: dict[tuple[str, str], int] = Counter()
    monthly_topic: dict[tuple[str, str, int], int] = Counter()

    for party, month, topic_id in zip(parties, months, assignments):
        party_topic_counts[party][topic_id] += 1
        monthly_totals[party, month] += 1
        monthly_topic[party, month, topic_id] += 1

    party_rows: list[dict[str, object]] = []
    for party, total in sorted(party_totals.items()):
        for topic_id in range(topic_count):
            count = party_topic_counts[party][topic_id]
            party_rows.append(
                {
                    "party": party,
                    "topic_id": topic_id,
                    "speech_count": count,
                    "share": count / total if total else 0,
                }
            )

    monthly_rows: list[dict[str, object]] = []
    for (party, month), total in sorted(monthly_totals.items()):
        for topic_id in range(topic_count):
            count = monthly_topic[party, month, topic_id]
            monthly_rows.append(
                {
                    "party": party,
                    "month": month,
                    "topic_id": topic_id,
                    "speech_count": count,
                    "share": count / total if total else 0,
                }
            )
    return party_rows, monthly_rows


def main() -> int:
    args = parse_args()
    if args.topic_count < 2:
        raise SystemExit("--topic-count must be >= 2")
    dates = load_or_build_dates(args.dates, args.xml_dir)
    documents, parties, months, _slugs = collect_speeches(
        args.speech_dir,
        dates,
        args.min_content_tokens,
    )
    topics, assignments = fit_nmf(
        documents,
        args.topic_count,
        args.min_df,
        args.max_features,
        args.top_terms,
    )
    party_rows, monthly_rows = aggregate(parties, months, assignments, args.topic_count)

    args.out_dir.mkdir(parents=True, exist_ok=True)
    write_csv(args.out_dir / "topic_terms.csv", topics, ["topic_id", "label", "terms"])
    write_csv(
        args.out_dir / "party_topics.csv",
        party_rows,
        ["party", "topic_id", "speech_count", "share"],
    )
    write_csv(
        args.out_dir / "party_topic_monthly.csv",
        monthly_rows,
        ["party", "month", "topic_id", "speech_count", "share"],
    )
    print(f"Wrote {len(topics)} topics to {args.out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
