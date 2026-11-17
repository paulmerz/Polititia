#!/usr/bin/env python3
"""Build analysis_outputs/agenda.sqlite from the Assemblée nationale Agenda dataset.

The Agenda dataset (repository/17/vp/reunions/Agenda.json.zip) lists every public
sitting and committee meeting of the legislature, past and announced, with:

- the order of business of each sitting, item by item, and the legislative
  dossier each item is about;
- the topics of each committee meeting;
- for committee meetings, every member of the organ marked present, excused or
  absent (checked against the committee reports, see roadmap.md § 6.1).

It changes every day while analytics.sqlite is rebuilt once a week, so it gets a
database of its own (schema: agenda_schema.sql). The ZIP is read directly. Organ
names come from the AMO download and dossier titles from the dossiers download;
both are optional.

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

DEFAULT_ARCHIVE = Path("data/raw/opendata/agenda.json.zip")
DEFAULT_OPEN_DATA_DIR = Path("data/raw/opendata")
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


class DossierTitles:
    """Title of a legislative dossier, read on demand from the dossiers download."""

    def __init__(self, open_data: Path) -> None:
        self.directory = open_data / "dossiers" / "json" / "dossierParlementaire"
        self.cache: dict[str, str] = {}

    def get(self, uid: str) -> str:
        if uid not in self.cache:
            path = self.directory / f"{uid}.json"
            title = ""
            if path.is_file():
                raw = json.loads(path.read_text(encoding="utf-8")).get("dossierParlementaire", {})
                title = (raw.get("titreDossier") or {}).get("titre") or ""
            self.cache[uid] = title
        return self.cache[uid]


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


def build(out: Path, archive: Path, open_data: Path) -> dict[str, int]:
    organs = Organs(open_data)
    titles = DossierTitles(open_data)
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
                db.execute(
                    "INSERT INTO agenda_items VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        point["uid"],
                        meeting["uid"],
                        position,
                        fold((point.get("cycleDeVie") or {}).get("etat")),
                        point.get("typePointODJ") or "",
                        (point.get("objet") or "").strip(),
                        point.get("procedure") or "",
                        point.get("natureTravauxODJ") or "",
                        (point.get("dateConfPres") or "")[:10],
                    ),
                )
                refs = as_list((point.get("dossiersLegislatifsRefs") or {}).get("dossierRef"))
                db.executemany(
                    "INSERT OR IGNORE INTO agenda_item_dossiers VALUES (?, ?, ?)",
                    [(point["uid"], ref, titles.get(ref)) for ref in dict.fromkeys(refs) if ref],
                )
            members = ((meeting.get("participants") or {}).get("participantsInternes") or {}).get("participantInterne")
            for member in as_list(members):
                acteur = member.get("acteurRef")
                if not acteur:
                    continue
                status = ATTENDANCE.get(fold(member.get("presence")), fold(member.get("presence")))
                db.execute("INSERT OR IGNORE INTO attendance VALUES (?, ?, ?)", (meeting["uid"], acteur, status))

    def scalar(sql: str) -> object:
        return db.execute(sql).fetchone()[0]

    counts = {
        "meetings": int(scalar("SELECT COUNT(*) FROM meetings")),
        "sittings": int(scalar("SELECT COUNT(*) FROM meetings WHERE kind = 'seance'")),
        "committee_meetings": int(scalar("SELECT COUNT(*) FROM meetings WHERE kind = 'commission'")),
        "agenda_items": int(scalar("SELECT COUNT(*) FROM agenda_items")),
        "item_dossiers": int(scalar("SELECT COUNT(*) FROM agenda_item_dossiers")),
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
    counts = build(args.out, args.agenda, args.open_data)
    print(
        f"Wrote {args.out}: {counts['meetings']} meetings ({counts['sittings']} sittings, "
        f"{counts['committee_meetings']} committee meetings), {counts['agenda_items']} agenda items, "
        f"{counts['item_dossiers']} dossier links, {counts['attendance']} attendance rows"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
