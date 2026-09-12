"""Parliamentary address and negation detectors for dashboard markers."""

from __future__ import annotations

ADDRESS_CIVILITY = {"madame", "mesdames", "messieurs", "monsieur"}
ADDRESS_ARTICLES = {"l", "la", "le"}
ADDRESS_TITLES = {
    "ministre",
    "president",
    "presidente",
    "président",
    "présidente",
    "rapporteur",
    "rapporteure",
}
ADDRESS_DEAR = {"cher", "chere", "chers", "chère"}
ADDRESS_COLLEAGUE = {"collegue", "collegues", "collègue", "collègues"}
ADDRESS_POSSESSIVE = {"mon", "notre"}

NEGATION_START = {"n", "ne"}
NEGATION_END = {"aucun", "jamais", "pas", "rien"}
COMPARATIVE_AFTER_PLUS = {"d", "de", "que"}
STANDALONE_NEGATION = {"aucun", "jamais"}
STANDALONE_NEGATION_PREV = {"beaucoup", "bien", "de", "des", "du", "la", "le", "les"}

PROCEDURE_TERMS = {
    "amendement",
    "amendements",
    "article",
    "avis",
    "commission",
    "gouvernement",
    "loi",
    "projet",
    "rapport",
    "scrutin",
    "seance",
    "séance",
    "texte",
}
STANCE_TERMS = {
    "crois",
    "demande",
    "demandons",
    "devons",
    "doit",
    "faut",
    "pense",
    "propose",
    "proposons",
    "refuse",
    "souhaite",
    "voter",
    "votons",
}
PRONOUN_TERMS = {"j", "je", "nos", "notre", "nous", "vos", "votre", "vous"}

MARKER_ORDER = ("address", "negation", "procedure", "stance", "pronoun")


def marker_tokens(line: str) -> list[str]:
    return [token for token in line.split() if token]


def find_address_phrases(tokens: list[str]) -> list[str]:
    phrases: list[str] = []
    index = 0
    length = len(tokens)
    while index < length:
        token = tokens[index]
        if token in ADDRESS_DEAR and index + 1 < length and tokens[index + 1] in ADDRESS_COLLEAGUE:
            phrases.append(f"{token} {tokens[index + 1]}")
            index += 2
            continue
        if token in ADDRESS_POSSESSIVE and index + 1 < length and tokens[index + 1] in ADDRESS_COLLEAGUE:
            phrases.append(f"{token} {tokens[index + 1]}")
            index += 2
            continue
        if token in ADDRESS_CIVILITY:
            cursor = index + 1
            if cursor < length and tokens[cursor] in ADDRESS_ARTICLES:
                cursor += 1
            if cursor < length and tokens[cursor] in ADDRESS_TITLES:
                phrases.append(" ".join(tokens[index : cursor + 1]))
                index = cursor + 1
                continue
        index += 1
    return phrases


def find_negation_phrases(tokens: list[str]) -> list[str]:
    phrases: list[str] = []
    index = 0
    length = len(tokens)
    while index < length:
        token = tokens[index]
        if token in NEGATION_START:
            for offset in range(1, 5):
                end = index + offset
                if end >= length:
                    break
                candidate = tokens[end]
                if candidate in NEGATION_END:
                    phrases.append(" ".join(tokens[index : end + 1]))
                    break
                if candidate == "plus":
                    following = tokens[end + 1] if end + 1 < length else ""
                    if following not in COMPARATIVE_AFTER_PLUS:
                        phrases.append(" ".join(tokens[index : end + 1]))
                    break
            index += 1
            continue
        if token in STANDALONE_NEGATION:
            previous = tokens[index - 1] if index else ""
            if previous not in STANDALONE_NEGATION_PREV:
                end = index + 2 if index + 1 < length else index + 1
                phrases.append(" ".join(tokens[index:end]))
        index += 1
    return phrases


def classify_marker(tokens: list[str]) -> str | None:
    token_set = set(tokens)
    if token_set & PROCEDURE_TERMS:
        return "procedure"
    if token_set & STANCE_TERMS:
        return "stance"
    if token_set & PRONOUN_TERMS:
        return "pronoun"
    return None


def rate_per_thousand(count: int, token_count: int) -> float:
    if token_count <= 0:
        return 0.0
    return (count * 1000.0) / token_count
