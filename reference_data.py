"""Load the Assemblee nationale reference datasets (actors, groups, bills, votes).

The debates only give an actor id (``PA795120``) and a bill number
(``n° 2233``). These helpers turn them into:

- the political group an actor sat in on a given date (or the government);
- the legislative file (dossier) a bill number belongs to, with its title and
  the committee in charge of it;
- the public votes, with every deputy's position.

All loaders accept the directory produced by ``scripts/download_open_data.py``
and degrade to empty results when a dataset is missing, so the pipeline keeps
running on a partial download.
"""

from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path


DEFAULT_OPEN_DATA_DIR = Path("data/raw/opendata")
GOVERNMENT = "GOUV"
NON_INSCRITS = "NI"

# Group abbreviations in AMO -> party codes used across the dashboard.
GROUP_CODES = {
    "GDR": "GDR",
    "HOR": "HOR",
    "EcoS": "EcoS",
    "ECOS": "EcoS",
    "EPR": "EPR",
    "DR": "DR",
    "RN": "RN",
    "LFI-NFP": "LFI_NFP",
    "LIOT": "LIOT",
    "Dem": "Dem",
    "DEM": "Dem",
    "SOC": "SOC",
    "UDR": "UDR",
    "UDDPLR": "UDR",
    "AD": "UDR",
    "NI": NON_INSCRITS,
}

# Standing committees -> citizen-facing policy domains.
COMMITTEE_DOMAINS = {
    "CION_LOIS": "lois",
    "CION-ECO": "economie",
    "CION_DEF": "defense",
    "CION-DVP": "territoires",
    "CION-SOC": "social",
    "CION_AFETR": "international",
    "CION-CEDU": "culture-education",
    "CION_FIN": "finances",
}

DOCUMENT_NUMBER_RE = re.compile(r"ANR5L17B(?:TC)?(\d+)$")
GOVERNMENT_ROLE_RE = re.compile(r"^(premi[eè]re? )?ministre|^secr[ée]taire d.[ée]tat|^garde des sceaux|^haut-commissaire", re.I)


def fold(text: str) -> str:
    """Lowercase, strip accents and punctuation: a key for fuzzy title matching."""
    simple = unicodedata.normalize("NFKD", text or "")
    simple = "".join(char for char in simple if not unicodedata.combining(char)).lower()
    simple = simple.replace("’", " ").replace("'", " ")
    simple = re.sub(r"[^a-z0-9]+", " ", simple)
    return re.sub(r"\s+", " ", simple).strip()


def as_list(value: object) -> list:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def _load(path: Path, root_key: str) -> dict:
    return json.loads(path.read_text(encoding="utf-8")).get(root_key, {})


@dataclass
class Membership:
    start: str
    end: str
    party: str


@dataclass
class Actor:
    uid: str
    civility: str
    first_name: str
    last_name: str
    groups: list[Membership] = field(default_factory=list)
    government: list[tuple[str, str]] = field(default_factory=list)

    @property
    def name(self) -> str:
        return " ".join(part for part in (self.civility, self.first_name, self.last_name) if part)

    def party_on(self, day: str, role: str = "") -> str:
        """Group on ``day`` (YYYY-MM-DD); government membership wins.

        ``role`` is the speaker's quality in the report: resigning ministers
        still speak as "ministre" after their mandate has ended.
        """
        if GOVERNMENT_ROLE_RE.search(role or ""):
            return GOVERNMENT
        if any(start <= day <= (end or "9999") for start, end in self.government):
            return GOVERNMENT
        for membership in self.groups:
            if membership.start <= day <= (membership.end or "9999"):
                return membership.party
        return ""

    def latest_party(self) -> str:
        if not self.groups:
            return ""
        return max(self.groups, key=lambda item: item.start).party


@dataclass
class Dossier:
    uid: str
    title: str
    procedure: str
    committee: str
    domain: str
    document_titles: list[str] = field(default_factory=list)


@dataclass
class Vote:
    uid: str
    number: int
    date: str
    title: str
    adopted: bool
    vote_type: str
    positions: dict[str, str]
    group_majority: dict[str, str]
    dossier_uid: str = ""


class ReferenceData:
    def __init__(self, base_dir: Path = DEFAULT_OPEN_DATA_DIR) -> None:
        self.base_dir = base_dir
        self.organ_abbrev: dict[str, str] = {}
        self.organ_types: dict[str, str] = {}
        self.actors: dict[str, Actor] = {}
        self.dossiers: dict[str, Dossier] = {}
        self.bill_to_dossier: dict[str, str] = {}
        self._title_needles: list[tuple[str, Dossier]] | None = None
        self._load_organs()
        self._load_actors()
        self._load_dossiers()

    # -- actors and groups -------------------------------------------------

    def _load_organs(self) -> None:
        directory = self.base_dir / "amo" / "json" / "organe"
        if not directory.is_dir():
            return
        for path in directory.glob("*.json"):
            organ = _load(path, "organe")
            uid = organ.get("uid", "")
            self.organ_types[uid] = organ.get("codeType", "")
            self.organ_abbrev[uid] = organ.get("libelleAbrev") or organ.get("libelleAbrege") or ""

    def _load_actors(self) -> None:
        directory = self.base_dir / "amo" / "json" / "acteur"
        if not directory.is_dir():
            return
        for path in directory.glob("*.json"):
            raw = _load(path, "acteur")
            uid = raw.get("uid", {})
            uid = uid.get("#text", "") if isinstance(uid, dict) else str(uid)
            ident = raw.get("etatCivil", {}).get("ident", {})
            actor = Actor(
                uid=uid,
                civility=ident.get("civ") or "",
                first_name=ident.get("prenom") or "",
                last_name=ident.get("nom") or "",
            )
            for mandate in as_list((raw.get("mandats") or {}).get("mandat")):
                organ_type = mandate.get("typeOrgane")
                start = (mandate.get("dateDebut") or "")[:10]
                end = (mandate.get("dateFin") or "")[:10]
                refs = as_list((mandate.get("organes") or {}).get("organeRef"))
                if organ_type == "GP" and str(mandate.get("legislature")) == "17":
                    for ref in refs:
                        party = GROUP_CODES.get(self.organ_abbrev.get(ref, ""), "")
                        if party:
                            actor.groups.append(Membership(start, end, party))
                elif organ_type in ("GOUVERNEMENT", "MINISTERE") and start >= "2024-01-01":
                    quality = ((mandate.get("infosQualite") or {}).get("codeQualite") or "").lower()
                    # Deputies "en mission" for a minister stay deputies.
                    if quality != "en mission":
                        actor.government.append((start, end))
            actor.groups.sort(key=lambda item: item.start)
            self.actors[uid] = actor

    def actor(self, uid: str) -> Actor | None:
        return self.actors.get(uid)

    # -- bills --------------------------------------------------------------

    def _load_dossiers(self) -> None:
        dossier_dir = self.base_dir / "dossiers" / "json" / "dossierParlementaire"
        if not dossier_dir.is_dir():
            return
        for path in dossier_dir.glob("*.json"):
            raw = _load(path, "dossierParlementaire")
            if str(raw.get("legislature")) != "17":
                continue
            committee = self._committee_in_charge(raw.get("actesLegislatifs"))
            abbrev = self.organ_abbrev.get(committee, "")
            self.dossiers[raw["uid"]] = Dossier(
                uid=raw["uid"],
                title=(raw.get("titreDossier") or {}).get("titre") or "",
                procedure=(raw.get("procedureParlementaire") or {}).get("libelle") or "",
                committee=abbrev,
                domain=COMMITTEE_DOMAINS.get(abbrev, ""),
            )
        document_dir = self.base_dir / "dossiers" / "json" / "document"
        if not document_dir.is_dir():
            return
        for path in document_dir.glob("*.json"):
            raw = _load(path, "document")
            dossier_uid = raw.get("dossierRef") or ""
            if dossier_uid not in self.dossiers:
                continue
            title = ((raw.get("titres") or {}).get("titrePrincipal")) or ""
            if title:
                self.dossiers[dossier_uid].document_titles.append(title)
            match = DOCUMENT_NUMBER_RE.search(raw.get("uid", ""))
            if match:
                self.bill_to_dossier.setdefault(match.group(1), dossier_uid)

    @staticmethod
    def _committee_in_charge(acts: object) -> str:
        found: list[str] = []

        def walk(node: object) -> None:
            if isinstance(node, list):
                for item in node:
                    walk(item)
            elif isinstance(node, dict):
                code = str(node.get("codeActe") or "")
                if code.endswith("COM-FOND") and node.get("organeRef"):
                    found.append(str(node["organeRef"]))
                for value in node.values():
                    if isinstance(value, (dict, list)):
                        walk(value)

        walk(acts)
        return found[0] if found else ""

    def dossier_for_bill(self, bill_numbers: str) -> Dossier | None:
        for number in (bill_numbers or "").split(","):
            uid = self.bill_to_dossier.get(number.strip())
            if uid:
                return self.dossiers[uid]
        return None

    def dossier_for_title(self, text: str) -> Dossier | None:
        """Dossier whose document title appears in ``text`` (longest match wins)."""
        haystack = fold(text)
        if not haystack:
            return None
        if self._title_needles is None:
            needles = {}
            for dossier in self.dossiers.values():
                for title in [dossier.title, *dossier.document_titles]:
                    needle = fold(re.sub(r"^(projet|proposition) de loi( organique| constitutionnelle)?\s*", "", title, flags=re.I))
                    if len(needle) >= 20:
                        needles.setdefault(needle, dossier)
            self._title_needles = sorted(needles.items(), key=lambda item: -len(item[0]))
        for needle, dossier in self._title_needles:
            if needle in haystack:
                return dossier
        return None

    # -- votes --------------------------------------------------------------

    def votes(self) -> list[Vote]:
        directory = self.base_dir / "scrutins" / "json"
        if not directory.is_dir():
            return []
        votes: list[Vote] = []
        for path in sorted(directory.glob("*.json")):
            raw = _load(path, "scrutin")
            positions: dict[str, str] = {}
            majority: dict[str, str] = {}
            groups = as_list(((raw.get("ventilationVotes") or {}).get("organe") or {}).get("groupes", {}).get("groupe"))
            for group in groups:
                party = GROUP_CODES.get(self.organ_abbrev.get(group.get("organeRef", ""), ""), "")
                vote = group.get("vote") or {}
                if party:
                    majority[party] = vote.get("positionMajoritaire") or ""
                nominative = vote.get("decompteNominatif") or {}
                for key, label in (("pours", "pour"), ("contres", "contre"), ("abstentions", "abstention"), ("nonVotants", "non-votant")):
                    for voter in as_list((nominative.get(key) or {}).get("votant")):
                        if voter.get("acteurRef"):
                            positions[voter["acteurRef"]] = label
            title = raw.get("titre") or ((raw.get("objet") or {}).get("libelle")) or ""
            votes.append(
                Vote(
                    uid=raw.get("uid", ""),
                    number=int(raw.get("numero") or 0),
                    date=(raw.get("dateScrutin") or "")[:10],
                    title=title,
                    adopted=str((raw.get("sort") or {}).get("code") or "").startswith("adopt"),
                    vote_type=((raw.get("typeVote") or {}).get("codeTypeVote")) or "",
                    positions=positions,
                    group_majority=majority,
                )
            )
        return votes

