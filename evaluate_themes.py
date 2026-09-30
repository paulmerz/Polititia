"""Measure the precision of theme attributions against a hand-labelled gold set.

The gold set (``themes/gold/theme_attributions.jsonl``) lists speech/theme
pairs with ``label`` 1 (the speech is about the theme) or 0 (it is not).
Pairs are drawn by ``--sample`` from the attributions, stratified by method
(``debate`` or ``text``), so the overall precision is re-weighted by the
share of each method in the full output.

Usage:
    python evaluate_themes.py --sample 120:text 80:debate > candidates.jsonl
    python evaluate_themes.py                     # evaluate the gold set
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from collections import Counter
from pathlib import Path


DEFAULT_ATTRIBUTIONS = Path("analysis_outputs/themes/attributions.jsonl")
DEFAULT_GOLD = Path("themes/gold/theme_attributions.jsonl")
TARGET_PRECISION = 0.90
SEED = 17


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--attributions", type=Path, default=DEFAULT_ATTRIBUTIONS)
    parser.add_argument("--gold", type=Path, default=DEFAULT_GOLD)
    parser.add_argument("--sample", nargs="*", metavar="N:METHOD", help="Print a stratified sample to label.")
    parser.add_argument("--seed", type=int, default=SEED)
    parser.add_argument("--min-precision", type=float, default=TARGET_PRECISION)
    return parser.parse_args()


def load_jsonl(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def sample(attributions: list[dict], plan: list[str], seed: int = SEED) -> list[dict]:
    rng = random.Random(seed)
    picked: list[dict] = []
    for item in plan:
        count, method = item.split(":", 1)
        pool = [row for row in attributions if row["method"] == method]
        for row in rng.sample(pool, min(int(count), len(pool))):
            picked.append({
                "speech_id": row["speech_id"],
                "theme_id": row["theme_id"],
                "method": method,
                "debate_title": row["debate_title"],
                "terms": row["terms"],
                "excerpt": row["excerpt"],
                "label": None,
            })
    return picked


def evaluate(attributions: list[dict], gold: list[dict]) -> dict[str, object]:
    predicted = {(row["speech_id"], row["theme_id"]): row["method"] for row in attributions if row["method"] != "domain"}
    method_share = Counter(predicted.values())
    total_predicted = sum(method_share.values())

    by_method: dict[str, Counter[str]] = {}
    missed_negatives: list[dict] = []
    for item in gold:
        key = (item["speech_id"], item["theme_id"])
        method = predicted.get(key)
        if method is None:
            continue
        counts = by_method.setdefault(method, Counter())
        counts["correct" if item["label"] else "wrong"] += 1
        if not item["label"]:
            missed_negatives.append(item)

    report: dict[str, object] = {"methods": {}}
    weighted = 0.0
    for method, counts in sorted(by_method.items()):
        judged = counts["correct"] + counts["wrong"]
        precision = counts["correct"] / judged if judged else 0.0
        share = method_share[method] / total_predicted if total_predicted else 0.0
        weighted += precision * share
        report["methods"][method] = {"judged": judged, "precision": round(precision, 3), "share": round(share, 3)}
    report["weightedPrecision"] = round(weighted, 3)
    report["wrong"] = [
        {key: item.get(key) for key in ("speech_id", "theme_id", "debate_title", "note")}
        for item in missed_negatives
    ]
    return report


def main() -> None:
    args = parse_args()
    attributions = load_jsonl(args.attributions)
    if args.sample:
        labelled = {(row["speech_id"], row["theme_id"]) for row in load_jsonl(args.gold)} if args.gold.is_file() else set()
        pool = [row for row in attributions if (row["speech_id"], row["theme_id"]) not in labelled]
        for row in sample(pool, args.sample, args.seed):
            print(json.dumps(row, ensure_ascii=False))
        return
    report = evaluate(attributions, load_jsonl(args.gold))
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if report["weightedPrecision"] < args.min_precision:
        sys.exit(f"Precision {report['weightedPrecision']} is below the {args.min_precision} target.")


if __name__ == "__main__":
    main()
