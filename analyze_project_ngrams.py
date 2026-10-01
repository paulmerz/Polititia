"""
Create higher-level n-gram analysis outputs for the parliamentary corpus.

This script complements ngram_distribution.py. It focuses on:

  - global common n-grams;
  - party-level common n-grams;
  - party-distinctive n-grams using smoothed log-odds;
  - politician-level TF-IDF n-grams scored against the rest of the corpus;
  - speaker and party activity summaries.

Party labels are inferred from speaker filenames that end with a known
Assemblée group code, such as _RN, _EPR, or _LFI_NFP. Unlabeled speaker
variants are assigned only when the same normalized speaker name has exactly
one labeled variant elsewhere in the extracted corpus.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

from ngram_distribution import build_lemma_tokenizer, ngrams, surface_tokens


DEFAULT_SPEAKER_DIR = Path("extracted_texts/project_full/by_speaker")
DEFAULT_OUTPUT_DIR = Path("analysis_outputs")
DEFAULT_SPACY_MODEL = "fr_core_news_md"
FRENCH_STOPWORDS = {
    "a",
    "afin",
    "ai",
    "aie",
    "aient",
    "ait",
    "alors",
    "après",
    "as",
    "au",
    "aucun",
    "aussi",
    "autre",
    "aux",
    "avaient",
    "avais",
    "avait",
    "avant",
    "avec",
    "avez",
    "avons",
    "ayant",
    "bon",
    "car",
    "ce",
    "cela",
    "ces",
    "cet",
    "cette",
    "ceux",
    "chaque",
    "ci",
    "comme",
    "comment",
    "dans",
    "de",
    "des",
    "du",
    "donc",
    "dont",
    "elle",
    "elles",
    "en",
    "encore",
    "entre",
    "est",
    "et",
    "étaient",
    "étais",
    "était",
    "été",
    "être",
    "eu",
    "eux",
    "fait",
    "faites",
    "fois",
    "font",
    "hors",
    "ici",
    "il",
    "ils",
    "je",
    "juste",
    "l",
    "la",
    "le",
    "les",
    "leur",
    "leurs",
    "lors",
    "lui",
    "ma",
    "mais",
    "me",
    "même",
    "mes",
    "moins",
    "mon",
    "ne",
    "ni",
    "nos",
    "notre",
    "nous",
    "on",
    "ont",
    "ou",
    "où",
    "par",
    "parce",
    "pas",
    "peu",
    "peut",
    "plus",
    "pour",
    "pourquoi",
    "qu",
    "quand",
    "que",
    "quel",
    "quelle",
    "quelles",
    "quels",
    "qui",
    "quoi",
    "sa",
    "sans",
    "se",
    "sera",
    "serait",
    "seront",
    "ses",
    "si",
    "sont",
    "sous",
    "soyez",
    "sur",
    "ta",
    "te",
    "tel",
    "telle",
    "tes",
    "toi",
    "ton",
    "tous",
    "tout",
    "toute",
    "toutes",
    "très",
    "tu",
    "un",
    "une",
    "va",
    "vers",
    "vos",
    "votre",
    "vous",
    "y",
}
LOW_INFORMATION_TERMS = {
    "abord",
    "ailleurs",
    "ainsi",
    "agit",
    "an",
    "année",
    "années",
    "ans",
    "aujourd",
    "avoir",
    "autres",
    "bien",
    "cas",
    "celle",
    "certain",
    "certains",
    "celui",
    "cinq",
    "compris",
    "compte",
    "deja",
    "depuis",
    "déjà",
    "deux",
    "dire",
    "dit",
    "dits",
    "dix",
    "doit",
    "effet",
    "enfin",
    "également",
    "etre",
    "étant",
    "faire",
    "faut",
    "hui",
    "jusqu",
    "laquelle",
    "là",
    "mêmes",
    "moi",
    "no",
    "non",
    "notamment",
    "nouveau",
    "or",
    "près",
    "personne",
    "plusieurs",
    "premier",
    "première",
    "préalable",
    "question",
    "quarante",
    "quelques",
    "sept",
    "seulement",
    "soit",
    "son",
    "sommes",
    "souvent",
    "suis",
    "temps",
    "tenu",
    "tiens",
    "toujours",
    "trois",
    "vise",
    "vingt",
    "vue",
}
PROCEDURAL_CONTENT_TERMS = {
    "alinéa",
    "applaudissements",
    "applaudissent",
    "applaudit",
    "exclamations",
    "lèvent",
    "protestations",
    "amendement",
    "amendements",
    "article",
    "assemblée",
    "avis",
    "bancs",
    "cher",
    "chers",
    "collègue",
    "collègues",
    "commission",
    "conférence",
    "défavorable",
    "débat",
    "débats",
    "demande",
    "député",
    "députés",
    "favorable",
    "groupe",
    "gouvernement",
    "loi",
    "madame",
    "mesdames",
    "ministre",
    "monsieur",
    "motion",
    "nationale",
    "ordre",
    "personnel",
    "président",
    "présidente",
    "projet",
    "proposition",
    "rapport",
    "rapporteur",
    "rapporteure",
    "rectifié",
    "rejet",
    "remets",
    "retrait",
    "sagesse",
    "scrutin",
    "séance",
    "suspension",
    "texte",
    "titre",
    "votera",
    "voterons",
}
CONTENT_EXCLUDE_TERMS = FRENCH_STOPWORDS | LOW_INFORMATION_TERMS | PROCEDURAL_CONTENT_TERMS
PARTY_CODES = {
    "Dem",
    "DR",
    "EcoS",
    "EPR",
    "GDR",
    "HOR",
    "LFI_NFP",
    "LIOT",
    "RN",
    "SOC",
    "UDR",
}


@dataclass
class SpeakerRecord:
    speaker_slug: str
    speaker_name: str
    party: str
    party_source: str
    speech_count: int
    token_count: int
    source_path: Path


@dataclass
class PoliticianStats:
    speaker_name: str
    party: str
    speech_count: int = 0
    surface_token_count: int = 0
    analysis_token_count: int = 0
    speaker_slugs: set[str] = field(default_factory=set)
    party_sources: Counter[str] = field(default_factory=Counter)
    counts: dict[int, Counter[str]] = field(default_factory=lambda: defaultdict(Counter))
    totals: Counter[int] = field(default_factory=Counter)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Analyze project n-grams by speaker and party.")
    parser.add_argument(
        "--speaker-dir",
        type=Path,
        default=DEFAULT_SPEAKER_DIR,
        help=f"Input by_speaker directory. Default: {DEFAULT_SPEAKER_DIR}",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help=f"Output directory. Default: {DEFAULT_OUTPUT_DIR}",
    )
    parser.add_argument(
        "--spacy-model",
        default=DEFAULT_SPACY_MODEL,
        help=f"spaCy model for lemma-content analysis. Default: {DEFAULT_SPACY_MODEL}",
    )
    parser.add_argument(
        "--token-mode",
        choices=("surface", "surface_content", "lemma_content"),
        default="surface_content",
        help="Token representation for aggregate analysis. Default: surface_content",
    )
    parser.add_argument(
        "--ngram-sizes",
        nargs="+",
        type=int,
        default=[1, 2, 3, 4],
        help="N-gram sizes for global, party, and politician analyses. Default: 1 2 3 4",
    )
    parser.add_argument(
        "--top-k",
        type=int,
        default=25,
        help="Rows to keep per section, party, and n. Default: 25",
    )
    parser.add_argument(
        "--min-party-tokens",
        type=int,
        default=500,
        help="Minimum tokens for a party to enter party analysis. Default: 500",
    )
    parser.add_argument(
        "--min-distinctive-count",
        type=int,
        default=5,
        help="Minimum party count for distinctive n-grams. Default: 5",
    )
    parser.add_argument(
        "--min-tfidf-count",
        type=int,
        default=1,
        help="Minimum politician count for TF-IDF n-grams. Default: 1",
    )
    return parser.parse_args()


def validate_args(args: argparse.Namespace) -> tuple[int, ...]:
    if not args.speaker_dir.is_dir():
        raise SystemExit(f"Speaker directory not found: {args.speaker_dir}")
    if args.top_k < 1:
        raise SystemExit("--top-k must be >= 1")
    if args.min_party_tokens < 1:
        raise SystemExit("--min-party-tokens must be >= 1")
    if args.min_distinctive_count < 1:
        raise SystemExit("--min-distinctive-count must be >= 1")
    if args.min_tfidf_count < 1:
        raise SystemExit("--min-tfidf-count must be >= 1")
    invalid = [size for size in args.ngram_sizes if size < 1]
    if invalid:
        raise SystemExit(f"N-gram sizes must be positive: {invalid}")
    return tuple(sorted(set(args.ngram_sizes)))


def infer_party_and_name(speaker_slug: str) -> tuple[str, str]:
    parts = speaker_slug.split("_")
    for width in (2, 1):
        if len(parts) <= width:
            continue
        candidate = "_".join(parts[-width:])
        if candidate in PARTY_CODES:
            name = " ".join(parts[:-width])
            return candidate, name
    return "UNLABELED", " ".join(parts)


def build_party_lookup(speaker_files: list[Path]) -> dict[str, str]:
    known_parties: dict[str, set[str]] = defaultdict(set)
    for path in speaker_files:
        party, speaker_name = infer_party_and_name(path.stem)
        if party != "UNLABELED":
            known_parties[speaker_name].add(party)

    return {
        speaker_name: next(iter(parties))
        for speaker_name, parties in known_parties.items()
        if len(parties) == 1
    }


def resolve_party(speaker_slug: str, party_lookup: dict[str, str]) -> tuple[str, str, str]:
    party, speaker_name = infer_party_and_name(speaker_slug)
    if party != "UNLABELED":
        return party, speaker_name, "explicit"
    if speaker_name in party_lookup:
        return party_lookup[speaker_name], speaker_name, "inferred_from_labeled_variant"
    return party, speaker_name, "unresolved"


def read_speaker_files(speaker_dir: Path) -> list[Path]:
    files = sorted(speaker_dir.glob("*.txt"))
    if not files:
        raise SystemExit(f"No speaker corpus files found in {speaker_dir}")
    return files


def surface_content_tokens(line: str) -> list[str]:
    return [
        token
        for token in surface_tokens(line)
        if len(token) > 1 and token not in CONTENT_EXCLUDE_TERMS and any(char.isalpha() for char in token)
    ]


def build_tokenizer(args: argparse.Namespace):
    if args.token_mode == "surface":
        return surface_tokens
    if args.token_mode == "surface_content":
        return surface_content_tokens
    return build_lemma_tokenizer(
        model_name=args.spacy_model,
        drop_stopwords=True,
        keep_pos=["NOUN", "PROPN", "VERB", "ADJ"],
    )


def update_ngram_counts(
    counts: dict[int, Counter[str]],
    token_sequences: list[list[str]],
    ngram_sizes: tuple[int, ...],
) -> Counter[int]:
    totals: Counter[int] = Counter()
    for tokens in token_sequences:
        for size in ngram_sizes:
            grams = ngrams(tokens, size)
            counts[size].update(grams)
            totals[size] += len(grams)
    return totals


def ranked_rows(
    counts: dict[int, Counter[str]],
    totals: Counter[int],
    ngram_sizes: tuple[int, ...],
    top_k: int,
    extra: dict[str, object] | None = None,
) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    extra = extra or {}
    for size in ngram_sizes:
        total = totals[size]
        if total == 0:
            continue
        for rank, (ngram, count) in enumerate(counts[size].most_common(top_k), start=1):
            rows.append({
                **extra,
                "n": size,
                "rank": rank,
                "ngram": ngram,
                "count": count,
                "frequency": count / total,
                "total_ngrams": total,
            })
    return rows


def write_csv(path: Path, rows: list[dict[str, object]], fieldnames: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def party_distinctive_rows(
    party_counts: dict[str, dict[int, Counter[str]]],
    party_totals: dict[str, Counter[int]],
    ngram_sizes: tuple[int, ...],
    top_k: int,
    min_count: int,
) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []

    for size in ngram_sizes:
        vocab = sorted({ngram for counts in party_counts.values() for ngram in counts[size]})
        vocab_size = len(vocab)
        if vocab_size == 0:
            continue

        global_counts = Counter()
        for counts in party_counts.values():
            global_counts.update(counts[size])
        global_total = sum(global_counts.values())

        for party in sorted(party_counts):
            party_total = party_totals[party][size]
            if party_total == 0:
                continue

            scored: list[tuple[float, str, int, float]] = []
            for ngram, party_count in party_counts[party][size].items():
                if party_count < min_count:
                    continue
                rest_count = global_counts[ngram] - party_count
                rest_total = global_total - party_total
                party_rate = (party_count + 0.5) / (party_total + 0.5 * vocab_size)
                rest_rate = (rest_count + 0.5) / (rest_total + 0.5 * vocab_size)
                score = math.log(party_rate / rest_rate)
                if score <= 0:
                    continue
                scored.append((score, ngram, party_count, party_rate))

            for rank, (score, ngram, count, rate) in enumerate(
                sorted(scored, reverse=True)[:top_k],
                start=1,
            ):
                rows.append({
                    "party": party,
                    "n": size,
                    "rank": rank,
                    "ngram": ngram,
                    "count": count,
                    "party_frequency": rate,
                    "log_odds_vs_rest": score,
                    "party_total_ngrams": party_total,
                })

    return rows


def update_politician_stats(
    stats: PoliticianStats,
    speaker_slug: str,
    party_source: str,
    speech_count: int,
    surface_token_count: int,
    token_sequences: list[list[str]],
    ngram_sizes: tuple[int, ...],
) -> None:
    stats.speaker_slugs.add(speaker_slug)
    stats.party_sources[party_source] += speech_count
    stats.speech_count += speech_count
    stats.surface_token_count += surface_token_count
    stats.analysis_token_count += sum(len(tokens) for tokens in token_sequences)
    totals = update_ngram_counts(stats.counts, token_sequences, ngram_sizes)
    stats.totals.update(totals)


def politician_tfidf_rows(
    politicians: dict[tuple[str, str], PoliticianStats],
    ngram_sizes: tuple[int, ...],
    top_k: int,
    min_count: int,
) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    politician_stats = sorted(
        politicians.values(),
        key=lambda stats: (stats.speaker_name.casefold(), stats.party),
    )
    document_count = len(politician_stats)
    if document_count == 0:
        return rows

    document_frequencies: dict[int, Counter[str]] = {size: Counter() for size in ngram_sizes}
    for stats in politician_stats:
        for size in ngram_sizes:
            document_frequencies[size].update(stats.counts[size].keys())

    rest_document_count = max(document_count - 1, 0)
    for stats in politician_stats:
        speaker_slugs = ";".join(sorted(stats.speaker_slugs))
        party_sources = ";".join(
            f"{source}:{count}" for source, count in sorted(stats.party_sources.items())
        )

        for size in ngram_sizes:
            total = stats.totals[size]
            if total == 0:
                continue

            scored: list[tuple[float, float, float, int, str, int, int]] = []
            for ngram, count in stats.counts[size].items():
                if count < min_count:
                    continue
                document_frequency = document_frequencies[size][ngram]
                rest_document_frequency = max(document_frequency - 1, 0)
                idf_vs_rest = math.log(
                    (1 + rest_document_count) / (1 + rest_document_frequency)
                ) + 1.0
                term_frequency = count / total
                tf_idf_vs_rest = term_frequency * idf_vs_rest
                scored.append((
                    tf_idf_vs_rest,
                    term_frequency,
                    idf_vs_rest,
                    count,
                    ngram,
                    document_frequency,
                    rest_document_frequency,
                ))

            ranked = sorted(
                scored,
                key=lambda item: (-item[0], -item[1], -item[3], item[4]),
            )[:top_k]
            for rank, (
                tf_idf_vs_rest,
                term_frequency,
                idf_vs_rest,
                count,
                ngram,
                document_frequency,
                rest_document_frequency,
            ) in enumerate(ranked, start=1):
                rows.append({
                    "speaker": stats.speaker_name,
                    "party": stats.party,
                    "n": size,
                    "rank": rank,
                    "ngram": ngram,
                    "count": count,
                    "term_frequency": term_frequency,
                    "tf_idf_vs_rest": tf_idf_vs_rest,
                    "idf_vs_rest": idf_vs_rest,
                    "document_frequency": document_frequency,
                    "document_share": document_frequency / document_count,
                    "rest_document_frequency": rest_document_frequency,
                    "rest_document_share": (
                        rest_document_frequency / rest_document_count
                        if rest_document_count
                        else 0
                    ),
                    "total_ngrams": total,
                    "politician_speech_count": stats.speech_count,
                    "politician_analysis_token_count": stats.analysis_token_count,
                    "speaker_slugs": speaker_slugs,
                    "party_sources": party_sources,
                })

    return rows


def main() -> None:
    args = parse_args()
    ngram_sizes = validate_args(args)
    speaker_files = read_speaker_files(args.speaker_dir)
    party_lookup = build_party_lookup(speaker_files)
    args.out_dir.mkdir(parents=True, exist_ok=True)

    tokenize = build_tokenizer(args)

    speakers: list[SpeakerRecord] = []
    global_counts: dict[int, Counter[str]] = defaultdict(Counter)
    global_totals: Counter[int] = Counter()
    party_counts: dict[str, dict[int, Counter[str]]] = defaultdict(lambda: defaultdict(Counter))
    party_totals: dict[str, Counter[int]] = defaultdict(Counter)
    party_speech_counts: Counter[str] = Counter()
    party_token_counts: Counter[str] = Counter()
    party_source_counts: Counter[str] = Counter()
    politicians: dict[tuple[str, str], PoliticianStats] = {}

    for path in speaker_files:
        party, speaker_name, party_source = resolve_party(path.stem, party_lookup)
        lines = [line for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
        surface_token_count = sum(len(surface_tokens(line)) for line in lines)
        speakers.append(SpeakerRecord(
            speaker_slug=path.stem,
            speaker_name=speaker_name,
            party=party,
            party_source=party_source,
            speech_count=len(lines),
            token_count=surface_token_count,
            source_path=path,
        ))

        token_sequences = [tokens for line in lines if (tokens := tokenize(line))]
        totals = update_ngram_counts(global_counts, token_sequences, ngram_sizes)
        global_totals.update(totals)

        party_speech_counts[party] += len(lines)
        party_token_counts[party] += sum(len(tokens) for tokens in token_sequences)
        party_source_counts[party_source] += len(lines)
        party_specific_totals = update_ngram_counts(
            party_counts[party],
            token_sequences,
            ngram_sizes,
        )
        party_totals[party].update(party_specific_totals)

        politician_key = (speaker_name, party)
        if politician_key not in politicians:
            politicians[politician_key] = PoliticianStats(
                speaker_name=speaker_name,
                party=party,
            )
        update_politician_stats(
            politicians[politician_key],
            path.stem,
            party_source,
            len(lines),
            surface_token_count,
            token_sequences,
            ngram_sizes,
        )

    eligible_parties = {
        party
        for party, token_count in party_token_counts.items()
        if party != "UNLABELED" and token_count >= args.min_party_tokens
    }
    filtered_party_counts = {party: party_counts[party] for party in eligible_parties}
    filtered_party_totals = {party: party_totals[party] for party in eligible_parties}

    speaker_rows = [
        {
            "speaker": record.speaker_name,
            "speaker_slug": record.speaker_slug,
            "party": record.party,
            "party_source": record.party_source,
            "speech_count": record.speech_count,
            "surface_token_count": record.token_count,
            "source_path": str(record.source_path),
        }
        for record in sorted(speakers, key=lambda r: (-r.token_count, r.speaker_slug))
    ]
    write_csv(
        args.out_dir / "speaker_activity.csv",
        speaker_rows,
        [
            "speaker",
            "speaker_slug",
            "party",
            "party_source",
            "speech_count",
            "surface_token_count",
            "source_path",
        ],
    )

    party_activity_rows = [
        {
            "party": party,
            "speaker_count": sum(1 for speaker in speakers if speaker.party == party),
            "speech_count": party_speech_counts[party],
            "analysis_token_count": party_token_counts[party],
        }
        for party in sorted(party_token_counts, key=lambda p: (-party_token_counts[p], p))
    ]
    write_csv(
        args.out_dir / "party_activity.csv",
        party_activity_rows,
        ["party", "speaker_count", "speech_count", "analysis_token_count"],
    )

    global_rows = ranked_rows(
        global_counts,
        global_totals,
        ngram_sizes,
        args.top_k,
        {"token_mode": args.token_mode},
    )
    write_csv(
        args.out_dir / "global_common_ngrams.csv",
        global_rows,
        ["token_mode", "n", "rank", "ngram", "count", "frequency", "total_ngrams"],
    )

    party_common_rows: list[dict[str, object]] = []
    for party in sorted(eligible_parties):
        party_common_rows.extend(ranked_rows(
            party_counts[party],
            party_totals[party],
            ngram_sizes,
            args.top_k,
            {"party": party, "token_mode": args.token_mode},
        ))
    write_csv(
        args.out_dir / "party_common_ngrams.csv",
        party_common_rows,
        ["party", "token_mode", "n", "rank", "ngram", "count", "frequency", "total_ngrams"],
    )

    distinctive_rows = party_distinctive_rows(
        filtered_party_counts,
        filtered_party_totals,
        ngram_sizes,
        args.top_k,
        args.min_distinctive_count,
    )
    write_csv(
        args.out_dir / "party_distinctive_ngrams.csv",
        distinctive_rows,
        [
            "party",
            "n",
            "rank",
            "ngram",
            "count",
            "party_frequency",
            "log_odds_vs_rest",
            "party_total_ngrams",
        ],
    )

    tfidf_rows = politician_tfidf_rows(
        politicians,
        ngram_sizes,
        args.top_k,
        args.min_tfidf_count,
    )
    write_csv(
        args.out_dir / "speaker_tfidf_ngrams.csv",
        tfidf_rows,
        [
            "speaker",
            "party",
            "n",
            "rank",
            "ngram",
            "count",
            "term_frequency",
            "tf_idf_vs_rest",
            "idf_vs_rest",
            "document_frequency",
            "document_share",
            "rest_document_frequency",
            "rest_document_share",
            "total_ngrams",
            "politician_speech_count",
            "politician_analysis_token_count",
            "speaker_slugs",
            "party_sources",
        ],
    )

    summary = {
        "speaker_files": len(speaker_files),
        "speakers": len(speakers),
        "politicians": len(politicians),
        "parties_detected": sorted(party_token_counts),
        "eligible_parties": sorted(eligible_parties),
        "token_mode": args.token_mode,
        "ngram_sizes": list(ngram_sizes),
        "min_tfidf_count": args.min_tfidf_count,
        "party_source_speech_counts": dict(sorted(party_source_counts.items())),
        "total_speeches": sum(record.speech_count for record in speakers),
        "total_surface_tokens": sum(record.token_count for record in speakers),
        "total_analysis_tokens": sum(party_token_counts.values()),
        "outputs": {
            "speaker_activity": str(args.out_dir / "speaker_activity.csv"),
            "party_activity": str(args.out_dir / "party_activity.csv"),
            "global_common_ngrams": str(args.out_dir / "global_common_ngrams.csv"),
            "party_common_ngrams": str(args.out_dir / "party_common_ngrams.csv"),
            "party_distinctive_ngrams": str(args.out_dir / "party_distinctive_ngrams.csv"),
            "speaker_tfidf_ngrams": str(args.out_dir / "speaker_tfidf_ngrams.csv"),
        },
    }
    (args.out_dir / "analysis_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print(
        f"Wrote analysis for {len(speakers)} speakers, "
        f"{len(politicians)} politicians, "
        f"{len(eligible_parties)} labeled parties, "
        f"{summary['total_speeches']} speeches to {args.out_dir}"
    )


if __name__ == "__main__":
    main()
