"""Attribute dated speeches to political themes.

A speech is linked to a theme in two ways, in this order of trust:

1. ``debate``: the debate it belongs to is about the theme. The agenda item
   title, the question asked (questions au gouvernement) and the legislative
   file of the bill under discussion are matched against the theme's
   ``title_keywords``.
2. ``text``: outside such a debate, the speech itself must mention the theme
   several times (two distinct expressions, or one expression twice), with a
   minimum density, honouring each expression's ``requires``/``excludes``
   words, and its vocabulary must be close to the vocabulary of the debates
   already attributed to the theme (TF-IDF centroid cosine).

A single keyword is never enough: this is what kept attributing a question on
unemployment benefits to "higher education" because the speaker said
"diplômés de l'enseignement supérieur" once.

Longer expressions mask the shorter ones they contain, so "sécurité sociale"
does not also count as "sécurité".
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path

from analyze_project_ngrams import (
    build_party_lookup,
    infer_party_and_name,
    read_speaker_files,
    resolve_party,
    surface_content_tokens,
)
from reference_data import DEFAULT_OPEN_DATA_DIR, ReferenceData, fold


DEFAULT_SPEECHES = Path("extracted_texts/project_full/speeches.jsonl")
DEFAULT_SPEAKER_DIR = Path("extracted_texts/project_full/by_speaker")
DEFAULT_LEXICON = Path("themes/lexicon.json")
DEFAULT_OUTPUT_DIR = Path("analysis_outputs/themes")
CR_URL = "https://www.assemblee-nationale.fr/dyn/17/comptes-rendus/seance/{session}"

RECENT_WEEKS = 4
MIN_DEBATE_TOKENS = 4
# "Diverses dispositions ... en matière économique, énergétique, de transport,
# de santé" lists many themes without being about any of them.
MAX_TITLE_THEMES = 3
MIN_TEXT_TOKENS = 12
MIN_TEXT_HITS = 2
# At least one theme expression per this many content tokens.
TEXT_DENSITY_TOKENS = 200
CENTROID_MIN_TOKENS = 30
CENTROID_MIN_SPEECHES = 20
RELEVANCE_FLOOR = 0.05
RELEVANCE_PERCENTILE = 0.10
EXCERPT_CHARS = 600
THEME_EXCERPTS = 6
POLITICIAN_EXCERPTS = 2


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Attribute speeches to political themes.")
    parser.add_argument("--speeches", type=Path, default=DEFAULT_SPEECHES)
    parser.add_argument("--speaker-dir", type=Path, default=DEFAULT_SPEAKER_DIR)
    parser.add_argument("--lexicon", type=Path, default=DEFAULT_LEXICON)
    parser.add_argument("--open-data", type=Path, default=DEFAULT_OPEN_DATA_DIR)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--no-relevance", action="store_true", help="Skip the TF-IDF relevance check.")
    return parser.parse_args()


def slugify(value: str) -> str:
    return fold(value).replace(" ", "-") or "unknown"


def politician_id(speaker_name: str, party: str) -> str:
    return f"{slugify(speaker_name)}--{slugify(party)}"


def parse_iso_date(value: str) -> date | None:
    try:
        return datetime.strptime(value or "", "%Y-%m-%d").date()
    except ValueError:
        return None


def iso_week_key(value: date) -> str:
    iso = value.isocalendar()
    return f"{iso.year:04d}-W{iso.week:02d}"


def week_start(value: date) -> date:
    return value - timedelta(days=value.weekday())


def load_jsonl(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def cr_url(session_uid: str) -> str:
    return CR_URL.format(session=session_uid) if session_uid else ""


# -- lexicon ---------------------------------------------------------------


@dataclass
class Rule:
    theme: str
    tokens: tuple[str, ...]
    requires: tuple[str, ...] = ()
    excludes: tuple[str, ...] = ()
    weak: bool = False

    @property
    def phrase(self) -> str:
        return " ".join(self.tokens)


@dataclass
class Lexicon:
    domains: list[dict[str, str]]
    themes: list[dict[str, object]]
    title_rules: list[Rule] = field(default_factory=list)
    text_rules: list[Rule] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.parent = {str(theme["id"]): str(theme.get("parent") or "") for theme in self.themes}
        self.title_index = index_rules(self.title_rules)
        self.text_index = index_rules(self.text_rules)
        self.domain_ids = {domain["id"] for domain in self.domains}
        self.weak_phrases = {rule.phrase for rule in self.text_rules if rule.weak}


def _folded_tuple(values: object) -> tuple[str, ...]:
    return tuple(item for item in (fold(str(value)) for value in (values or [])) if item)


def load_lexicon(path: Path) -> Lexicon:
    payload = json.loads(path.read_text(encoding="utf-8"))
    title_rules: list[Rule] = []
    text_rules: list[Rule] = []
    for theme in payload["themes"]:
        theme_id = str(theme["id"])
        weak = {fold(item) for item in theme.get("weak", [])}
        for keyword in theme.get("title_keywords", []):
            tokens = tuple(fold(keyword).split())
            if tokens:
                title_rules.append(Rule(theme_id, tokens))
        for raw in theme.get("aliases", []):
            spec = raw if isinstance(raw, dict) else {"alias": raw}
            tokens = tuple(fold(str(spec["alias"])).split())
            if tokens:
                text_rules.append(Rule(
                    theme_id,
                    tokens,
                    requires=_folded_tuple(spec.get("requires")),
                    excludes=_folded_tuple(spec.get("excludes")),
                    weak=" ".join(tokens) in weak,
                ))
    return Lexicon(
        domains=list(payload.get("domains", [])),
        themes=list(payload["themes"]),
        title_rules=title_rules,
        text_rules=text_rules,
    )


def index_rules(rules: list[Rule]) -> dict[str, list[Rule]]:
    index: dict[str, list[Rule]] = defaultdict(list)
    for rule in rules:
        index[rule.tokens[0]].append(rule)
    return index


def contains_phrase(padded_text: str, phrase: str) -> bool:
    return f" {phrase} " in padded_text


def find_matches(tokens: list[str], index: dict[str, list[Rule]]) -> list[tuple[int, int, Rule]]:
    """Non-overlapping rule matches; the longest expression wins a span."""
    candidates: list[tuple[int, int, Rule]] = []
    for start, token in enumerate(tokens):
        for rule in index.get(token, ()):
            end = start + len(rule.tokens)
            if tuple(tokens[start:end]) == rule.tokens:
                candidates.append((start, end, rule))
    candidates.sort(key=lambda item: (-(item[1] - item[0]), item[0]))
    taken = [False] * len(tokens)
    accepted: list[tuple[int, int, Rule]] = []
    for start, end, rule in candidates:
        if any(taken[start:end]):
            continue
        for position in range(start, end):
            taken[position] = True
        accepted.append((start, end, rule))
    accepted.sort(key=lambda item: item[0])
    return accepted


def rule_applies(rule: Rule, padded_text: str) -> bool:
    if rule.requires and not any(contains_phrase(padded_text, item) for item in rule.requires):
        return False
    return not any(contains_phrase(padded_text, item) for item in rule.excludes)


def title_themes(title: str, lexicon: Lexicon) -> list[str]:
    """Themes named by a debate title; omnibus titles name none."""
    tokens = fold(title).split()
    found: list[str] = []
    for _start, _end, rule in find_matches(tokens, lexicon.title_index):
        if rule.theme not in found:
            found.append(rule.theme)
    return found if len(found) <= MAX_TITLE_THEMES else []


def text_hits(text: str, lexicon: Lexicon) -> dict[str, Counter[str]]:
    """Per theme, how many times each expression occurs in ``text``."""
    folded = fold(text)
    padded = f" {folded} "
    hits: dict[str, Counter[str]] = defaultdict(Counter)
    for _start, _end, rule in find_matches(folded.split(), lexicon.text_index):
        if rule_applies(rule, padded):
            hits[rule.theme][rule.phrase] += 1
    return hits


def passes_text_rule(hits: Counter[str], content_token_count: int, weak: set[str] = frozenset()) -> bool:
    """Two distinct expressions, or one repeated (three times for a single word).

    ``weak`` expressions name actors cited in passing ("maires", "loi de
    finances"): they add to the density but at least one other is required.
    """
    total = sum(hits.values())
    if content_token_count < MIN_TEXT_TOKENS or not hits:
        return False
    if all(phrase in weak for phrase in hits):
        return False
    if len(hits) == 1:
        (phrase,) = hits
        needed = MIN_TEXT_HITS if " " in phrase else MIN_TEXT_HITS + 1
        if total < needed:
            return False
    return total * TEXT_DENSITY_TOKENS >= content_token_count


# -- excerpts --------------------------------------------------------------


def paragraphs(text: str) -> list[str]:
    parts = [re.sub(r"\s+", " ", part).strip() for part in re.split(r"\n\s*\n|\n", text or "")]
    return [part for part in parts if part]


def trim_paragraph(paragraph: str, limit: int = EXCERPT_CHARS) -> str:
    if len(paragraph) <= limit:
        return paragraph
    cut = paragraph[:limit]
    boundary = max(cut.rfind(". "), cut.rfind("? "), cut.rfind("! "))
    if boundary >= limit // 2:
        return cut[: boundary + 1]
    return cut.rsplit(" ", 1)[0] + "…"


def best_paragraph(text: str, phrases: list[str]) -> tuple[int, str]:
    """Index and text of the paragraph that talks the most about the theme."""
    parts = paragraphs(text)
    if not parts:
        return 0, ""
    best_index, best_score = 0, (-1, 0)
    for index, part in enumerate(parts):
        padded = f" {fold(part)} "
        score = sum(padded.count(f" {phrase} ") for phrase in phrases)
        rank = (score, min(len(part), EXCERPT_CHARS))
        if rank > best_score:
            best_index, best_score = index, rank
    return best_index, trim_paragraph(parts[best_index])


# -- relevance -------------------------------------------------------------


class Relevance:
    """Cosine between a speech and the TF-IDF centroid of a theme's debates."""

    def __init__(self, documents: list[str]) -> None:
        from sklearn.feature_extraction.text import TfidfVectorizer

        self.vectorizer = TfidfVectorizer(
            min_df=3,
            max_df=0.5,
            sublinear_tf=True,
            max_features=60000,
            token_pattern=r"\S+",
        )
        self.matrix = self.vectorizer.fit_transform(documents)
        self.centroids: dict[str, object] = {}
        self.thresholds: dict[str, float] = {}

    def fit_theme(self, theme_id: str, rows: list[int]) -> None:
        import numpy as np

        if len(rows) < CENTROID_MIN_SPEECHES:
            return
        centroid = np.asarray(self.matrix[rows].mean(axis=0)).ravel()
        norm = float(np.linalg.norm(centroid))
        if not norm:
            return
        centroid /= norm
        scores = np.sort(self.matrix[rows] @ centroid)
        cutoff = float(scores[int(len(scores) * RELEVANCE_PERCENTILE)])
        self.centroids[theme_id] = centroid
        self.thresholds[theme_id] = max(RELEVANCE_FLOOR, cutoff)

    def score(self, theme_id: str, row: int) -> float | None:
        centroid = self.centroids.get(theme_id)
        if centroid is None:
            return None
        return float((self.matrix[row] @ centroid)[0])

    def accepts(self, theme_id: str, row: int) -> tuple[bool, float | None]:
        value = self.score(theme_id, row)
        if value is None:
            return True, None
        return value >= self.thresholds[theme_id], value


def build_relevance(documents: list[str], debate_rows: dict[str, list[int]]) -> Relevance | None:
    try:
        relevance = Relevance(documents)
    except (ImportError, ValueError):
        return None
    for theme_id, rows in debate_rows.items():
        relevance.fit_theme(theme_id, rows)
    return relevance


# -- speakers --------------------------------------------------------------


def speaker_resolver(speaker_dir: Path):
    speaker_files = read_speaker_files(speaker_dir) if speaker_dir.is_dir() else []
    party_lookup = build_party_lookup(speaker_files) if speaker_files else {}

    def resolve(raw: dict[str, str]) -> tuple[str, str]:
        party, name, _source = resolve_party(raw["speaker_slug"], party_lookup)
        if party == "UNLABELED":
            inferred_party, name = infer_party_and_name(raw["speaker_slug"])
            party = party_lookup.get(name, inferred_party)
        return party, name

    return resolve


# -- attribution -----------------------------------------------------------


@dataclass
class Speech:
    raw: dict[str, str]
    party: str
    speaker: str
    person_id: str
    day: date | None
    content: list[str]
    debate_title: str
    dossier_title: str
    dossier_domain: str
    debate_themes: list[str]
    hits: dict[str, Counter[str]]


TITLE_STOPWORDS = {
    "projet", "proposition", "relative", "relatif", "visant", "portant", "diverses", "dispositions",
    "pour", "dans", "avec", "sans", "leur", "leurs", "entre", "article", "articles", "suite", "matiere",
    "nouvelle", "lecture", "texte", "commission", "mixte", "paritaire", "resolution", "discussion",
}


def title_words(text: str) -> set[str]:
    return {word for word in fold(text).split() if len(word) >= 4 and word not in TITLE_STOPWORDS}


def dossier_matches_title(dossier, title: str) -> bool:
    """Guard against wrong bill numbers: the dossier must share the debate's words."""
    words = title_words(title)
    if not words:
        return True
    dossier_words = title_words(" ".join([dossier.title, *dossier.document_titles[:5]]))
    shared = len(words & dossier_words)
    return shared >= 2 or (len(words) <= 2 and shared >= 1)


def find_dossier(raw: dict[str, str], reference: ReferenceData):
    point_title = raw.get("point_title", "")
    dossier = reference.dossier_for_bill(raw.get("bill_number", ""))
    if dossier and dossier_matches_title(dossier, point_title):
        return dossier
    return reference.dossier_for_title(point_title)


def debate_title_for(raw: dict[str, str]) -> str:
    return raw.get("debate_topic") or raw.get("point_title") or ""


def prepare_speeches(
    speeches: list[dict[str, str]],
    lexicon: Lexicon,
    reference: ReferenceData,
    resolve,
) -> list[Speech]:
    title_cache: dict[tuple[str, str, str], tuple[list[str], str, str]] = {}
    prepared: list[Speech] = []
    for raw in speeches:
        party, name = resolve(raw)
        title = debate_title_for(raw)
        key = (title, raw.get("point_title", ""), raw.get("bill_number", ""))
        if key not in title_cache:
            dossier = find_dossier(raw, reference)
            haystack = " | ".join(
                part
                for part in (title, raw.get("point_title", ""), dossier.title if dossier else "")
                if part
            )
            title_cache[key] = (
                title_themes(haystack, lexicon),
                dossier.title if dossier else "",
                dossier.domain if dossier else "",
            )
        themes, dossier_title, dossier_domain = title_cache[key]
        prepared.append(Speech(
            raw=raw,
            party=party,
            speaker=name,
            person_id=politician_id(name, party),
            day=parse_iso_date(raw.get("date", "")),
            content=surface_content_tokens(raw.get("normalized_text") or ""),
            debate_title=title,
            dossier_title=dossier_title,
            dossier_domain=dossier_domain,
            debate_themes=themes,
            hits=text_hits(raw.get("text", ""), lexicon),
        ))
    return prepared


def attribute(
    speeches: list[Speech],
    lexicon: Lexicon,
    use_relevance: bool = True,
) -> list[dict[str, object]]:
    debate_rows: dict[str, list[int]] = defaultdict(list)
    for row, speech in enumerate(speeches):
        if len(speech.content) >= CENTROID_MIN_TOKENS:
            for theme_id in speech.debate_themes:
                debate_rows[theme_id].append(row)
    relevance = None
    if use_relevance:
        relevance = build_relevance([" ".join(speech.content) for speech in speeches], debate_rows)

    phrases_by_theme: dict[str, list[str]] = defaultdict(list)
    for rule in lexicon.text_rules + lexicon.title_rules:
        phrases_by_theme[rule.theme].append(rule.phrase)

    attributions: list[dict[str, object]] = []
    for row, speech in enumerate(speeches):
        chosen: dict[str, tuple[str, float | None]] = {}
        if len(speech.content) >= MIN_DEBATE_TOKENS:
            for theme_id in speech.debate_themes:
                chosen[theme_id] = ("debate", relevance.score(theme_id, row) if relevance else None)
        for theme_id, hits in speech.hits.items():
            if theme_id in chosen or not passes_text_rule(hits, len(speech.content), lexicon.weak_phrases):
                continue
            accepted, score = relevance.accepts(theme_id, row) if relevance else (True, None)
            if accepted:
                chosen[theme_id] = ("text", score)

        domains = {lexicon.parent.get(theme_id, "") for theme_id in chosen} - {""}
        if speech.dossier_domain and len(speech.content) >= MIN_DEBATE_TOKENS:
            domains.add(speech.dossier_domain)

        base = {
            "speech_id": speech.raw["speech_id"],
            "date": speech.raw.get("date", ""),
            "session_uid": speech.raw.get("session_uid", ""),
            "acteur_id": speech.raw.get("acteur_id", ""),
            "politician_id": speech.person_id,
            "speaker": speech.speaker,
            "party": speech.party,
            "debate_title": speech.debate_title,
            "dossier_title": speech.dossier_title,
        }
        for theme_id, (method, score) in chosen.items():
            terms = sorted(speech.hits.get(theme_id, {}), key=lambda item: -speech.hits[theme_id][item])
            paragraph_index, excerpt = best_paragraph(speech.raw.get("text", ""), phrases_by_theme[theme_id])
            attributions.append({
                **base,
                "theme_id": theme_id,
                "domain_id": lexicon.parent.get(theme_id, ""),
                "method": method,
                "relevance": round(score, 4) if score is not None else None,
                "terms": terms,
                "paragraph": paragraph_index,
                "excerpt": excerpt,
            })
        for domain_id in sorted(domains):
            attributions.append({
                **base,
                "theme_id": domain_id,
                "domain_id": domain_id,
                "method": "domain",
                "relevance": None,
                "terms": [],
                "paragraph": 0,
                "excerpt": "",
            })
    return attributions


# -- aggregation -----------------------------------------------------------


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


def excerpt_record(item: dict[str, object]) -> dict[str, object]:
    return {
        "speechId": item["speech_id"],
        "politicianId": item["politician_id"],
        "speaker": item["speaker"],
        "party": item["party"],
        "date": item["date"],
        "snippet": item["excerpt"],
        "debate": item["debate_title"],
        "dossier": item["dossier_title"],
        "method": item["method"],
        "url": cr_url(str(item["session_uid"])),
    }


def excerpt_rank(item: dict[str, object]) -> tuple:
    return (
        item["method"] == "debate",
        len(item["terms"]),  # type: ignore[arg-type]
        float(item["relevance"] or 0),
        min(len(str(item["excerpt"])), EXCERPT_CHARS),
        str(item["date"]),
    )


def pick_theme_excerpts(items: list[dict[str, object]], limit: int = THEME_EXCERPTS) -> list[dict[str, object]]:
    selected: list[dict[str, object]] = []
    parties: set[str] = set()
    speakers: set[str] = set()
    ranked = sorted((item for item in items if len(str(item["excerpt"])) >= 80), key=excerpt_rank, reverse=True)
    for item in ranked:
        if item["party"] in parties or item["politician_id"] in speakers:
            continue
        selected.append(item)
        parties.add(str(item["party"]))
        speakers.add(str(item["politician_id"]))
        if len(selected) >= limit:
            break
    return [excerpt_record(item) for item in selected]


def build_bundle(
    speeches: list[Speech],
    attributions: list[dict[str, object]],
    lexicon: Lexicon,
) -> dict[str, object]:
    party_totals: Counter[str] = Counter(speech.party for speech in speeches)
    person_totals: Counter[str] = Counter(speech.person_id for speech in speeches)
    corpus_total = len(speeches)
    max_date = max((speech.day for speech in speeches if speech.day), default=None)

    by_theme: dict[str, list[dict[str, object]]] = defaultdict(list)
    for item in attributions:
        by_theme[str(item["theme_id"])].append(item)

    entries = [
        {"id": domain["id"], "label": domain["label"], "type": "domain", "parent": None, "committee": domain.get("committee", "")}
        for domain in lexicon.domains
    ] + [
        {"id": theme["id"], "label": theme["label"], "type": "theme", "parent": theme.get("parent")}
        for theme in lexicon.themes
    ]

    catalog: list[dict[str, object]] = []
    ownership: dict[str, list[dict[str, object]]] = {}
    series: dict[str, dict[str, list[dict[str, object]]]] = {}
    excerpts: dict[str, list[dict[str, object]]] = {}
    person_scores: dict[str, dict[str, dict[str, object]]] = defaultdict(dict)
    person_excerpts: dict[str, dict[str, list[dict[str, object]]]] = defaultdict(dict)

    for entry in entries:
        theme_id = str(entry["id"])
        items = sorted(by_theme.get(theme_id, []), key=lambda item: (str(item["date"]), str(item["speech_id"])))
        dates = [day for day in (parse_iso_date(str(item["date"])) for item in items) if day]
        party_counts = Counter(str(item["party"]) for item in items)
        method_counts = Counter(str(item["method"]) for item in items)
        people: dict[str, list[dict[str, object]]] = defaultdict(list)
        for item in items:
            people[str(item["politician_id"])].append(item)

        catalog.append({
            **entry,
            "firstDate": dates[0].isoformat() if dates else "",
            "lastDate": dates[-1].isoformat() if dates else "",
            "trend": trend_label(dates, max_date),
            "speechCount": len(items),
            "debateCount": method_counts["debate"],
            "textCount": method_counts["text"],
            "politicianCount": len(people),
            "openerParty": str(items[0]["party"]) if items else "",
        })

        rows = []
        for party, count in party_counts.items():
            corpus_share = party_totals[party] / corpus_total if corpus_total else 0
            theme_share = count / len(items) if items else 0
            rows.append({"party": party, "speechCount": count, "lift": theme_share / corpus_share if corpus_share else 0})
        rows.sort(key=lambda item: (-float(item["speechCount"]), str(item["party"])))
        ownership[theme_id] = rows

        weekly: dict[str, Counter[str]] = defaultdict(Counter)
        for item in items:
            day = parse_iso_date(str(item["date"]))
            if day:
                weekly[iso_week_key(day)][str(item["party"])] += 1
        party_series: dict[str, list[dict[str, object]]] = defaultdict(list)
        for week in sorted(weekly):
            week_total = sum(weekly[week].values())
            for party, count in sorted(weekly[week].items()):
                party_series[party].append({"week": week, "speechCount": count, "share": count / week_total})
        series[theme_id] = dict(party_series)

        excerpts[theme_id] = pick_theme_excerpts(items)

        for person_id, person_items in people.items():
            person_dates = sorted(str(item["date"]) for item in person_items if item["date"])
            person_scores[person_id][theme_id] = {
                "speechCount": len(person_items),
                "share": len(person_items) / person_totals[person_id] if person_totals[person_id] else 0,
                "firstDate": person_dates[0] if person_dates else "",
                "lastDate": person_dates[-1] if person_dates else "",
            }
            if entry["type"] == "theme":
                ranked = sorted(
                    (item for item in person_items if item["excerpt"]),
                    key=excerpt_rank,
                    reverse=True,
                )
                person_excerpts[person_id][theme_id] = [excerpt_record(item) for item in ranked[:POLITICIAN_EXCERPTS]]

    return {
        "themes": catalog,
        "politicianThemeScores": dict(person_scores),
        "partyThemeSeries": series,
        "themeOwnership": ownership,
        "themeExcerpts": excerpts,
        "politicianThemeExcerpts": dict(person_excerpts),
        "summary": {
            "speechCount": corpus_total,
            "themeCount": sum(1 for item in catalog if item["type"] == "theme"),
            "domainCount": sum(1 for item in catalog if item["type"] == "domain"),
            "attributionCount": sum(1 for item in attributions if item["method"] != "domain"),
            "debateAttributions": sum(1 for item in attributions if item["method"] == "debate"),
            "textAttributions": sum(1 for item in attributions if item["method"] == "text"),
        },
    }


def run(
    raw_speeches: list[dict[str, str]],
    lexicon: Lexicon,
    speaker_dir: Path,
    open_data: Path = DEFAULT_OPEN_DATA_DIR,
    use_relevance: bool = True,
) -> tuple[dict[str, object], list[dict[str, object]]]:
    reference = ReferenceData(open_data)
    speeches = prepare_speeches(raw_speeches, lexicon, reference, speaker_resolver(speaker_dir))
    attributions = attribute(speeches, lexicon, use_relevance=use_relevance)
    return build_bundle(speeches, attributions, lexicon), attributions


def write_outputs(bundle: dict[str, object], attributions: list[dict[str, object]], out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "themes_bundle.json"
    path.write_text(json.dumps(bundle, ensure_ascii=False) + "\n", encoding="utf-8")
    with (out_dir / "attributions.jsonl").open("w", encoding="utf-8") as handle:
        for item in attributions:
            handle.write(json.dumps(item, ensure_ascii=False) + "\n")
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

    bundle, attributions = run(
        load_jsonl(args.speeches),
        load_lexicon(args.lexicon),
        args.speaker_dir,
        args.open_data,
        use_relevance=not args.no_relevance,
    )
    path = write_outputs(bundle, attributions, args.out_dir)
    summary = bundle["summary"]
    print(
        f"Wrote {summary['themeCount']} themes in {summary['domainCount']} domains: "
        f"{summary['debateAttributions']} by debate, {summary['textAttributions']} by text, "
        f"from {summary['speechCount']} speeches to {path}"
    )


if __name__ == "__main__":
    main()
