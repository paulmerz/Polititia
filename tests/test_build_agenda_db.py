from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
import zipfile
from pathlib import Path

from build_agenda_db import build, deposit_origin, dossier_kind, fold, timestamp

LEXICON = Path(__file__).resolve().parents[1] / "themes" / "lexicon.json"

SITTING = {
    "@xsi:type": "seance_type",
    "uid": "RUANR5L17S2026IDS1",
    "timeStampDebut": "2026-11-18T15:00:00.000+01:00",
    "timeStampFin": "2026-11-18T20:00:00.000+01:00",
    "lieu": {"lieuRef": "AN", "libelleLong": "Assemblée nationale"},
    "cycleDeVie": {"etat": "Confirmé"},
    "organeReuniRef": "PO1",
    "participants": None,
    "captationVideo": "true",
    "ouverturePresse": "true",
    "compteRenduRef": "CRSANR5L17S2026O1N050",
    "identifiants": {"numSeanceJO": "50"},
    "ODJ": {
        "convocationODJ": {"item": ["Questions au Gouvernement", "Suite de la discussion du projet de loi"]},
        "pointsODJ": {
            "pointODJ": [
                {
                    "uid": "RUANR5L17S2026IDS1PT1",
                    "cycleDeVie": {"etat": "Confirmé"},
                    "objet": "Questions au Gouvernement",
                    "typePointODJ": "Questions au Gouvernement",
                    "procedure": None,
                    "dossiersLegislatifsRefs": None,
                    "natureTravauxODJ": None,
                },
                {
                    "uid": "RUANR5L17S2026IDS1PT2",
                    "cycleDeVie": {"etat": "Eventuel"},
                    "objet": " Suite de la discussion du projet de loi ",
                    "typePointODJ": "Suite de la discussion",
                    "procedure": "discussion générale commune",
                    "dossiersLegislatifsRefs": {"dossierRef": ["DLR5L17N1", "DLR5L17N404", "DLR5L17N1"]},
                    "natureTravauxODJ": "ODJPR",
                    "dateConfPres": "2026-11-10+01:00",
                },
            ]
        },
    },
}

COMMITTEE = {
    "@xsi:type": "reunionCommission_type",
    "uid": "RUANR5L17S2026IDC2",
    "timeStampDebut": "2026-11-19T09:30:00.000+01:00",
    "lieu": {"libelleLong": "Salle 6242"},
    "cycleDeVie": {"etat": "Confirmé"},
    "organeReuniRef": "PO2",
    "compteRenduRef": "CRCANR5L17S2026PO2N010",
    "ODJ": {"convocationODJ": {"item": "Audition du directeur"}, "resumeODJ": None, "pointsODJ": None},
    "participants": {
        "participantsInternes": {
            "participantInterne": [
                {"acteurRef": "PA1", "presence": "présent"},
                {"acteurRef": "PA2", "presence": "excusé"},
                {"acteurRef": "PA3", "presence": "absent"},
                {"acteurRef": "PA3", "presence": "absent"},
            ]
        },
        "personnesAuditionnees": None,
    },
}

CANCELLED = {
    "@xsi:type": "reunionCommission_type",
    "uid": "RUANR5L17S2026IDC3",
    "timeStampDebut": "2026-11-20T10:00:00.000+01:00",
    "cycleDeVie": {"etat": "Annulé"},
    "organeReuniRef": "PO999",
    "ODJ": {"convocationODJ": None, "resumeODJ": {"item": ["Table ronde"]}, "pointsODJ": None},
    "participants": {"participantsInternes": None, "personnesAuditionnees": None},
}


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def make_inputs(root: Path) -> tuple[Path, Path]:
    archive = root / "agenda.json.zip"
    with zipfile.ZipFile(archive, "w") as zf:
        for meeting in (SITTING, COMMITTEE, CANCELLED):
            zf.writestr(f"json/reunion/{meeting['uid']}.json", json.dumps({"reunion": meeting}, ensure_ascii=False))
        zf.writestr("json/readme.txt", "not a meeting")
    open_data = root / "opendata"
    organs = open_data / "amo" / "json" / "organe"
    write_json(organs / "PO1.json", {"organe": {"uid": "PO1", "codeType": "ASSEMBLEE", "libelle": "Assemblée nationale", "libelleAbrege": "AN"}})
    write_json(organs / "PO2.json", {"organe": {"uid": "PO2", "codeType": "COMPER", "libelle": "Commission des affaires sociales", "libelleAbrege": "Affaires sociales"}})
    write_json(organs / "PO50.json", {"organe": {"uid": "PO50", "codeType": "GP", "libelle": "Socialistes et apparentés", "libelleAbrege": "SOC"}})
    write_json(
        open_data / "amo" / "json" / "acteur" / "PA10.json",
        {
            "acteur": {
                "uid": {"#text": "PA10"},
                "etatCivil": {"ident": {"civ": "Mme", "prenom": "Anne", "nom": "Exemple"}},
                "mandats": {"mandat": [
                    {"typeOrgane": "GP", "dateDebut": "2024-07-18", "dateFin": None, "organes": {"organeRef": "PO50"}},
                ]},
            }
        },
    )
    write_json(
        open_data / "dossiers" / "json" / "dossierParlementaire" / "DLR5L17N1.json",
        {
            "dossierParlementaire": {
                "uid": "DLR5L17N1",
                "titreDossier": {"titre": "Fin de vie"},
                "procedureParlementaire": {"libelle": "Proposition de loi ordinaire"},
                "initiateur": {"acteurs": {"acteur": [{"acteurRef": "PA10"}, {"acteurRef": "PA11"}, {"acteurRef": "PA12"}]}},
                "actesLegislatifs": {"acteLegislatif": {
                    "codeActe": "AN1",
                    "actesLegislatifs": {"acteLegislatif": [
                        {"codeActe": "AN1-DEPOT", "dateActe": "2025-03-04T00:00:00.000+01:00", "texteAssocie": "PIONANR5L17B0999"},
                        {"codeActe": "AN1-COM", "actesLegislatifs": {"acteLegislatif": {"codeActe": "AN1-COM-FOND", "organeRef": "PO2"}}},
                    ]},
                }},
            }
        },
    )
    return archive, open_data


class HelperTests(unittest.TestCase):
    def test_states_and_statuses_lose_their_accents(self) -> None:
        self.assertEqual(fold("Confirmé"), "confirme")
        self.assertEqual(fold(" Excusé "), "excuse")
        self.assertEqual(fold(None), "")

    def test_timestamps_drop_milliseconds_and_keep_the_offset(self) -> None:
        self.assertEqual(timestamp("2025-11-07T21:30:00.000+01:00"), "2025-11-07T21:30:00+01:00")
        self.assertEqual(timestamp(None), "")

    def test_dossier_kind_reads_the_procedure_then_the_deposited_text(self) -> None:
        self.assertEqual(dossier_kind("Projet de loi ordinaire", ""), "projet")
        self.assertEqual(dossier_kind("Projet de ratification des traités et conventions", ""), "projet")
        self.assertEqual(dossier_kind("Proposition de loi ordinaire", ""), "proposition")
        self.assertEqual(dossier_kind("Résolution", ""), "resolution")
        self.assertEqual(dossier_kind("Projet ou proposition de loi organique", "PIONANR5L17B0001"), "proposition")
        self.assertEqual(dossier_kind("Projet ou proposition de loi organique", "PRJLANR5L17B0001"), "projet")
        self.assertEqual(dossier_kind("", ""), "")

    def test_deposit_origin(self) -> None:
        self.assertEqual(deposit_origin("AN1-DEPOT"), "assemblee")
        self.assertEqual(deposit_origin("SN1-DEPOT"), "senat")
        self.assertEqual(deposit_origin(""), "")


class BuildTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        archive, open_data = make_inputs(root)
        self.out = root / "out" / "agenda.sqlite"
        self.counts = build(self.out, archive, open_data, LEXICON)
        self.db = sqlite3.connect(self.out)

    def tearDown(self) -> None:
        self.db.close()
        self.tmp.cleanup()

    def test_counts_and_no_leftover_temporary_file(self) -> None:
        self.assertEqual(self.counts["meetings"], 3)
        self.assertEqual(self.counts["sittings"], 1)
        self.assertEqual(self.counts["committee_meetings"], 2)
        self.assertEqual(self.counts["agenda_items"], 2)
        self.assertFalse(self.out.with_suffix(".tmp").exists())

    def test_sitting_row(self) -> None:
        row = self.db.execute(
            "SELECT kind, state, date, starts_at, ends_at, organ_name, organ_type, report_ref, sitting_number, video, topics "
            "FROM meetings WHERE uid = 'RUANR5L17S2026IDS1'"
        ).fetchone()
        self.assertEqual(row[:9], (
            "seance", "confirme", "2026-11-18", "2026-11-18T15:00:00+01:00", "2026-11-18T20:00:00+01:00",
            "Assemblée nationale", "ASSEMBLEE", "CRSANR5L17S2026O1N050", "50",
        ))
        self.assertEqual(row[9], 1)
        self.assertEqual(json.loads(row[10]), ["Questions au Gouvernement", "Suite de la discussion du projet de loi"])

    def test_items_keep_their_order_and_dossiers(self) -> None:
        items = self.db.execute(
            "SELECT position, state, item_type, subject, procedure, nature, conference_date FROM agenda_items "
            "WHERE meeting_uid = 'RUANR5L17S2026IDS1' ORDER BY position"
        ).fetchall()
        self.assertEqual(items[0], (1, "confirme", "Questions au Gouvernement", "Questions au Gouvernement", "", "", ""))
        self.assertEqual(items[1], (
            2, "eventuel", "Suite de la discussion", "Suite de la discussion du projet de loi",
            "discussion générale commune", "ODJPR", "2026-11-10",
        ))
        links = self.db.execute("SELECT dossier_uid, dossier_title FROM agenda_item_dossiers ORDER BY dossier_uid").fetchall()
        # The repeated reference is stored once; an unknown dossier keeps an empty title.
        self.assertEqual(links, [("DLR5L17N1", "Fin de vie"), ("DLR5L17N404", "")])

    def test_dossiers_on_the_agenda(self) -> None:
        rows = self.db.execute(
            "SELECT uid, title, kind, origin, procedure, deposited_on, committee_ref, committee_name, "
            "author_id, author_name, author_group, coauthors, themes FROM dossiers ORDER BY uid"
        ).fetchall()
        self.assertEqual(self.counts["dossiers"], 2)
        self.assertEqual(rows[0][:12], (
            "DLR5L17N1", "Fin de vie", "proposition", "assemblee", "Proposition de loi ordinaire", "2025-03-04",
            "PO2", "Affaires sociales", "PA10", "Mme Anne Exemple", "SOC", 2,
        ))
        self.assertEqual(json.loads(rows[0][12]), [{"id": "fin-de-vie", "label": "Fin de vie"}])
        # A dossier missing from the download keeps its uid; its subject alone names no theme.
        self.assertEqual(rows[1], ("DLR5L17N404", "", "", "", "", "", "", "", "", "", "", 0, "[]"))

    def test_committee_attendance_and_topics(self) -> None:
        rows = self.db.execute("SELECT acteur_id, status FROM attendance ORDER BY acteur_id").fetchall()
        self.assertEqual(rows, [("PA1", "present"), ("PA2", "excuse"), ("PA3", "absent")])
        organ, topics = self.db.execute("SELECT organ_short, topics FROM meetings WHERE uid = 'RUANR5L17S2026IDC2'").fetchone()
        self.assertEqual(organ, "Affaires sociales")
        self.assertEqual(json.loads(topics), ["Audition du directeur"])

    def test_cancelled_meeting_with_an_unknown_organ(self) -> None:
        row = self.db.execute(
            "SELECT state, organ_ref, organ_name, organ_type, report_ref, topics FROM meetings WHERE uid = 'RUANR5L17S2026IDC3'"
        ).fetchone()
        # Without a convocation, the summary of the order of business is used.
        self.assertEqual(row, ("annule", "PO999", "", "", "", '["Table ronde"]'))

    def test_meta(self) -> None:
        meta = {key: json.loads(value) for key, value in self.db.execute("SELECT key, value FROM meta")}
        self.assertEqual(meta["first_date"], "2026-11-18")
        self.assertEqual(meta["last_date"], "2026-11-20")
        self.assertEqual(meta["last_confirmed_sitting"], "2026-11-18")
        self.assertEqual(meta["attendance_statuses"], {"absent": 1, "excuse": 1, "present": 1})
        self.assertEqual(meta["counts"]["attendance"], 3)
        self.assertTrue(meta["built_at"].endswith("Z"))


if __name__ == "__main__":
    unittest.main()
