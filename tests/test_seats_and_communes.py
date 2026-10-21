from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

from reference_data import ReferenceData
from scripts.build_communes import candidates, load_postcode_names, split_circo

ROOT = Path(__file__).resolve().parents[1]


def load_builder():
    path = ROOT / "dashboard" / "build_dashboard_data.py"
    spec = importlib.util.spec_from_file_location("build_dashboard_data", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def write_actor(directory: Path, uid: str, mandates: list[dict], emails: list[str]) -> None:
    acteur = {
        "uid": {"#text": uid},
        "etatCivil": {"ident": {"civ": "Mme", "prenom": "Alice", "nom": "Zéro"}},
        "mandats": {"mandat": mandates},
        "adresses": {"adresse": [{"type": "15", "valElec": email} for email in emails] + [{"type": "11", "valElec": "01 02"}]},
    }
    (directory / f"{uid}.json").write_text(json.dumps({"acteur": acteur}), encoding="utf-8")


def assembly_mandate(start: str, end: str | None, department: str, number: str, legislature: str = "17") -> dict:
    return {
        "typeOrgane": "ASSEMBLEE",
        "legislature": legislature,
        "dateDebut": start,
        "dateFin": end,
        "election": {"lieu": {"numDepartement": department, "departement": "Gironde", "numCirco": number}},
    }


class SeatTests(unittest.TestCase):
    def reference(self, mandates: list[dict], emails: list[str]) -> ReferenceData:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        directory = Path(tmp.name) / "amo" / "json" / "acteur"
        directory.mkdir(parents=True)
        write_actor(directory, "PA1", mandates, emails)
        return ReferenceData(Path(tmp.name))

    def test_open_seat_and_assembly_email_win(self) -> None:
        reference = self.reference(
            [
                assembly_mandate("2024-07-08", "2025-01-01", "33", "2"),
                assembly_mandate("2025-03-01", None, "33", "4"),
                assembly_mandate("2022-06-22", None, "75", "1", legislature="16"),
            ],
            ["alice@mairie.example", "alice.zero@assemblee-nationale.fr"],
        )
        actor = reference.actor("PA1")
        assert actor is not None
        seat = actor.current_seat()
        assert seat is not None
        self.assertEqual((seat.department, seat.number, seat.end), ("33", 4, ""))
        self.assertEqual(len(actor.seats), 2, "only the 17th legislature counts")
        self.assertEqual(actor.official_email(), "alice.zero@assemblee-nationale.fr")
        payload = load_builder().seat_payload(reference, "PA1")
        self.assertEqual(payload, {"dept": "33", "deptName": "Gironde", "circo": 4, "current": True})

    def test_a_former_deputy_keeps_the_latest_seat(self) -> None:
        reference = self.reference([assembly_mandate("2024-07-08", "2024-10-01", "33", "2")], ["alice@example.org"])
        actor = reference.actor("PA1")
        assert actor is not None
        self.assertEqual(actor.official_email(), "alice@example.org")
        payload = load_builder().seat_payload(reference, "PA1")
        self.assertEqual(payload, {"dept": "33", "deptName": "Gironde", "circo": 2, "current": False})
        self.assertIsNone(load_builder().seat_payload(reference, "PA404"))


class CommuneTests(unittest.TestCase):
    def test_split_circo_handles_corsica_and_overseas(self) -> None:
        self.assertEqual(split_circo("01004"), ("01", 4))
        self.assertEqual(split_circo("2A001"), ("2A", 1))
        self.assertEqual(split_circo("97601"), ("976", 1))
        self.assertEqual(split_circo("97801"), ("977", 1), "Saint-Martin is filed under 977 by the Assembly")

    def test_postcode_names_are_readable(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "codes.csv"
            path.write_text(
                "#Code_commune_INSEE;Nom_de_la_commune;Code_postal\n"
                "60470;L OIE;60600\n"
                "33476;STE FLORENCE SUR DROPT;33350\n"
                "33476;AUTRE NOM;33350\n",
                encoding="latin-1",
            )
            names = load_postcode_names(path)
        self.assertEqual(names["60470"], "L'Oie")
        self.assertEqual(names["33476"], "Sainte-Florence-sur-Dropt", "the first spelling is kept")

    def test_candidates_identify_a_constituency(self) -> None:
        header = ["Code", "Nom candidat 1", "Voix 1", "Nom candidat 2"]
        self.assertEqual(candidates(["x", " Dupont ", "12", "martin"], header), frozenset({"DUPONT", "MARTIN"}))


if __name__ == "__main__":
    unittest.main()
