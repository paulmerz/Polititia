"""Estimate where a speaker stands on the bill being debated.

Votes are the facts; this only covers what speakers *announce*. Precision
matters more than coverage, so a speech gets a stance only when it states a
vote on the bill itself, in the first person, without hedging:

- "nous voterons ce texte", "je voterai contre cette proposition de loi",
  "notre groupe s'opposera à ce projet de loi", "nous nous abstiendrons sur
  ce texte" (abstentions only in general discussion or explanations of vote,
  or with the bill named, since "nous nous abstiendrons" alone usually refers
  to an amendment);
- never when the object is an amendment, an article or a motion, when the
  sentence is negated ("nous ne voterons pas"), conditional ("si cet
  amendement est adopté, nous voterons contre"), a question, or when the same
  speech announces two different votes.

The stance is attached to the themes of the debate (``debate`` attributions
from analyze_themes.py): it is a position on *that bill*, which the interface
always names, not a position on the theme in general.

Optional classifiers can fill in speeches without an explicit formula:

- ``--nli``: French zero-shot NLI (mDeBERTa XNLI, needs ``transformers``),
  which abstains under ``--nli-threshold``;
- ``STANCE_LLM_URL`` + ``STANCE_LLM_MODEL`` (+ ``STANCE_LLM_KEY``): an
  OpenAI-compatible chat endpoint, which must answer with one label.

Every method is scored on the hand-labelled set in ``stances/gold`` and only
methods reaching ``PUBLISH_PRECISION`` on at least ``MIN_JUDGED`` judged
speeches are written to ``stances.jsonl``, the file build_analytics_db.py
loads. All candidates stay in ``candidates.jsonl`` for review.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import urllib.request
from collections import Counter, defaultdict
from collections.abc import Callable, Iterable
from dataclasses import asdict, dataclass
from pathlib import Path


DEFAULT_SPEECHES = Path("extracted_texts/project_full/speeches.jsonl")
DEFAULT_ATTRIBUTIONS = Path("analysis_outputs/themes/attributions.jsonl")
DEFAULT_GOLD = Path("stances/gold/stance_labels.jsonl")
DEFAULT_OUTPUT_DIR = Path("analysis_outputs/stances")
NLI_MODEL = "MoritzLaurer/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7"

FAVORABLE = "favorable"
UNFAVORABLE = "defavorable"
ABSTENTION = "abstention"
NONE = "aucune"
STANCES = (FAVORABLE, UNFAVORABLE, ABSTENTION)

PUBLISH_PRECISION = 0.85
MIN_JUDGED = 30
QUOTE_CHARS = 320
# Sections where speakers announce their group's vote on the whole bill.
VOTE_SECTIONS = re.compile(r"^(DISC_GENERALE|EXPL_VOTE|VOTE_ENS|MOTION_RP|PRESENTATION)")

BILL = (
    r"(?:(?:ce|le|votre|notre)\s+(?:présent\s+)?(?:texte|projet\s+de\s+loi(?:\s+de\s+finances)?|budget|plfss|plf)"
    r"|(?:cette|la|votre|notre)\s+(?:présente\s+)?proposition\s+de\s+(?:loi|résolution)"
    r"|l['’]ensemble\s+(?:du|de\s+ce)\s+(?:texte|projet\s+de\s+loi)"
    r"|l['’]ensemble\s+de\s+(?:cette|la)\s+proposition\s+de\s+loi)"
    # "ce texte" but not "ce texte d'amendement" / "cette proposition de loi ... amendée"
    r"(?![\w’'-]*\s+(?:d['’]amendement|de\s+l['’]amendement))"
)
SUBJECT = r"(?:(?:nous|je|notre\s+groupe|mon\s+groupe)\s+|j['’])"
ADVERB = r"(?:\s+(?:donc|évidemment|bien\s+sûr|naturellement|résolument|sans\s+hésiter|sans\s+hésitation|avec\s+(?:conviction|enthousiasme|détermination)|pleinement|unanimement|tous|toutes|également|aussi|finalement|ainsi|clairement|fermement|majoritairement|à\s+l['’]unanimité),?)*"
VOTE_VERB = r"(?:voterons|voterai|votera|allons\s+voter|vais\s+voter|va\s+voter)"

RULES: list[tuple[str, re.Pattern[str]]] = [
    (UNFAVORABLE, re.compile(
        rf"\b{SUBJECT}{VOTE_VERB}{ADVERB}\s+contre\s+{BILL}", re.I)),
    (FAVORABLE, re.compile(
        rf"\b{SUBJECT}{VOTE_VERB}{ADVERB}\s+(?:pour\s+|en\s+faveur\s+de\s+)?{BILL}", re.I)),
    (FAVORABLE, re.compile(
        rf"\b{SUBJECT}{VOTE_VERB}{ADVERB}\s+en\s+faveur\s+du\s+(?:présent\s+)?(?:texte|projet\s+de\s+loi|budget)", re.I)),
    (FAVORABLE, re.compile(
        rf"\b{SUBJECT}(?:soutiendrons|soutiendrai|soutiendra|approuverons|approuverai|approuvera|adopterons|adopterai){ADVERB}\s+{BILL}", re.I)),
    (UNFAVORABLE, re.compile(
        rf"\b{SUBJECT}(?:nous\s+opposerons|m['’]opposerai|s['’]opposera){ADVERB}\s+à\s+{BILL}", re.I)),
    (UNFAVORABLE, re.compile(
        rf"\b{SUBJECT}(?:rejetterons|rejetterai|rejettera|refuserons|refuserai|refusera){ADVERB}\s+{BILL}", re.I)),
    (ABSTENTION, re.compile(
        rf"\b(?:nous\s+nous\s+abstiendrons|je\s+m['’]abstiendrai|notre\s+groupe\s+s['’]abstiendra|mon\s+groupe\s+s['’]abstiendra)"
        rf"(?P<object>{ADVERB}\s+(?:sur|lors\s+du\s+vote\s+(?:de|sur))\s+{BILL})?", re.I)),
]

SENTENCE_SPLIT = re.compile(r"(?<=[.!?…])\s+(?=[A-ZÀ-ÖØ-Ý«])")
HEDGE = re.compile(
    r"\b(?:si|s['’]il|s['’]ils|sinon|sauf|à\s+moins|pourvu|faute\s+de|au\s+cas\s+où|dans\s+le\s+cas\s+où|pourrions|pourrais|aurions|aurais|serions|devrions|voudrions|hésit\w*|sous\s+réserve|liberté\s+de\s+vote)\b",
    re.I,
)
# A wish or a call before the verb is not an announcement: "j'espère que nous soutiendrons ce texte".
WISH = re.compile(
    r"\b(?:espère|espérons|souhaite|souhaitons|souhaiterais|souhaiterions|invite|invitons|appelle|appelons|demande|demandons|propose|proposons|voudrais|aimerais)\b",
    re.I,
)
# Joint debates ("Soins palliatifs – Aide à mourir") cover several bills: a named one may not be the theme's.
JOINT_DEBATE = re.compile(r"\s[–-]\s")
NAMED_BILL = re.compile(r"\s*(?:relative?s?\b|visant\b|portant\b|organique\b|sur\s+l|d['’]aide\b|de\s+(?:M\.|Mme)\s)", re.I)
ELSEWHERE = re.compile(r"\b(?:amendements?|article|alinéa|motion|sous-amendement)\b", re.I)


@dataclass(frozen=True)
class Stance:
    speech_id: str
    theme_id: str
    stance: str
    confidence: float
    method: str
    quote: str


def sentences(text: str) -> list[str]:
    return [part.strip() for paragraph in text.split("\n") for part in SENTENCE_SPLIT.split(paragraph) if part.strip()]


def _clean(sentence: str, start: int) -> bool:
    before = sentence[:start]
    if "?" in sentence or HEDGE.search(sentence) or WISH.search(before):
        return False
    return not re.search(r"\b(?:ne|n['’])\s+(?:\w+\s+){0,2}$", before, re.I)


def rule_stance(text: str, section_code: str = "", debate: str = "") -> tuple[str, str] | None:
    """(stance, quote) announced in ``text``, or None when absent or ambiguous."""
    found: list[tuple[str, str]] = []
    in_vote_section = bool(VOTE_SECTIONS.match(section_code or ""))
    joint = bool(JOINT_DEBATE.search(debate or ""))
    for sentence in sentences(text):
        for stance, pattern in RULES:
            for match in pattern.finditer(sentence):
                if not _clean(sentence, match.start()):
                    continue
                if re.match(r"[\s,]*(?:pas|jamais|plus|point)\b", sentence[match.end() :], re.I) and stance != ABSTENTION:
                    continue
                if joint and NAMED_BILL.match(sentence[match.end() :]):
                    continue
                if stance == ABSTENTION and not match.group("object"):
                    if not in_vote_section or ELSEWHERE.search(sentence):
                        continue
                found.append((stance, sentence))
    stances = {stance for stance, _quote in found}
    if len(stances) != 1:
        return None
    stance, quote = found[0]
    return stance, quote if len(quote) <= QUOTE_CHARS else quote[: QUOTE_CHARS - 1].rstrip() + "…"


Classifier = Callable[[str, str], tuple[str, float]]


def nli_classifier(model: str = NLI_MODEL) -> Classifier:
    from transformers import pipeline  # optional dependency

    classify = pipeline("zero-shot-classification", model=model)
    labels = {
        "L'orateur votera pour ce texte.": FAVORABLE,
        "L'orateur votera contre ce texte.": UNFAVORABLE,
        "L'orateur s'abstiendra sur ce texte.": ABSTENTION,
        "L'orateur n'annonce pas de vote sur ce texte.": NONE,
    }

    def run(text: str, debate: str) -> tuple[str, float]:
        result = classify(f"Débat : {debate}. {text[-1500:]}", list(labels), hypothesis_template="{}")
        return labels[result["labels"][0]], float(result["scores"][0])

    return run


def llm_classifier(url: str, model: str, key: str = "") -> Classifier:
    prompt = (
        "Tu lis une intervention en séance à l'Assemblée nationale. Réponds par un seul mot parmi "
        "favorable, defavorable, abstention, aucune : l'orateur annonce-t-il explicitement son vote "
        "sur l'ensemble du texte débattu ? Réponds aucune en cas de doute ou s'il parle d'un amendement."
    )

    def run(text: str, debate: str) -> tuple[str, float]:
        body = json.dumps({
            "model": model,
            "temperature": 0,
            "messages": [
                {"role": "system", "content": prompt},
                {"role": "user", "content": f"Débat : {debate}\n\n{text[-4000:]}"},
            ],
        }).encode()
        request = urllib.request.Request(url, body, {"Content-Type": "application/json"})
        if key:
            request.add_header("Authorization", f"Bearer {key}")
        with urllib.request.urlopen(request, timeout=60) as response:
            answer = json.load(response)["choices"][0]["message"]["content"].strip().lower()
        label = re.sub(r"[^a-zé]", "", answer.split()[0] if answer else "").replace("é", "e")
        return (label if label in STANCES else NONE), 0.9

    return run


def debate_themes(attributions: Iterable[dict]) -> dict[str, list[str]]:
    themes: dict[str, list[str]] = defaultdict(list)
    for item in attributions:
        if item.get("method") == "debate" and item["theme_id"] not in themes[item["speech_id"]]:
            themes[item["speech_id"]].append(item["theme_id"])
    return themes


def last_sentence(text: str) -> str:
    parts = sentences(text)
    quote = parts[-1] if parts else ""
    return quote if len(quote) <= QUOTE_CHARS else quote[: QUOTE_CHARS - 1].rstrip() + "…"


def analyze(
    speeches: Iterable[dict],
    themes_by_speech: dict[str, list[str]],
    classifiers: dict[str, tuple[Classifier, float]] | None = None,
) -> list[Stance]:
    results: list[Stance] = []
    for speech in speeches:
        themes = themes_by_speech.get(speech["speech_id"])
        if not themes:
            continue
        text = speech.get("text") or ""
        debate = speech.get("debate_topic") or speech.get("point_title") or ""
        found = rule_stance(text, speech.get("section_code", ""), debate)
        if found:
            stance, quote = found
            results.extend(Stance(speech["speech_id"], theme, stance, 0.95, "rule", quote) for theme in themes)
            continue
        if not VOTE_SECTIONS.match(speech.get("section_code") or ""):
            continue
        for method, (classify, threshold) in (classifiers or {}).items():
            label, score = classify(text, debate)
            if label in STANCES and score >= threshold:
                quote = last_sentence(text)
                results.extend(Stance(speech["speech_id"], theme, label, round(score, 3), method, quote) for theme in themes)
                break
    return results


def evaluate(results: list[Stance], gold: list[dict]) -> dict:
    """Precision per method: predicted stance equals the hand label of that speech.

    Gold rows carry a ``sample``: ``dev`` rows were used to tune the rules,
    ``holdout`` rows were labelled afterwards and give the unbiased figure.
    """
    labels = {item["speech_id"]: item for item in gold}
    by_method: dict[str, Counter[str]] = defaultdict(Counter)
    wrong: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for item in results:
        key = (item.speech_id, item.method)
        if key in seen or item.speech_id not in labels:
            continue
        seen.add(key)
        label = labels[item.speech_id]
        ok = label["stance"] == item.stance
        sample = label.get("sample", "dev")
        for bucket in ("", f":{sample}"):
            by_method[item.method + bucket]["judged"] += 1
            by_method[item.method + bucket]["correct"] += int(ok)
        if not ok:
            wrong.append({"speech_id": item.speech_id, "method": item.method, "predicted": item.stance, "gold": label["stance"]})

    def score(counts: Counter[str]) -> dict:
        precision = counts["correct"] / counts["judged"] if counts["judged"] else 0.0
        return {"judged": counts["judged"], "precision": round(precision, 3)}

    methods = {}
    for method in sorted(name for name in by_method if ":" not in name):
        row = score(by_method[method])
        row["published"] = row["judged"] >= MIN_JUDGED and row["precision"] >= PUBLISH_PRECISION
        row["bySample"] = {
            name.split(":", 1)[1]: score(counts) for name, counts in sorted(by_method.items()) if name.startswith(f"{method}:")
        }
        methods[method] = row
    return {"threshold": PUBLISH_PRECISION, "minJudged": MIN_JUDGED, "methods": methods, "wrong": wrong}


def published(results: list[Stance], evaluation: dict) -> list[Stance]:
    allowed = {method for method, row in evaluation["methods"].items() if row["published"]}
    return [item for item in results if item.method in allowed]


def load_jsonl(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def write_jsonl(path: Path, rows: Iterable[dict]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--speeches", type=Path, default=DEFAULT_SPEECHES)
    parser.add_argument("--attributions", type=Path, default=DEFAULT_ATTRIBUTIONS)
    parser.add_argument("--gold", type=Path, default=DEFAULT_GOLD)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--nli", action="store_true", help="also run the zero-shot NLI classifier")
    parser.add_argument("--nli-threshold", type=float, default=0.9)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    classifiers: dict[str, tuple[Classifier, float]] = {}
    if args.nli:
        classifiers["nli"] = (nli_classifier(), args.nli_threshold)
    if os.environ.get("STANCE_LLM_URL") and os.environ.get("STANCE_LLM_MODEL"):
        classifiers["llm"] = (
            llm_classifier(os.environ["STANCE_LLM_URL"], os.environ["STANCE_LLM_MODEL"], os.environ.get("STANCE_LLM_KEY", "")),
            0.0,
        )

    results = analyze(load_jsonl(args.speeches), debate_themes(load_jsonl(args.attributions)), classifiers)
    evaluation = evaluate(results, load_jsonl(args.gold))
    evaluation["counts"] = dict(Counter(item.method for item in results))
    evaluation["speeches"] = dict(Counter(item.stance for item in {(r.speech_id, r.stance): r for r in results}.values()))

    args.out_dir.mkdir(parents=True, exist_ok=True)
    write_jsonl(args.out_dir / "candidates.jsonl", (asdict(item) for item in results))
    write_jsonl(args.out_dir / "stances.jsonl", (asdict(item) for item in published(results, evaluation)))
    (args.out_dir / "evaluation.json").write_text(json.dumps(evaluation, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: evaluation[key] for key in ("methods", "counts", "speeches")}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
