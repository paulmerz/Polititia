from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from xml.etree import ElementTree as ET

from asides import (
    eligible_favorite,
    find_mentions,
    other_bench,
    reaction_kind,
    style_counts,
    surname_index,
    surname_key,
)
from extract_speeches import collect_asides, extract_speeches, process_glob


FIXTURE = Path(__file__).resolve().parent / "fixtures" / "asides_mini.xml"


class AsideRuleTests(unittest.TestCase):
    def test_a_short_named_line_can_become_a_favorite(self) -> None:
        self.assertTrue(eligible_favorite("Mme Mathilde Panot LFI NFP", "C'est une blague !"))
        self.assertFalse(eligible_favorite("Mme la présidente", "Veuillez conclure."))
        self.assertFalse(eligible_favorite("Un député du groupe LFI-NFP", "Ce n'est pas sérieux."))
        self.assertFalse(eligible_favorite("M. Laurent Wauquiez DR", "Monsieur le président, je demande la parole."))
        self.assertFalse(eligible_favorite("Mme Mathilde Panot LFI NFP", "Oui."))

    def test_reaction_kind_and_other_benches(self) -> None:
        self.assertEqual(reaction_kind("Rires et applaudissements"), "rire")
        self.assertEqual(reaction_kind("Applaudissements sur les bancs du groupe RN."), "applaudissement")
        self.assertFalse(other_bench("Applaudissements sur les bancs du groupe RN."))
        self.assertTrue(other_bench("Rires sur divers bancs."))
        self.assertTrue(other_bench("Applaudissements sur les bancs des groupes RN et EPR."))

    def test_wording_counts_obligation_possibility_and_skips_peut_etre(self) -> None:
        counts = style_counts("Nous devons tenir. Il peut rester. Ce n'est pas un abandon. Peut-être demain. Je vous le dis.")
        self.assertEqual(counts["obligation"], 1)
        self.assertEqual(counts["possibility"], 1)
        self.assertEqual(counts["negation"], 1)
        self.assertGreaterEqual(counts["je"], 1)
        self.assertGreaterEqual(counts["vous"], 1)
        self.assertGreaterEqual(counts["nous"], 1)

    def test_a_shared_surname_is_not_a_mention(self) -> None:
        self.assertEqual(surname_key("M. Laurent Wauquiez"), "wauquiez")
        index = surname_index([(1, "M. Laurent Wauquiez"), (2, "Mme Alice Wauquiez"), (3, "Mme Mathilde Panot")])
        self.assertEqual(index, {"panot": 3})
        self.assertEqual(find_mentions("Monsieur Wauquiez, nous devons tenir.", {"wauquiez": 7}, 3), [(7, "Monsieur Wauquiez, nous devons tenir.")])
        self.assertEqual(find_mentions("Monsieur Wauquiez, nous devons tenir.", {"wauquiez": 3}, 3), [])


class AsideExtractTests(unittest.TestCase):
    def test_fixture_keeps_interruptions_out_of_speeches(self) -> None:
        segments, meta = extract_speeches(str(FIXTURE))
        self.assertEqual([segment["speaker"] for segment in segments], ["Mme Mathilde Panot LFI NFP"])
        rows = collect_asides(ET.parse(FIXTURE).getroot(), meta)
        kinds = [(row["record"], row.get("quote"), row.get("keep"), row.get("kind")) for row in rows]
        self.assertIn(("interruption", "C'est une blague !", 1, None), kinds)
        self.assertIn(("interruption", "Monsieur le président, je demande la parole.", 0, None), kinds)
        self.assertIn(("interruption", "Ce n'est pas sérieux.", 0, None), kinds)
        self.assertFalse(any("conclure" in row["quote"] for row in rows))
        laugh = next(row for row in rows if row["record"] == "reaction")
        self.assertEqual(laugh["kind"], "rire")
        self.assertEqual(laugh["other_bench"], 1)
        self.assertIn("Wauquiez", laugh["quote"])

    def test_process_glob_writes_asides(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            process_glob(str(FIXTURE), tmp)
            rows = [json.loads(line) for line in (Path(tmp) / "asides.jsonl").read_text(encoding="utf-8").splitlines()]
            self.assertTrue(any(row["record"] == "interruption" and row["keep"] == 1 for row in rows))
            speeches = [json.loads(line) for line in (Path(tmp) / "speeches.jsonl").read_text(encoding="utf-8").splitlines()]
            self.assertEqual(len(speeches), 1)
            self.assertNotIn("blague", speeches[0]["text"].lower())
            self.assertNotIn("Rires", speeches[0]["text"])


if __name__ == "__main__":
    unittest.main()
