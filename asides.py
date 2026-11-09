"""Interruptions, applause, wording rates and named colleagues.

Interruptions and stage directions are kept out of the speech text. What is
shown later is a count or a repeated line, with the same bar for every deputy.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field

from reference_data import GROUP_CODES, NON_INSCRITS, fold
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
OBLIGATION = {"doit", "doivent", "devons", "devez", "faut"}
POSSIBILITY = {"peut", "peux", "peuvent", "pouvons", "pouvez", "pourra", "pourront"}
STYLE_FIELDS = ("words", "negation", "obligation", "possibility", "je", "nous", "vous")

# A quote is cut around what matters (the name, the end of the applauded
# sentence) rather than at a fixed length.
EXCERPT_LIMIT = 240
# "M. Barnier." is not the end of a sentence.
ABBREVIATIONS = {"m", "mm", "mme", "mmes", "mlle", "mlles", "me", "dr", "pr", "st", "ste", "art", "al", "cf", "no", "vol"}
SENTENCE_END_RE = re.compile(r"[.!?…]+(?:[\s  ]*[»”)\]])*(?=\s|$)")
WORD_BEFORE_RE = re.compile(r"([^\W\d_]+)$")
TOKEN_RE = re.compile(r"[a-z0-9]+")

# Who is named: « Mme Panot », « monsieur Barnier » or « Laurent Wauquiez ».
CIVILITIES = {"m": "m", "monsieur": "m", "mme": "f", "madame": "f", "mlle": "f", "mademoiselle": "f"}
PARTICLES = {"de", "du", "des", "d", "le", "la", "von", "van"}
SURNAME_STOP = {"president", "presidente", "ministre", "depute", "deputee", "deputes", "deputees", "membres", "groupe", "seance"}
MIN_SURNAME_LETTERS = 4

# Applause, by group. The camps are the electoral alliances of June 2024:
# applause from another group of the same alliance stays "in camp".
CAMPS = {
    "LFI_NFP": "NFP",
    "SOC": "NFP",
    "EcoS": "NFP",
    "GDR": "NFP",
    "EPR": "Ensemble",
    "Dem": "Ensemble",
    "HOR": "Ensemble",
    "RN": "RN-UDR",
    "UDR": "RN-UDR",
    "DR": "DR",
    "LIOT": "LIOT",
    NON_INSCRITS: NON_INSCRITS,
}
GROUP_LABEL_RE = re.compile(r"(?<![\w-])(" + "|".join(sorted(map(re.escape, GROUP_CODES), key=len, reverse=True)) + r")(?![\w-])")
NON_INSCRITS_RE = re.compile(r"\bnon[- ]inscrits?\b", re.I)
EVERY_BENCH_RE = re.compile(r"\bsur tous les bancs\b", re.I)
# "sur divers bancs", with no group named: at least one other camp.
UNNAMED_BENCHES_RE = re.compile(r"\bsur (?:divers|de nombreux) bancs\b(?!\s+d(?:u|es)\s+groupes?)", re.I)
# « – » and « ; » separate reactions, with or without spaces (« –Exclamations »).
DIRECTION_PART_RE = re.compile(r"\s*[–—;]\s*")
REACTION_WORD_RE = re.compile(
    r"(?P<applause_noun>\bapplaudissements?\b)"
    r"|(?P<applause_verb>\bapplaudi(?:t|ssent|r|ssant)\b)"
    r"|(?P<other_noun>\b(?:exclamations?|protestations?|murmures?|rires?|sourires?|huées?|brouhaha)\b)"
    r"|(?P<other_verb>\b(?:huent|hue|protestent|proteste|s[’']exclament|s[’']exclame|désignent|désigne|pointent|interpellent|scandent"
    r"|quittent|se tournent|se tourne|se tournant|tournés?|tournées?)\b)"
    r"|(?P<target>\b(?:vers|en direction d|à l[’']adresse d|à l[’']intention d)\w*)",
    re.I,
)
APPLAUSE_WORDS = {"applause_noun", "applause_verb"}
NOUN_WORDS = {"applause_noun", "other_noun"}
BENCHES_RE = re.compile(r"\b(?:bancs?|groupes?)\b", re.I)


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


# -- sentences and excerpts ---------------------------------------------------


def sentence_spans(text: str) -> list[tuple[int, int]]:
    """(start, end) of each sentence; an abbreviation or an initial does not end one."""
    spans: list[tuple[int, int]] = []
    start = 0
    for match in SENTENCE_END_RE.finditer(text):
        if match.group(0).startswith(".") and not match.group(0).startswith(".."):
            before = WORD_BEFORE_RE.search(text, max(0, match.start() - 20), match.start())
            word = before.group(1) if before else ""
            if word.lower() in ABBREVIATIONS or (len(word) == 1 and word.isupper()):
                continue
        if text[start:match.end()].strip():
            spans.append((start, match.end()))
        start = match.end()
    if text[start:].strip():
        spans.append((start, len(text)))
    return [_trim(text, begin, end) for begin, end in spans]


def _trim(text: str, start: int, end: int) -> tuple[int, int]:
    while start < end and text[start].isspace():
        start += 1
    while end > start and text[end - 1].isspace():
        end -= 1
    return start, end


def _squash(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _cut(text: str, left: int, right: int, start: int, end: int) -> str:
    """text[left:right] on word boundaries, with « … » where it was cut."""
    if left > start:
        space = re.search(r"\s", text[left:])
        if space and left + space.end() < right:
            left += space.end()
    if right < end:
        spaces = [match.start() for match in re.finditer(r"\s", text[left:right])]
        if spaces:
            right = left + spaces[-1]
    piece = _squash(text[left:right])
    return f"{'…' if left > start else ''}{piece}{'…' if right < end else ''}"


def excerpt_around(text: str, start: int, end: int, limit: int = EXCERPT_LIMIT) -> str:
    """The sentence holding text[start:end], cut around it when the sentence is long."""
    begin, finish = 0, len(text)
    for span in sentence_spans(text):
        if span[0] <= start < span[1]:
            begin, finish = span
            break
    if len(_squash(text[begin:finish])) <= limit:
        return _squash(text[begin:finish])
    room = max(limit - (end - start), 0)
    left = max(begin, start - room // 2)
    right = min(finish, left + limit)
    left = max(begin, right - limit)
    return _cut(text, left, right, begin, finish)


def last_sentence(text: str, limit: int = EXCERPT_LIMIT) -> str:
    """The sentence a stage direction follows, keeping its end when it is long."""
    spans = sentence_spans(text)
    if not spans:
        return ""
    begin, finish = spans[-1]
    if len(_squash(text[begin:finish])) <= limit:
        return _squash(text[begin:finish])
    return _cut(text, max(begin, finish - limit), finish, begin, finish)


# -- named colleagues ---------------------------------------------------------


def _fold_char(char: str) -> str:
    for piece in unicodedata.normalize("NFKD", char):
        if unicodedata.combining(piece):
            continue
        piece = piece.lower()
        return piece if len(piece) == 1 and ("a" <= piece <= "z" or "0" <= piece <= "9") else " "
    return " "


class _FoldTable(dict):
    def __missing__(self, code: int) -> str:
        value = self[code] = _fold_char(chr(code))
        return value


_FOLD_TABLE = _FoldTable()


def fold_aligned(text: str) -> str:
    """reference_data.fold without collapsing spaces: one character out per character in."""
    return text.translate(_FOLD_TABLE)


def split_name(name: str) -> tuple[str, str, str]:
    """(civility, first name, surname) from « Mme Marine Le Pen »; particles stay with the surname."""
    words = name.split()
    civility = ""
    if words and fold(words[0]) in CIVILITIES:
        civility, words = words[0], words[1:]
    if not words:
        return civility, "", ""
    cut = len(words) - 1
    while cut > 1 and fold(words[cut - 1]) in PARTICLES:
        cut -= 1
    return civility, " ".join(words[:cut]), " ".join(words[cut:])


@dataclass
class MentionIndex:
    by_civility: dict[tuple[str, str], int] = field(default_factory=dict)
    by_full_name: dict[str, int] = field(default_factory=dict)
    first_tokens: set[str] = field(default_factory=set)
    longest_surname: int = 0
    longest_full_name: int = 0


def mention_index(people: list[tuple[int, str, str, str]]) -> MentionIndex:
    """people: (pid, civility, first name, surname). Ambiguous keys are dropped."""
    civility_keys: dict[tuple[str, str], set[int]] = {}
    full_keys: dict[str, set[int]] = {}
    for pid, civility, first, last in people:
        surname = fold(last)
        if not surname or SURNAME_STOP & set(f"{fold(first)} {surname}".split()):
            continue
        gender = CIVILITIES.get(fold(civility), "")
        if len(surname.replace(" ", "")) >= MIN_SURNAME_LETTERS and surname not in SURNAME_STOP:
            for key_gender in (gender,) if gender else ("m", "f"):
                civility_keys.setdefault((key_gender, surname), set()).add(pid)
        if fold(first):
            full_keys.setdefault(f"{fold(first)} {surname}", set()).add(pid)
    index = MentionIndex()
    index.by_civility = {key: next(iter(pids)) for key, pids in civility_keys.items() if len(pids) == 1}
    index.by_full_name = {key: next(iter(pids)) for key, pids in full_keys.items() if len(pids) == 1}
    index.first_tokens = {key.split()[0] for key in index.by_full_name}
    index.longest_surname = max((len(key[1].split()) for key in index.by_civility), default=0)
    index.longest_full_name = max((len(key.split()) for key in index.by_full_name), default=0)
    return index


def find_mentions(text: str, index: MentionIndex, speaker_pid: int) -> list[tuple[int, str]]:
    """Other deputies named as « Mme Panot » or « Laurent Wauquiez », with the sentence that names them.

    A civility must match the deputy's: « M. Le Pen » is not Marine Le Pen, and
    « Jean-Marie Le Pen » is no one in the chamber.
    """
    folded = fold_aligned(text)
    tokens = [(match.group(0), match.start(), match.end()) for match in TOKEN_RE.finditer(folded)]
    words = [token[0] for token in tokens]
    hits: dict[int, str] = {}

    def record(pid: int | None, first: int, last: int) -> bool:
        if pid is None:
            return False
        if pid != speaker_pid and pid not in hits:
            hits[pid] = excerpt_around(text, tokens[first][1], tokens[last][2])
        return True

    for position, word in enumerate(words):
        gender = CIVILITIES.get(word)
        if gender:
            for size in range(min(index.longest_surname, len(words) - position - 1), 0, -1):
                key = " ".join(words[position + 1 : position + 1 + size])
                if record(index.by_civility.get((gender, key)), position, position + size):
                    break
            continue
        if word in index.first_tokens:
            for size in range(min(index.longest_full_name, len(words) - position), 1, -1):
                key = " ".join(words[position : position + size])
                if record(index.by_full_name.get(key), position, position + size - 1):
                    break
    return list(hits.items())


# -- applause -----------------------------------------------------------------


@dataclass(frozen=True)
class Applause:
    detail: str
    groups: tuple[str, ...]
    every_bench: bool
    unnamed_benches: bool


def _groups_in(text: str) -> set[str]:
    groups = {GROUP_CODES[label] for label in GROUP_LABEL_RE.findall(text)}
    if NON_INSCRITS_RE.search(text):
        groups.add(NON_INSCRITS)
    return groups


def _applause_scopes(part: str) -> list[str]:
    """The pieces of one stage direction that say who applauds.

    « Applaudissements » takes the benches that follow it (shared with the next
    noun in « Applaudissements et exclamations sur les bancs du groupe RN »);
    « applaudissent » takes its subject, before it, and what follows it up to
    the next reaction. Whatever another reaction or a direction covers
    (« huent les députés du groupe RN », « vers les bancs du groupe RN ») is
    left out, and so is ironic applause.
    """
    words = list(REACTION_WORD_RE.finditer(part))
    ends = [words[index + 1].start() if index + 1 < len(words) else len(part) for index in range(len(words))]
    scopes: list[str] = []
    subject_start = 0
    for index, word in enumerate(words):
        kind = word.lastgroup
        if kind not in APPLAUSE_WORDS:
            continue
        segment = part[word.start() : ends[index]]
        if kind == "applause_noun":
            last = index
            while not BENCHES_RE.search(segment) and last + 1 < len(words) and words[last + 1].lastgroup in NOUN_WORDS:
                last += 1
                segment = part[word.start() : ends[last]]
            if "ironi" not in segment.lower():
                scopes.append(segment)
            continue
        # The subject: the text before the verb, without what another
        # reaction or a direction covers.
        pieces: list[str] = []
        cursor = subject_start
        for position in range(index):
            previous = words[position]
            if previous.start() < subject_start or previous.lastgroup in APPLAUSE_WORDS:
                continue
            pieces.append(part[cursor : previous.start()])
            cursor = max(cursor, ends[position])
        pieces.append(part[cursor : word.start()])
        if "ironi" not in segment.lower():
            scopes.append(" ".join([*pieces, segment]))
        subject_start = ends[index]
    return scopes


def applause(direction: str) -> Applause | None:
    """The applause in a stage direction, and the groups it comes from.

    « Applaudissements sur les bancs du groupe RN. – Protestations sur les bancs
    du groupe LFI-NFP » keeps RN only; so does « Les députés du groupe RN
    applaudissent et huent les députés du groupe LFI-NFP ». A deputy applauding
    alone (« M. Marc Pena applaudit ») is not attributed to a group.
    """
    parts: list[str] = []
    scopes: list[str] = []
    for part in DIRECTION_PART_RE.split(direction):
        found = _applause_scopes(part.strip(" ."))
        if found:
            parts.append(part.strip(" ."))
            scopes.extend(found)
    if not scopes:
        return None
    groups: set[str] = set()
    for scope in scopes:
        groups |= _groups_in(scope)
    return Applause(
        detail=" – ".join(parts) + ".",
        groups=tuple(sorted(groups)),
        every_bench=any(EVERY_BENCH_RE.search(scope) for scope in scopes),
        unnamed_benches=any(UNNAMED_BENCHES_RE.search(scope) for scope in scopes),
    )


def other_camps(groups: list[str] | tuple[str, ...], every_bench: bool, unnamed_benches: bool, party: str) -> int:
    """How many camps other than the speaker's applauded. Ministers have no camp here."""
    own = CAMPS.get(party)
    if own is None:
        return 0
    if every_bench:
        return len(set(CAMPS.values())) - 1
    others = len({CAMPS[group] for group in groups if group in CAMPS} - {own})
    return max(others, 1) if unnamed_benches else others
