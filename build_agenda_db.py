#!/usr/bin/env python3
"""Build analysis_outputs/agenda.sqlite from the Assemblée nationale Agenda dataset.

The Agenda dataset (repository/17/vp/reunions/Agenda.json.zip) lists every public
sitting and committee meeting of the legislature, past and announced, with:

- the order of business of each sitting, item by item, and the legislative
  dossier each item is about;
- the topics of each committee meeting;
- for committee meetings, every member of the organ marked present, excused or
  absent (checked against the committee reports, see roadmap.md § 6.1).

For each dossier on the agenda it also stores what the agenda page shows next to
it: Government or Members' bill, first author and group, committee in charge and
the themes of the curated lexicon its title names.

It changes every day while analytics.sqlite is rebuilt once a week, so it gets a
database of its own (schema: agenda_schema.sql). The ZIP is read directly. Organ
names, authors and groups come from the AMO download, dossiers from the
dossiers download; both are optional.

    uv run python scripts/download_open_data.py --only amo dossiers agenda
    uv run python build_agenda_db.py
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import unicodedata
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from analyze_themes import load_lexicon, title_themes
from reference_data import GROUP_CODES, ReferenceData

DEFAULT_ARCHIVE = Path("data/raw/opendata/agenda.json.zip")
DEFAULT_OPEN_DATA_DIR = Path("data/raw/opendata")
DEFAULT_LEXICON = Path("themes/lexicon.json")
DEFAULT_OUTPUT = Path("analysis_outputs/agenda.sqlite")
SOURCE_URL = "https://data.assemblee-nationale.fr/static/openData/repository/17/vp/reunions/Agenda.json.zip"
SCHEMA = (Path(__file__).resolve().parent / "agenda_schema.sql").read_text(encoding="utf-8")

KINDS = {
    "seance_type": "seance",
    "reunionCommission_type": "commission",
    "reunionInitParlementaire_type": "initiative",
}
ATTENDANCE = {"present": "present", "excuse": "excuse", "absent": "absent"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--agenda", type=Path, default=DEFAULT_ARCHIVE, help="Agenda.json.zip")
    parser.add_argument("--open-data", type=Path, default=DEFAULT_OPEN_DATA_DIR, help="AMO and dossiers downloads")
    parser.add_argument("--lexicon", type=Path, default=DEFAULT_LEXICON)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def as_list(value: object) -> list:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def fold(text: str | None) -> str:
    """'Confirmé' -> 'confirme', 'excusé' -> 'excuse'."""
    simple = unicodedata.normalize("NFKD", text or "")
    return "".join(char for char in simple if not unicodedata.combining(char)).strip().lower()


def timestamp(value: str | None) -> str:
    """'2025-11-07T21:30:00.000+01:00' -> '2025-11-07T21:30:00+01:00'."""
    return (value or "").replace(".000", "")


def text_items(node: object) -> list[str]:
    items = node.get("item") if isinstance(node, dict) else None
    return [str(item).strip() for item in as_list(items) if str(item or "").strip()]


def flag(value: object) -> int:
    return 1 if str(value).lower() == "true" else 0


def read_json(path: Path, root_key: str) -> dict:
    if not path.is_file():
        return {}
    return json.loads(path.read_text(encoding="utf-8")).get(root_key) or {}


class Organs:
    """Name and type of each organ, from the AMO download (empty without it)."""

    def __init__(self, open_data: Path) -> None:
        self.by_uid: dict[str, tuple[str, str, str]] = {}
        directory = open_data / "amo" / "json" / "organe"
        if not directory.is_dir():
            return
        for path in directory.glob("*.json"):
            organ = json.loads(path.read_text(encoding="utf-8")).get("organe", {})
            uid = organ.get("uid", "")
            if uid:
                self.by_uid[uid] = (
                    organ.get("libelle") or "",
                    organ.get("libelleAbrege") or organ.get("libelleAbrev") or "",
                    organ.get("codeType") or "",
                )

    def get(self, uid: str) -> tuple[str, str, str]:
        return self.by_uid.get(uid, ("", "", ""))


class Actors:
    """Name and group of the few deputies who author a dossier on the agenda."""

    def __init__(self, open_data: Path, organs: Organs) -> None:
        self.directory = open_data / "amo" / "json" / "acteur"
        self.organs = organs
        self.cache: dict[str, dict] = {}

    def _raw(self, uid: str) -> dict:
        if uid not in self.cache:
            self.cache[uid] = read_json(self.directory / f"{uid}.json", "acteur")
        return self.cache[uid]

    def name(self, uid: str) -> str:
        ident = (self._raw(uid).get("etatCivil") or {}).get("ident") or {}
        return " ".join(part for part in (ident.get("civ"), ident.get("prenom"), ident.get("nom")) if part)

    def group_on(self, uid: str, day: str) -> str:
        """Party code (as in analytics.sqlite) of the deputy's group on ``day``.

        A text deposited before this legislature has no such group on its
        deposit day: the deputy's latest group of this legislature stands in.
        Senators and groups of earlier legislatures have none.
        """
        groups: list[tuple[str, str, str]] = []
        for mandate in as_list((self._raw(uid).get("mandats") or {}).get("mandat")):
            if mandate.get("typeOrgane") != "GP":
                continue
            for ref in as_list((mandate.get("organes") or {}).get("organeRef")):
                party = GROUP_CODES.get(self.organs.get(ref)[1], "")
                if party:
                    groups.append(((mandate.get("dateDebut") or "")[:10], (mandate.get("dateFin") or "")[:10] or "9999", party))
        for start, end, party in groups:
            if start <= day <= end:
                return party
        return max(groups)[2] if groups else ""


def first_deposit(acts: object) -> tuple[str, str, str]:
    """Date, act code ('AN1-DEPOT', 'SN1-DEPOT'...) and text uid of a dossier's first deposit."""
    found: list[tuple[str, str, str]] = []

    def walk(node: object) -> None:
        if isinstance(node, list):
            for item in node:
                walk(item)
        elif isinstance(node, dict):
            code = str(node.get("codeActe") or "")
            if code.endswith("-DEPOT"):
                found.append(((node.get("dateActe") or "")[:10], code, str(node.get("texteAssocie") or "")))
            for value in node.values():
                if isinstance(value, (dict, list)):
                    walk(value)

    walk(acts)
    dated = sorted(item for item in found if item[0])
    return dated[0] if dated else (found[0] if found else ("", "", ""))


def deposit_origin(code: str) -> str:
    """'assemblee' or 'senat': the chamber where the text was first deposited."""
    if code.startswith("AN"):
        return "assemblee"
    if code.startswith("SN"):
        return "senat"
    return ""


def dossier_kind(procedure: str, deposited_text: str) -> str:
    folded = fold(procedure)
    if not folded.startswith("projet ou proposition"):
        if folded.startswith("projet"):
            return "projet"
        if folded.startswith("proposition"):
            return "proposition"
        if folded.startswith("resolution"):
            return "resolution"
    if "PRJL" in deposited_text or "PJL" in deposited_text:
        return "projet"
    if "PION" in deposited_text or "PPL" in deposited_text:
        return "proposition"
    return ""


class Dossiers:
    """What the agenda shows about a dossier, read on demand from the downloads."""

    def __init__(self, open_data: Path, organs: Organs, lexicon_path: Path) -> None:
        self.directory = open_data / "dossiers" / "json" / "dossierParlementaire"
        self.organs = organs
        self.actors = Actors(open_data, organs)
        self.lexicon = load_lexicon(lexicon_path) if lexicon_path.is_file() else None
        self.labels = {theme["id"]: theme["label"] for theme in (self.lexicon.themes if self.lexicon else [])}
        self.raw_cache: dict[str, dict] = {}

    def raw(self, uid: str) -> dict:
        if uid not in self.raw_cache:
            self.raw_cache[uid] = read_json(self.directory / f"{uid}.json", "dossierParlementaire")
        return self.raw_cache[uid]

    def title(self, uid: str) -> str:
        return (self.raw(uid).get("titreDossier") or {}).get("titre") or ""

    def row(self, uid: str, subjects: list[str]) -> tuple:
        raw = self.raw(uid)
        title = self.title(uid)
        procedure = (raw.get("procedureParlementaire") or {}).get("libelle") or ""
        deposited_on, deposit_code, deposited_text = first_deposit(raw.get("actesLegislatifs"))
        kind = dossier_kind(procedure, deposited_text)
        committee_ref = ReferenceData._committee_in_charge(raw.get("actesLegislatifs")) if raw else ""
        committee = self.organs.get(committee_ref)
        authors = [
            str(item.get("acteurRef"))
            for item in as_list(((raw.get("initiateur") or {}).get("acteurs") or {}).get("acteur"))
            if item.get("acteurRef")
        ]
        # A Government bill's initiators are ministers: the page says "Gouvernement".
        author_id = authors[0] if kind in ("proposition", "resolution") and authors else ""
        themes = []
        if self.lexicon:
            haystack = " | ".join(part for part in [title, *subjects] if part)
            themes = [{"id": theme, "label": self.labels.get(theme, theme)} for theme in title_themes(haystack, self.lexicon)]
        return (
            uid,
            title,
            kind,
            deposit_origin(deposit_code),
            procedure,
            deposited_on,
            committee_ref,
            committee[1] or committee[0],
            author_id,
            self.actors.name(author_id) if author_id else "",
            self.actors.group_on(author_id, deposited_on) if author_id else "",
            max(len(authors) - 1, 0) if author_id else 0,
            json.dumps(themes, ensure_ascii=False),
        )


def meeting_row(meeting: dict, organs: Organs) -> tuple:
    organ_ref = meeting.get("organeReuniRef") or ""
    organ_name, organ_short, organ_type = organs.get(organ_ref)
    odj = meeting.get("ODJ") or {}
    starts_at = timestamp(meeting.get("timeStampDebut"))
    return (
        meeting["uid"],
        KINDS.get(meeting.get("@xsi:type", ""), fold(meeting.get("@xsi:type")).removesuffix("_type")),
        fold((meeting.get("cycleDeVie") or {}).get("etat")),
        starts_at[:10],
        starts_at,
        timestamp(meeting.get("timeStampFin")),
        organ_ref,
        organ_name,
        organ_short,
        organ_type,
        (meeting.get("lieu") or {}).get("libelleLong") or "",
        meeting.get("compteRenduRef") or "",
        (meeting.get("identifiants") or {}).get("numSeanceJO") or "",
        flag(meeting.get("captationVideo")),
        flag(meeting.get("ouverturePresse")),
        json.dumps(text_items(odj.get("convocationODJ")) or text_items(odj.get("resumeODJ")), ensure_ascii=False),
    )


def build(out: Path, archive: Path, open_data: Path, lexicon: Path = DEFAULT_LEXICON) -> dict[str, int]:
    organs = Organs(open_data)
    dossiers = Dossiers(open_data, organs, lexicon)
    subjects: dict[str, list[str]] = {}
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".tmp")
    tmp.unlink(missing_ok=True)
    db = sqlite3.connect(tmp)
    db.executescript("PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;" + SCHEMA)
    with zipfile.ZipFile(archive) as zf:
        for name in sorted(zf.namelist()):
            if not name.endswith(".json"):
                continue
            meeting = json.loads(zf.read(name)).get("reunion")
            if not meeting or not meeting.get("uid"):
                continue
            db.execute("INSERT INTO meetings VALUES (" + ",".join("?" * 16) + ")", meeting_row(meeting, organs))
            points = ((meeting.get("ODJ") or {}).get("pointsODJ") or {}).get("pointODJ")
            for position, point in enumerate(as_list(points), start=1):
                subject = (point.get("objet") or "").strip()
                db.execute(
                    "INSERT INTO agenda_items VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        point["uid"],
                        meeting["uid"],
                        position,
                        fold((point.get("cycleDeVie") or {}).get("etat")),
                        point.get("typePointODJ") or "",
                        subject,
                        point.get("procedure") or "",
                        point.get("natureTravauxODJ") or "",
                        (point.get("dateConfPres") or "")[:10],
                    ),
                )
                refs = [ref for ref in dict.fromkeys(as_list((point.get("dossiersLegislatifsRefs") or {}).get("dossierRef"))) if ref]
                db.executemany(
                    "INSERT OR IGNORE INTO agenda_item_dossiers VALUES (?, ?, ?)",
                    [(point["uid"], ref, dossiers.title(ref)) for ref in refs],
                )
                for ref in refs:
                    subjects.setdefault(ref, [])
                    if subject and subject not in subjects[ref]:
                        subjects[ref].append(subject)
            members = ((meeting.get("participants") or {}).get("participantsInternes") or {}).get("participantInterne")
            for member in as_list(members):
                acteur = member.get("acteurRef")
                if not acteur:
                    continue
                status = ATTENDANCE.get(fold(member.get("presence")), fold(member.get("presence")))
                db.execute("INSERT OR IGNORE INTO attendance VALUES (?, ?, ?)", (meeting["uid"], acteur, status))
    db.executemany(
        "INSERT INTO dossiers VALUES (" + ",".join("?" * 13) + ")",
        [dossiers.row(uid, items[:5]) for uid, items in subjects.items()],
    )

    def scalar(sql: str) -> object:
        return db.execute(sql).fetchone()[0]

    counts = {
        "meetings": int(scalar("SELECT COUNT(*) FROM meetings")),
        "sittings": int(scalar("SELECT COUNT(*) FROM meetings WHERE kind = 'seance'")),
        "committee_meetings": int(scalar("SELECT COUNT(*) FROM meetings WHERE kind = 'commission'")),
        "agenda_items": int(scalar("SELECT COUNT(*) FROM agenda_items")),
        "item_dossiers": int(scalar("SELECT COUNT(*) FROM agenda_item_dossiers")),
        "dossiers": int(scalar("SELECT COUNT(*) FROM dossiers")),
        "attendance": int(scalar("SELECT COUNT(*) FROM attendance")),
    }
    meta = {
        "built_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": SOURCE_URL,
        "archive_downloaded_at": datetime.fromtimestamp(archive.stat().st_mtime, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "first_date": scalar("SELECT MIN(date) FROM meetings") or "",
        "last_date": scalar("SELECT MAX(date) FROM meetings") or "",
        "last_confirmed_sitting": scalar("SELECT MAX(date) FROM meetings WHERE kind = 'seance' AND state = 'confirme'") or "",
        # An unexpected status would show up here instead of being dropped.
        "attendance_statuses": dict(db.execute("SELECT status, COUNT(*) FROM attendance GROUP BY status ORDER BY status")),
        "counts": counts,
    }
    db.executemany("INSERT INTO meta VALUES (?, ?)", [(key, json.dumps(value, ensure_ascii=False)) for key, value in meta.items()])
    db.commit()
    db.execute("ANALYZE")
    db.close()
    tmp.replace(out)
    return counts


def main() -> int:
    args = parse_args()
    if not args.agenda.is_file():
        raise SystemExit(
            f"Agenda archive not found: {args.agenda}\n"
            "Download it with: uv run python scripts/download_open_data.py --only amo dossiers agenda"
        )
    counts = build(args.out, args.agenda, args.open_data, args.lexicon)
    print(
        f"Wrote {args.out}: {counts['meetings']} meetings ({counts['sittings']} sittings, "
        f"{counts['committee_meetings']} committee meetings), {counts['agenda_items']} agenda items, "
        f"{counts['dossiers']} dossiers, {counts['attendance']} attendance rows"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
