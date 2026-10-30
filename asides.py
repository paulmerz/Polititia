"""Interruptions, room reactions, wording rates and named colleagues.

Interruptions and stage directions are kept out of the speech text. What is
shown later is a count or a repeated line, with the same bar for every deputy.
"""

from __future__ import annotations

import re

from reference_data import fold
from speakers import COLLECTIVE_SPEAKER_RE
from speech_markers import find_negation_phrases


FAVORITE_MIN_WORDS = 2
FAVORITE_MAX_WORDS = 15
PRESIDENTIAL_PREFIXES = (
    "M. le président",
    "Mme la présidente",
    "M. le vice-président",
    "Mme la vice-présidente",
)
PROCEDURAL_RE = re.compile(
    r"\b(demande la parole|s il vous plait|s il vous plaît|veuillez|je retire mon)\b"
)
ADDRESS_ONLY_RE = re.compile(
    r"^(monsieur|madame|m|mme)( le| la)? (président|présidente|president|presidente|ministre)"
    r"( de la commission)?$"
)
REACTION_KINDS = (
    ("rire", re.compile(r"\brires?\b", re.I)),
    ("applaudissement", re.compile(r"applaud", re.I)),
    ("protestation", re.compile(r"protest", re.I)),
    ("exclamation", re.compile(r"exclam", re.I)),
)
OBLIGATION = {"doit", "doivent", "devons", "devez", "faut"}
POSSIBILITY = {"peut", "peux", "peuvent", "pouvons", "pouvez", "pourra", "pourront"}
CIVILITY_TOKENS = {"m", "mme", "mlle", "mr", "monsieur", "madame"}
PARTICLES = {"de", "du", "des", "d", "le", "la", "von", "van"}
SURNAME_STOP = {"president", "presidente", "ministre", "depute", "deputee", "groupe", "seance"}
MENTION_PREFIXES = ("monsieur ", "madame ", "mme ", "m ")
STYLE_FIELDS = ("words", "negation", "obligation", "possibility", "je", "nous", "vous")


def normalize_line(text: str) -> str:
    from extract_speeches import normalize_for_ngrams

    return normalize_for_ngrams(text)


def is_presidential(speaker: str) -> bool:
    return any(speaker == prefix or speaker.startswith(f"{prefix} ") for prefix in PRESIDENTIAL_PREFIXES)


def is_procedural(norm: str) -> bool:
    return bool(PROCEDURAL_RE.search(norm) or ADDRESS_ONLY_RE.fullmatch(norm))


def eligible_favorite(speaker: str, text: str) -> bool:
    """A short, named, non-procedural interruption. Repetition is checked later."""
    if is_presidential(speaker) or COLLECTIVE_SPEAKER_RE.match(speaker or ""):
        return False
    words = normalize_line(text).split()
    if not (FAVORITE_MIN_WORDS <= len(words) <= FAVORITE_MAX_WORDS):
        return False
    return not is_procedural(normalize_line(text))


def reaction_kind(detail: str) -> str:
    for kind, pattern in REACTION_KINDS:
        if pattern.search(detail):
            return kind
    return ""


def other_bench(detail: str) -> bool:
    """Applause or protest that the transcript does not limit to one group's benches."""
    text = fold(detail)
    if "divers banc" in text or "tous les bancs" in text:
        return True
    return len(re.findall(r"\bgroupes?\b", text)) >= 2 or bool(re.search(r"\bgroupes?\b.+\bet\b", text))


def last_sentence(text: str) -> str:
    parts = [part.strip() for part in re.split(r"(?<=[.!?])\s+", text.strip()) if part.strip()]
    return parts[-1] if parts else ""


def style_counts(text: str) -> dict[str, int]:
    tokens = normalize_line(text).split()
    possibility = 0
    for index, token in enumerate(tokens):
        if token in POSSIBILITY and not (token == "peut" and index + 1 < len(tokens) and tokens[index + 1] == "être"):
            possibility += 1
    return {
        "words": len(tokens),
        "negation": len(find_negation_phrases(tokens)),
        "obligation": sum(1 for token in tokens if token in OBLIGATION),
        "possibility": possibility,
        "je": sum(1 for token in tokens if token in {"je", "j"}),
        "nous": tokens.count("nous"),
        "vous": tokens.count("vous"),
    }


def surname_key(name: str) -> str:
    raw = fold(name).split()
    tokens = raw[1:] if raw and raw[0] in CIVILITY_TOKENS else raw
    if not tokens:
        return ""
    end = [tokens[-1]]
    if len(tokens) >= 2 and tokens[-2] in PARTICLES:
        end.insert(0, tokens[-2])
    if len(tokens) >= 3 and tokens[-3] in PARTICLES and tokens[-2] in PARTICLES:
        end = tokens[-3:]
    key = " ".join(end)
    compact = key.replace(" ", "")
    if len(compact) < 4 or key in SURNAME_STOP or not re.fullmatch(r"[a-z]+(?: [a-z]+)?", key):
        return ""
    return key


def surname_index(people: list[tuple[int, str]]) -> dict[str, int]:
    found: dict[str, list[int]] = {}
    for pid, name in people:
        key = surname_key(name)
        if key:
            found.setdefault(key, []).append(pid)
    return {key: pids[0] for key, pids in found.items() if len(set(pids)) == 1}


def _sentence_with(text: str, surname: str) -> str:
    parts = [part.strip() for part in re.split(r"(?<=[.!?])\s+", text.strip()) if part.strip()] or [text.strip()]
    pattern = re.compile(rf"\b{re.escape(surname)}\b")
    for part in parts:
        if pattern.search(fold(part)):
            return re.sub(r"\s+", " ", part).strip()[:240]
    return re.sub(r"\s+", " ", text).strip()[:240]


def find_mentions(text: str, surnames: dict[str, int], speaker_pid: int) -> list[tuple[int, str]]:
    """« Monsieur / Madame + nom » pointing at one other deputy."""
    folded = f" {fold(normalize_line(text))} "
    hits: list[tuple[int, str]] = []
    for surname, pid in surnames.items():
        if pid == speaker_pid:
            continue
        if any(f" {prefix}{surname} " in folded for prefix in MENTION_PREFIXES):
            hits.append((pid, _sentence_with(text, surname)))
    return hits
