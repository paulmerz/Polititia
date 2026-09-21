"""
Extract speeches from Assemblée nationale XML transcripts (compteRendu schema).

Strategy
--------
We walk every <paragraphe> in document order and segment them into "speeches".
A speech is a continuous run of paragraphs by the same speaker, where:

  - Interruptions (paragraphs whose code_grammaire starts with INTERRUPTION_*)
    are ignored entirely. They DO NOT break a speech, even when the heckler is
    the president saying things like "Continuez, monsieur Mélenchon".
  - The session president speaking *non-procedurally* (a PAROLE_GENERIQUE
    paragraph) is a floor hand-off and ENDS the previous speech. Their own
    paragraphs are not turned into output files.
  - A change of speaker (other than via the president) starts a new speech.

So if a deputy speaks, gets heckled twenty times, and resumes -- that's one
speech. If they speak, the president cues the next intervenant, and they then
take the floor again on a different agenda item -- that's two speeches.

The output is one .txt file per speech, named:

    <source_stem>__<NNN>__<speaker_slug>.txt

where NNN is the speech's ordinal in the session (zero-padded, so files sort
chronologically). Each file contains clean speech text only, with no metadata
header. The extractor also writes one normalized n-gram corpus per speaker to:

    <output_dir>/by_speaker/<speaker_slug>.txt

and one dated speech index:

    <output_dir>/speeches.jsonl

Stage directions (Applaudissements, Mêmes mouvements, Mme X applaudit, ...)
are wrapped in <italique>(...)</italique> in the schema. We drop any
<italique> whose stripped content is parenthesised, plus a regex backup for
unwrapped didascalies. Italics on legitimate content (Latin like 'ad hominem')
are preserved.

Usage
-----
    python extract_speeches.py <input_glob> <output_dir>
    e.g.  python extract_speeches.py "data/*.xml" out/
"""

from __future__ import annotations

import glob
import json
import os
import re
import sys
import unicodedata
from collections import defaultdict
from xml.etree import ElementTree as ET

NS = {"an": "http://schemas.assemblee-nationale.fr/referentiel"}

INTERRUPTION_PREFIX = "INTERRUPTION"
ELLIPSIS = "…"
SPEAKER_CORPUS_DIR = "by_speaker"
SPEECH_INDEX_NAME = "speeches.jsonl"
FRENCH_MONTHS = {
    "janvier": 1,
    "fevrier": 2,
    "février": 2,
    "mars": 3,
    "avril": 4,
    "mai": 5,
    "juin": 6,
    "juillet": 7,
    "aout": 8,
    "août": 8,
    "septembre": 9,
    "octobre": 10,
    "novembre": 11,
    "decembre": 12,
    "décembre": 12,
}

APOSTROPHE_TRANSLATION = str.maketrans({
    "’": "'",
    "‘": "'",
    "ʼ": "'",
    "`": "'",
    "´": "'",
})

# Generic president labels we use to detect floor hand-offs. We don't try to
# resolve the president's id_acteur because the same person may sometimes
# speak in another role; the label is the reliable signal.
PRESIDENTIAL_NAMES = {
    "M. le président",
    "Mme la présidente",
    "M. le vice-président",
    "Mme la vice-présidente",
}

# Stage-direction regex backup, used in case <italique> markup is missing.
DIDASCALIE_KEYWORDS = (
    r"Applaudissement", r"Sourire", r"Rire", r"Exclamation",
    r"Mouvement", r"Protestation", r"Murmure", r"Interruption",
    r"Brouhaha", r"Huée", r"Cri", r"Bruit",
    r"Mêmes mouvements", r"Vifs applaudissements",
    r"M(?:me|\.|lle)\s",
)
DIDASCALIE_RE = re.compile(
    r"\(\s*(?:" + "|".join(DIDASCALIE_KEYWORDS) + r")[^()]*\)",
    re.IGNORECASE,
)
STAGE_DIRECTION_LINE_RE = re.compile(
    r"^\s*(?:"
    r"applaudissements?|vifs applaudissements?|sourires?|rires?|"
    r"exclamations?|mêmes mouvements?|mouvements?|protestations?|"
    r"murmures?|interruptions?|brouhaha|huées?|cris?|bruits?"
    r")\b.*$",
    re.IGNORECASE,
)


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _flatten_texte(texte_elem: ET.Element) -> str:
    """
    Turn a <texte> element into plain text.
    - <br/>            -> paragraph break
    - <italique>       -> dropped if its content is a parenthesised stage direction;
                          otherwise kept inline so legitimate italics survive
    - <exposant>       -> kept inline (e.g. "III" + "e" -> "IIIe")
    - any other tag    -> kept inline as text
    """
    parts: list[str] = []

    def text_of(node: ET.Element) -> str:
        buf: list[str] = []
        if node.text:
            buf.append(node.text)
        for c in node:
            if _local(c.tag) == "br":
                buf.append("\n")
            else:
                buf.append(text_of(c))
            if c.tail:
                buf.append(c.tail)
        return "".join(buf)

    def walk(node: ET.Element) -> None:
        if node.text:
            parts.append(node.text)
        for child in node:
            local = _local(child.tag)
            if local == "br":
                parts.append("\n")
            elif local == "italique":
                inner = text_of(child).strip()
                if not (inner.startswith("(") and inner.endswith(")")):
                    walk(child)
            else:
                walk(child)
            if child.tail:
                parts.append(child.tail)

    walk(texte_elem)
    return "".join(parts)


def _clean(text: str) -> str:
    text = DIDASCALIE_RE.sub("", text)
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.split("\n")]
    lines = [line for line in lines if line and not STAGE_DIRECTION_LINE_RE.match(line)]
    return "\n\n".join(lines)


def _strip_leading_ellipsis(text: str) -> str:
    return re.sub(rf"^\s*{re.escape(ELLIPSIS)}+\s*", "", text)


def _strip_trailing_ellipsis(text: str) -> str:
    return re.sub(rf"\s*{re.escape(ELLIPSIS)}+\s*$", "", text)


def _remove_ellipsis(text: str) -> str:
    text = re.sub(rf"[ \t]*{re.escape(ELLIPSIS)}+[ \t]*", " ", text)
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.split("\n")]
    return "\n".join(lines).strip()


def _join_rendered_paragraphs(pieces: list[str]) -> str:
    merged: list[str] = []
    for piece in pieces:
        if (
            merged
            and merged[-1].rstrip().endswith(ELLIPSIS)
            and piece.lstrip().startswith(ELLIPSIS)
        ):
            left = _strip_trailing_ellipsis(merged[-1])
            right = _strip_leading_ellipsis(piece)
            merged[-1] = f"{left} {right}".strip()
        else:
            merged.append(piece)
    return "\n\n".join(merged)


def _safe_filename(name: str) -> str:
    nfkd = unicodedata.normalize("NFKD", name)
    ascii_name = "".join(c for c in nfkd if not unicodedata.combining(c))
    ascii_name = re.sub(r"[^A-Za-z0-9]+", "_", ascii_name).strip("_")
    return ascii_name or "inconnu"


def normalize_for_ngrams(text: str) -> str:
    """
    Normalize text into simple lowercase word tokens separated by spaces.

    This keeps French letters and accents, splits contractions such as "c'est"
    into "c est", removes numbers, and turns punctuation into boundaries.
    """
    text = unicodedata.normalize("NFKC", text)
    text = text.translate(APOSTROPHE_TRANSLATION).lower()
    text = text.replace("\u00a0", " ").replace("\u202f", " ")
    text = re.sub(r"\bn\s*[°º]\s*", " ", text)
    text = re.sub(r"\b\d+(?:[.,]\d+)*(?:er|re|e|ème|eme|es|s)?\b", " ", text)
    text = text.replace("'", " ")
    text = re.sub(r"[\d_]+", " ", text)
    text = re.sub(r"[^\w\s]+", " ", text, flags=re.UNICODE)
    return re.sub(r"\s+", " ", text).strip()


def _get_metadata(root: ET.Element) -> dict[str, str]:
    meta: dict[str, str] = {}
    uid = root.find("an:uid", NS)
    if uid is not None and uid.text:
        meta["uid"] = uid.text.strip()
    md = root.find("an:metadonnees", NS)
    if md is not None:
        for key in ("dateSeance", "dateSeanceJour", "numSeance", "legislature", "session"):
            node = md.find(f"an:{key}", NS)
            if node is not None and node.text:
                meta[key] = node.text.strip()
        pres = md.find("an:sommaire/an:presidentSeance", NS)
        if pres is not None and pres.text:
            meta["president"] = pres.text.strip()
    return meta


def normalize_session_date(meta: dict[str, str]) -> str:
    """Return YYYY-MM-DD from Syceron session metadata when possible."""
    compact = (meta.get("dateSeance") or "").strip()
    if len(compact) >= 8 and compact[:8].isdigit():
        return f"{compact[0:4]}-{compact[4:6]}-{compact[6:8]}"

    raw = (meta.get("dateSeanceJour") or "").strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw):
        return raw

    match = re.search(r"(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\s+(\d{4})", raw)
    if match:
        day = int(match.group(1))
        month_name = match.group(2).casefold()
        month = FRENCH_MONTHS.get(month_name)
        year = int(match.group(3))
        if month:
            return f"{year:04d}-{month:02d}-{day:02d}"

    return ""


def _resolve_role(orateur: ET.Element) -> str:
    qual = orateur.find("an:qualite", NS)
    if qual is None:
        return ""
    return (qual.text or "").strip()


def segment_speeches(root: ET.Element) -> list[dict]:
    """
    Walk paragraphs in document order and group them into speech segments.

    Returns a list of dicts:
        {
            "speaker": str,
            "role": str,                 # qualite from the first paragraph that has one
            "paragraphs": list[Element], # the <paragraphe> nodes (no interruptions)
            "n_interruptions_skipped": int,
        }
    """
    speeches: list[dict] = []
    current: dict | None = None
    skipped_in_current = 0

    def flush():
        nonlocal current, skipped_in_current
        if current and current["paragraphs"]:
            current["n_interruptions_skipped"] = skipped_in_current
            speeches.append(current)
        current = None
        skipped_in_current = 0

    for para in root.iter():
        if _local(para.tag) != "paragraphe":
            continue

        orateur = para.find("an:orateurs/an:orateur", NS)
        if orateur is None:
            continue
        nom_node = orateur.find("an:nom", NS)
        if nom_node is None or not (nom_node.text or "").strip():
            continue
        speaker = nom_node.text.strip()
        is_interruption = para.attrib.get("code_grammaire", "").startswith(INTERRUPTION_PREFIX)

        # Interruptions don't end a speech, regardless of who's interrupting.
        if is_interruption:
            if current is not None:
                skipped_in_current += 1
            continue

        # A non-interruption paragraph by the president is a floor hand-off:
        # flush the current speech, but don't create a new one for the
        # president (their procedural turns aren't speeches).
        if speaker in PRESIDENTIAL_NAMES:
            flush()
            continue

        # Non-interruption paragraph by a "normal" speaker.
        if current is None or current["speaker"] != speaker:
            flush()
            current = {
                "speaker": speaker,
                "role": _resolve_role(orateur),
                "paragraphs": [para],
            }
            skipped_in_current = 0
        else:
            # Same speaker continuing
            current["paragraphs"].append(para)
            # Backfill the role if we didn't have one yet
            if not current["role"]:
                current["role"] = _resolve_role(orateur)

    flush()
    return speeches


def render_speech(segment: dict) -> str:
    pieces: list[str] = []
    for para in segment["paragraphs"]:
        texte = para.find("an:texte", NS)
        if texte is None:
            continue
        cleaned = _clean(_flatten_texte(texte))
        if cleaned:
            pieces.append(cleaned)
    return _remove_ellipsis(_join_rendered_paragraphs(pieces))


def write_speech_files(
    segments: list[dict],
    out_dir: str,
    source_file: str,
    meta: dict[str, str] | None = None,
) -> list[dict[str, str]]:
    os.makedirs(out_dir, exist_ok=True)
    src_stem = os.path.splitext(os.path.basename(source_file))[0]
    pad = max(2, len(str(len(segments))))
    session_meta = meta or {}
    session_date = normalize_session_date(session_meta)
    written: list[dict[str, str]] = []

    for idx, seg in enumerate(segments, start=1):
        text = render_speech(seg)
        if not text:
            continue

        speaker_slug = _safe_filename(seg["speaker"])
        speech_id = f"{src_stem}__{idx:0{pad}d}__{speaker_slug}"
        path = os.path.join(out_dir, f"{speech_id}.txt")
        with open(path, "w", encoding="utf-8") as f:
            f.write(text + "\n")
        written.append({
            "speech_id": speech_id,
            "source_stem": src_stem,
            "date": session_date,
            "session_uid": session_meta.get("uid", ""),
            "num_seance": session_meta.get("numSeance", ""),
            "legislature": session_meta.get("legislature", ""),
            "session": session_meta.get("session", ""),
            "speaker": seg["speaker"],
            "speaker_slug": speaker_slug,
            "role": seg.get("role") or "",
            "text": text,
            "normalized_text": normalize_for_ngrams(text),
        })

    return written


def write_speeches_jsonl(records: list[dict[str, str]], out_dir: str) -> str:
    path = os.path.join(out_dir, SPEECH_INDEX_NAME)
    os.makedirs(out_dir, exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")
    return path


def write_speaker_corpora(speaker_texts: dict[str, list[str]], out_dir: str) -> list[str]:
    speaker_dir = os.path.join(out_dir, SPEAKER_CORPUS_DIR)
    os.makedirs(speaker_dir, exist_ok=True)
    by_safe_speaker: dict[str, list[str]] = defaultdict(list)

    for speaker, texts in speaker_texts.items():
        safe_speaker = _safe_filename(speaker)
        for text in texts:
            if normalized := normalize_for_ngrams(text):
                by_safe_speaker[safe_speaker].append(normalized)

    written: list[str] = []

    for safe_speaker in sorted(by_safe_speaker):
        normalized_speeches = by_safe_speaker[safe_speaker]
        if not normalized_speeches:
            continue

        fname = f"{safe_speaker}.txt"
        path = os.path.join(speaker_dir, fname)
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(normalized_speeches) + "\n")
        written.append(path)

    return written


def extract_speeches(xml_path: str) -> tuple[list[dict], dict[str, str]]:
    """Parse one XML and return (segments, metadata)."""
    tree = ET.parse(xml_path)
    root = tree.getroot()
    meta = _get_metadata(root)
    segments = segment_speeches(root)
    return segments, meta


def process_glob(input_glob: str, out_dir: str) -> list[str]:
    paths = sorted(glob.glob(input_glob))
    if not paths:
        raise SystemExit(f"No files matched: {input_glob}")
    all_written: list[str] = []
    speaker_texts: dict[str, list[str]] = {}
    speech_records: list[dict[str, str]] = []
    for xml_path in paths:
        segments, meta = extract_speeches(xml_path)
        written = write_speech_files(segments, out_dir, xml_path, meta)
        all_written.extend(os.path.join(out_dir, f"{record['speech_id']}.txt") for record in written)
        speech_records.extend(written)
        for record in written:
            speaker_texts.setdefault(record["speaker"], []).append(record["text"])
        print(f"[ok] {xml_path} -> {len(written)} speech file(s)")

    speaker_corpora = write_speaker_corpora(speaker_texts, out_dir)
    all_written.extend(speaker_corpora)
    index_path = write_speeches_jsonl(speech_records, out_dir)
    all_written.append(index_path)
    print(f"[ok] wrote {len(speaker_corpora)} speaker corpus file(s)")
    print(f"[ok] wrote {len(speech_records)} speech index row(s) to {index_path}")
    return all_written


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python extract_speeches.py <input_glob> <output_dir>", file=sys.stderr)
        sys.exit(2)
    process_glob(sys.argv[1], sys.argv[2])
