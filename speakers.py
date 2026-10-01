"""One identity per speaker, with the group they sat in on the day they spoke.

Speeches carry the Assemblée actor id (``PA721816``). With the AMO reference
data this gives:

- a stable name and politician id, whatever spelling the report used;
- ``party``: the group shown on the politician's card (their latest group,
  or ``GOUV`` for ministers who were never deputies in this legislature);
- ``party_at_speech``: the group on the day of the speech, or ``GOUV`` when
  they spoke as a member of the government. Group statistics use this one,
  so a minister's answers are not counted as their former group's words.

Without reference data (tests, partial downloads) the party suffix of the
speaker label is used, as before.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from analyze_project_ngrams import build_party_lookup, infer_party_and_name, read_speaker_files, resolve_party
from reference_data import GOVERNMENT, GOVERNMENT_ROLE_RE, ReferenceData, fold


COLLECTIVE_SPEAKER_RE = re.compile(r"^(plusieurs|de nombreux|des|un|une|quelques) (députés?|membres?|voix)", re.I)


def slugify(value: str) -> str:
    return fold(value).replace(" ", "-") or "unknown"


def politician_id(name: str, party: str) -> str:
    return f"{slugify(name)}--{slugify(party)}"


@dataclass(frozen=True)
class Identity:
    politician_id: str
    name: str
    party: str
    party_at_speech: str
    acteur_id: str

    @property
    def as_government(self) -> bool:
        return self.party_at_speech == GOVERNMENT


class SpeakerResolver:
    def __init__(self, reference: ReferenceData | None = None, speaker_dir: Path | None = None) -> None:
        self.reference = reference
        files = read_speaker_files(speaker_dir) if speaker_dir and speaker_dir.is_dir() and any(speaker_dir.glob("*.txt")) else []
        self.party_lookup = build_party_lookup(files) if files else {}

    def resolve(self, row: dict[str, str]) -> Identity | None:
        """Identity of the speaker of ``row``, or None for collective speakers."""
        if COLLECTIVE_SPEAKER_RE.match(row.get("speaker", "")):
            return None
        acteur_id = row.get("acteur_id", "")
        actor = self.reference.actor(acteur_id) if self.reference else None
        if actor is not None:
            day = row.get("date", "")
            party = actor.latest_party() or GOVERNMENT
            at_speech = actor.party_on(day, row.get("role", "")) or party
            return Identity(politician_id(actor.name, party), actor.name, party, at_speech, acteur_id)

        party, name, _source = resolve_party(row["speaker_slug"], self.party_lookup)
        if party == "UNLABELED":
            inferred, name = infer_party_and_name(row["speaker_slug"])
            party = self.party_lookup.get(name, inferred)
        at_speech = GOVERNMENT if GOVERNMENT_ROLE_RE.search(row.get("role", "")) else party
        return Identity(politician_id(name, party), name, party, at_speech, acteur_id)
