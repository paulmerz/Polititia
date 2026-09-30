#!/usr/bin/env python3
"""Build the bundle the hemicycle needs on first load.

Identities, groups and volumes come from ``analysis_outputs/analytics.sqlite``
(build_analytics_db.py), so the seats, the server's metered views and this
bundle share the same politician ids. Everything that depends on a person, a
group, a theme or a period (expressions, excerpts, votes) is computed by the
server from that database instead of being shipped here.

Style markers (forms of address, negations...) are the only per-person text
statistics kept: they are gated behind the politician view by the server.
"""

from __future__ import annotations

import argparse
import csv
import json
import sqlite3
import sys
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from reference_data import DEFAULT_OPEN_DATA_DIR, GOVERNMENT, NON_INSCRITS, ReferenceData  # noqa: E402
from speakers import SpeakerResolver  # noqa: E402
from speech_markers import (  # noqa: E402
    MARKER_ORDER,
    classify_marker,
    find_address_phrases,
    find_negation_phrases,
    rate_per_thousand,
)


def first_existing(*paths: Path) -> Path:
    for path in paths:
        if path.exists():
            return path
    return paths[0]


def display_path(path: Path) -> str:
    for base in (ROOT, ROOT.parent):
        try:
            return str(path.relative_to(base))
        except ValueError:
            continue
    return str(path)


OUTPUT_DIR = ROOT / "dashboard" / "data"
ANALYTICS_PATH = ROOT / "analysis_outputs" / "analytics.sqlite"
SPEECHES_PATH = ROOT / "extracted_texts" / "project_full" / "speeches.jsonl"
SPEAKER_DIR = ROOT / "extracted_texts" / "project_full" / "by_speaker"
LANGUAGE_MARKERS_PATH = first_existing(
    ROOT / "metrics_CSV" / "metriche_by_party.csv",
    ROOT / "Politica" / "metrics_CSV" / "metriche_by_party.csv",
    ROOT.parent / "Politica" / "metrics_CSV" / "metriche_by_party.csv",
    ROOT.parent / "metrics_CSV" / "metriche_by_party.csv",
)

UNLABELED = "UNLABELED"
NON_DEPUTY_PARTIES = {GOVERNMENT, UNLABELED}
MARKER_NGRAM_SIZES = (2, 3, 4, 5)
TOP_MARKERS = 14
LANGUAGE_METRICS = [
    {
        "key": "LD",
        "label": "Lexical density",
        "shortLabel": "LD",
        "unit": "percent",
        "description": "Share of lexical/content words.",
    },
    {
        "key": "BW",
        "label": "Big words",
        "shortLabel": "BW",
        "unit": "percent",
        "description": "Share of words longer than 6 characters.",
    },
    {
        "key": "MWL",
        "label": "Mean word length",
        "shortLabel": "MWL",
        "unit": "chars",
        "description": "Average word length in characters.",
    },
    {
        "key": "MSL",
        "label": "Mean sentence length",
        "shortLabel": "MSL",
        "unit": "words",
        "description": "Average sentence length in words.",
    },
    {
        "key": "TTR",
        "label": "Type-token ratio",
        "shortLabel": "TTR",
        "unit": "ratio",
        "description": "Lexical diversity ratio.",
    },
    {
        "key": "nous",
        "label": "nous",
        "shortLabel": "nous",
        "unit": "perMille",
        "description": "Occurrences per thousand words.",
    },
    {
        "key": "je",
        "label": "je",
        "shortLabel": "je",
        "unit": "perMille",
        "description": "Occurrences per thousand words.",
    },
    {
        "key": "il",
        "label": "il",
        "shortLabel": "il",
        "unit": "perMille",
        "description": "Occurrences per thousand words.",
    },
    {
        "key": "vous",
        "label": "vous",
        "shortLabel": "vous",
        "unit": "perMille",
        "description": "Occurrences per thousand words.",
    },
]

# Hemicycle order, left to right. Groups missing from the corpus are dropped.
PARTY_CONFIG = [
    {"id": "LFI_NFP", "label": "LFI-NFP", "name": "La France insoumise - Nouveau Front populaire", "family": "Left", "color": "#c43b58"},
    {"id": "GDR", "label": "GDR", "name": "Gauche démocrate et républicaine", "family": "Left", "color": "#8e4bb5"},
    {"id": "EcoS", "label": "EcoS", "name": "Écologiste et social", "family": "Green", "color": "#2d9b68"},
    {"id": "SOC", "label": "SOC", "name": "Socialistes et apparentés", "family": "Left", "color": "#e05a87"},
    {"id": "LIOT", "label": "LIOT", "name": "Libertés, indépendants, outre-mer et territoires", "family": "Independent", "color": "#4f8ec8"},
    {"id": "Dem", "label": "Dem", "name": "Les Démocrates", "family": "Center", "color": "#e4a72c"},
    {"id": "EPR", "label": "EPR", "name": "Ensemble pour la République", "family": "Center", "color": "#2e75d4"},
    {"id": "HOR", "label": "HOR", "name": "Horizons & indépendants", "family": "Center-right", "color": "#42a9b8"},
    {"id": "DR", "label": "DR", "name": "Droite républicaine", "family": "Right", "color": "#3156a3"},
    {"id": "UDR", "label": "UDR", "name": "Union des droites pour la République", "family": "Right", "color": "#6f5b9e"},
    {"id": "RN", "label": "RN", "name": "Rassemblement national", "family": "Far right", "color": "#26324d"},
    {"id": NON_INSCRITS, "label": "NI", "name": "Non inscrits", "family": "Independent", "color": "#b0a58f"},
    {"id": GOVERNMENT, "label": "Gouvernement", "name": "Membres du Gouvernement", "family": "Government", "color": "#7a8594"},
    {"id": UNLABELED, "label": "Autres intervenants", "name": "Personnes auditionnées sans mandat de député", "family": "Unknown", "color": "#9aa1aa"},
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--analytics", type=Path, default=ANALYTICS_PATH)
    parser.add_argument("--speeches", type=Path, default=SPEECHES_PATH)
    parser.add_argument("--speaker-dir", type=Path, default=SPEAKER_DIR)
    parser.add_argument("--open-data", type=Path, default=ROOT / DEFAULT_OPEN_DATA_DIR)
    parser.add_argument("--out", type=Path, default=OUTPUT_DIR)
    return parser.parse_args()


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def float_value(value: str | float | None) -> float:
    if value in (None, ""):
        return 0.0
    return float(value)


def ngrams(tokens: list[str], size: int) -> list[str]:
    if len(tokens) < size:
        return []
    return [" ".join(tokens[index : index + size]) for index in range(len(tokens) - size + 1)]


def rank_counter(counts: Counter[str], total: int, speech_counts: Counter[str], total_speeches: int) -> list[dict]:
    return [
        {
            "rank": rank,
            "ngram": ngram,
            "count": count,
            "frequency": count / total if total else 0,
            "speechCount": speech_counts[ngram],
            "speechFrequency": speech_counts[ngram] / total_speeches if total_speeches else 0,
        }
        for rank, (ngram, count) in enumerate(counts.most_common(TOP_MARKERS), start=1)
    ]


def load_politicians(db: sqlite3.Connection) -> list[dict]:
    rows = db.execute(
        """
        SELECT p.id, p.name, p.party, p.acteur_id, COUNT(s.sid), COALESCE(SUM(s.words), 0)
        FROM politicians p LEFT JOIN speeches s ON s.pid = p.pid
        GROUP BY p.pid
        """
    ).fetchall()
    order = {config["id"]: index for index, config in enumerate(PARTY_CONFIG)}
    politicians = [
        {"id": pid, "name": name, "party": party, "acteurId": acteur_id, "speechCount": speeches, "words": words}
        for pid, name, party, acteur_id, speeches, words in rows
    ]
    politicians.sort(key=lambda item: (order.get(item["party"], len(order)), -item["words"], item["name"]))
    return politicians


def load_parties(db: sqlite3.Connection, politicians: list[dict]) -> list[dict]:
    """Volumes follow the group on the day of each speech, members the card's group."""
    volumes = {
        party: (speeches, words)
        for party, speeches, words in db.execute("SELECT party, COUNT(*), SUM(words) FROM speeches GROUP BY party")
    }
    members = Counter(item["party"] for item in politicians)
    parties = []
    for config in PARTY_CONFIG:
        speeches, words = volumes.get(config["id"], (0, 0))
        if not speeches and not members[config["id"]] and config["id"] not in NON_DEPUTY_PARTIES:
            continue
        parties.append({
            **config,
            "politicianCount": members[config["id"]],
            "speechCount": speeches,
            "words": words or 0,
        })
    known = {config["id"] for config in PARTY_CONFIG}
    unknown = sorted(set(members) - known)
    if unknown:
        raise SystemExit(f"Groups missing from PARTY_CONFIG: {', '.join(unknown)}")
    return parties


class MarkerCounter:
    """Style markers of one politician, over all their speeches."""

    def __init__(self) -> None:
        self.counts: dict[str, Counter[str]] = defaultdict(Counter)
        self.speech_counts: dict[str, Counter[str]] = defaultdict(Counter)
        self.totals: Counter[str] = Counter()
        self.events: Counter[str] = Counter()
        self.speeches = 0
        self.tokens = 0

    def add(self, text: str) -> None:
        tokens = text.split()
        if not tokens:
            return
        self.speeches += 1
        self.tokens += len(tokens)
        for category, hits in (("address", find_address_phrases(tokens)), ("negation", find_negation_phrases(tokens))):
            if hits:
                self.counts[category].update(hits)
                self.totals[category] += len(hits)
                self.speech_counts[category].update(set(hits))
                self.events[category] += len(hits)
        seen: dict[str, set[str]] = defaultdict(set)
        for size in MARKER_NGRAM_SIZES:
            for phrase in ngrams(tokens, size):
                category = classify_marker(phrase.split())
                if category is None:
                    continue
                self.counts[category][phrase] += 1
                self.totals[category] += 1
                seen[category].add(phrase)
        for category, phrases in seen.items():
            self.speech_counts[category].update(phrases)

    def payload(self) -> dict:
        return {
            "markers": {
                category: rank_counter(
                    self.counts[category], self.totals[category], self.speech_counts[category], self.speeches
                )
                for category in MARKER_ORDER
            },
            "markerRates": {
                category: round(rate_per_thousand(self.events[category], self.tokens), 2)
                for category in ("address", "negation")
            },
            "markerCounts": {category: int(self.events[category]) for category in ("address", "negation")},
        }


def build_markers(speeches_path: Path, resolver: SpeakerResolver, known_ids: set[str]) -> dict[str, dict]:
    counters: dict[str, MarkerCounter] = defaultdict(MarkerCounter)
    with speeches_path.open(encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            raw = json.loads(line)
            identity = resolver.resolve(raw)
            if identity is None or identity.politician_id not in known_ids:
                continue
            counters[identity.politician_id].add(raw.get("normalized_text") or "")
    return {politician_id: counter.payload() for politician_id, counter in counters.items() if counter.speeches}


def build_language_markers() -> dict[str, object]:
    if not LANGUAGE_MARKERS_PATH.exists():
        return {"source": "", "metrics": LANGUAGE_METRICS, "partyRows": [], "summary": {}}

    metric_keys = [metric["key"] for metric in LANGUAGE_METRICS]
    party_rows = [
        {"party": row["party"], "values": {key: float_value(row.get(key)) for key in metric_keys}}
        for row in read_csv(LANGUAGE_MARKERS_PATH)
    ]
    summary: dict[str, dict[str, float]] = {}
    for key in metric_keys:
        values = [float(row["values"][key]) for row in party_rows]
        if values:
            summary[key] = {"min": min(values), "max": max(values), "mean": sum(values) / len(values)}
    return {
        "source": display_path(LANGUAGE_MARKERS_PATH),
        "metrics": LANGUAGE_METRICS,
        "partyRows": party_rows,
        "summary": summary,
    }


def build_bundle(analytics: Path, speeches: Path, resolver: SpeakerResolver) -> dict:
    db = sqlite3.connect(f"file:{analytics}?mode=ro", uri=True)
    try:
        politicians = load_politicians(db)
        parties = load_parties(db, politicians)
        row = db.execute("SELECT value FROM meta WHERE key = 'builtOn'").fetchone()
        built_on = json.loads(row[0]) if row else date.today().isoformat()
    finally:
        db.close()
    markers = build_markers(speeches, resolver, {item["id"] for item in politicians})
    return {
        "meta": {
            "politicians": len(politicians),
            "deputies": sum(1 for item in politicians if item["party"] not in NON_DEPUTY_PARTIES),
            "totalSpeeches": sum(item["speechCount"] for item in politicians),
            "totalWords": sum(item["words"] for item in politicians),
            "builtOn": built_on,
            "sources": {
                "analytics": display_path(analytics),
                "speeches": display_path(speeches),
                "languageMarkers": display_path(LANGUAGE_MARKERS_PATH) if LANGUAGE_MARKERS_PATH.exists() else "",
            },
        },
        "partyOrder": [party["id"] for party in parties],
        "parties": parties,
        "politicians": politicians,
        "languageMarkers": build_language_markers(),
        "markersByPolitician": markers,
    }


def main() -> None:
    args = parse_args()
    for path in (args.analytics, args.speeches):
        if not path.is_file():
            raise SystemExit(f"Missing input: {path} (run build_analytics_db.py first)")
    reference = ReferenceData(args.open_data)
    data = build_bundle(args.analytics, args.speeches, SpeakerResolver(reference, args.speaker_dir))

    args.out.mkdir(parents=True, exist_ok=True)
    json_path = args.out / "dashboard-data.json"
    json_path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    (args.out / "dashboard-data.js").unlink(missing_ok=True)
    print(f"Wrote {display_path(json_path)}: {data['meta']['politicians']} politicians, {data['meta']['deputies']} deputies")


if __name__ == "__main__":
    main()
