from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from xml.etree import ElementTree as ET

from asides import (
    applause,
    eligible_favorite,
    excerpt_around,
    find_mentions,
    last_sentence,
    mention_index,
    other_camps,
    protest,
    sentence_spans,
    split_name,
    style_counts,
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

    def test_applause_keeps_its_groups_and_drops_the_protests(self) -> None:
        found = applause("Applaudissements sur les bancs des groupes RN et UDR. – Protestations sur les bancs du groupe LFI-NFP.")
        self.assertEqual(found.groups, ("RN", "UDR"))
        self.assertEqual(found.detail, "Applaudissements sur les bancs des groupes RN et UDR.")
        self.assertIsNone(applause("Rires sur divers bancs."))
        self.assertEqual(applause("M. Marc Pena applaudit.").groups, ())
        self.assertTrue(applause("Applaudissements sur tous les bancs.").every_bench)
        self.assertTrue(applause("Applaudissements sur divers bancs.").unnamed_benches)
        self.assertFalse(applause("Applaudissements sur de nombreux bancs du groupe EPR.").unnamed_benches)

    def test_only_the_applauding_groups_count(self) -> None:
        def groups(direction: str) -> tuple[str, ...] | None:
            found = applause(direction)
            return found.groups if found else None

        # Mathilde Panot, 29 octobre 2026: RN and UDR are booed, not applauding.
        self.assertEqual(
            groups("Les députés du groupe LFI-NFP se lèvent, applaudissent l’oratrice et huent les députés des groupes RN et UDR."),
            ("LFI_NFP",),
        )
        self.assertIsNone(groups("Applaudissements ironiques sur quelques bancs du groupe RN."))
        self.assertEqual(
            groups("Applaudissements sur les bancs du groupe LFI-NFP – « Bravo ! » et applaudissements ironiques sur quelques bancs des groupes RN et UDR."),
            ("LFI_NFP",),
        )
        self.assertEqual(groups("Applaudissements sur les bancs du groupe RN et UDR. –Exclamations sur les bancs du groupe LFI-NFP."), ("RN", "UDR"))
        self.assertEqual(groups("Applaudissements sur les bancs du groupe LFI-NFP. Exclamations sur les bancs du groupe RN."), ("LFI_NFP",))
        self.assertEqual(groups("Exclamations sur les bancs du groupe RN et applaudissements sur les bancs du groupe LFI-NFP."), ("LFI_NFP",))
        self.assertEqual(groups("Applaudissements et exclamations sur les bancs du groupe RN."), ("RN",))
        self.assertEqual(groups("Applaudissements sur les bancs du groupe LFI-NFP. – L’orateur se tourne vers les bancs du groupe RN."), ("LFI_NFP",))
        self.assertEqual(groups("Applaudissements sur les bancs du groupe LFI-NFP, tournés vers les bancs du groupe RN."), ("LFI_NFP",))
        self.assertEqual(
            groups("Les députés des groupes EPR, SOC et GDR se tournent vers les tribunes et applaudissent."),
            ("EPR", "GDR", "SOC"),
        )
        self.assertEqual(groups("Les députés du groupe DR applaudissent, ainsi que plusieurs députés du groupe EPR."), ("DR", "EPR"))
        self.assertTrue(applause("Sur tous les bancs, les députés, dont beaucoup se sont levés, applaudissent longuement.").every_bench)

    def test_protests_keep_the_benches_that_protest_at_the_speaker(self) -> None:
        def groups(direction: str) -> tuple[str, ...] | None:
            found = protest(direction)
            return found.groups if found else None

        self.assertEqual(groups("Applaudissements sur les bancs des groupes RN et UDR. – Protestations sur les bancs du groupe LFI-NFP."), ("LFI_NFP",))
        self.assertEqual(groups("Exclamations sur les bancs des groupes EPR et HOR. – Huées sur plusieurs bancs du groupe RN"), ("EPR", "HOR", "RN"))
        self.assertEqual(groups("Applaudissements et exclamations sur les bancs du groupe RN."), ("RN",))
        self.assertEqual(groups("Les députés du groupe DR protestent, ainsi que plusieurs députés du groupe EPR."), ("DR", "EPR"))
        self.assertEqual(groups("Les députés du groupe RN huent l’oratrice."), ("RN",))
        self.assertIsNone(groups("Applaudissements sur les bancs du groupe LFI-NFP."))
        self.assertIsNone(groups("Rires et murmures sur les bancs du groupe RN."))
        # Aimed at other deputies, not at the speaker.
        self.assertIsNone(groups("Les députés du groupe LFI-NFP se lèvent, applaudissent l’oratrice et huent les députés des groupes RN et UDR."))
        self.assertIsNone(groups("Huées sur plusieurs bancs des groupes UDR et RN à l’adresse des députés du groupe LFI-NFP."))
        self.assertEqual(groups("Exclamations sur les bancs du groupe RN à l’adresse de l’orateur."), ("RN",))
        self.assertEqual(protest("Protestations sur divers bancs.").unnamed_benches, True)
        self.assertEqual(
            protest("Applaudissements sur les bancs du groupe SOC. – Vives protestations sur les bancs du groupe RN.").detail,
            "Vives protestations sur les bancs du groupe RN.",
        )

    def test_applause_from_an_ally_stays_in_camp(self) -> None:
        self.assertEqual(other_camps(["EcoS", "GDR", "LFI_NFP"], False, False, "LFI_NFP"), 0)
        self.assertEqual(other_camps(["DR", "LFI_NFP"], False, False, "LFI_NFP"), 1)
        self.assertEqual(other_camps(["DR", "EPR", "RN"], False, False, "SOC"), 3)
        self.assertEqual(other_camps([], True, False, "RN"), 5)
        self.assertEqual(other_camps([], False, True, "RN"), 1)
        self.assertEqual(other_camps(["RN"], False, False, "GOUV"), 0)

    def test_wording_counts_obligation_possibility_and_skips_peut_etre(self) -> None:
        counts = style_counts("Nous devons tenir. Il peut rester. Ce n'est pas un abandon. Peut-être demain. Je vous le dis.")
        self.assertEqual(counts["obligation"], 1)
        self.assertEqual(counts["possibility"], 1)
        self.assertEqual(counts["negation"], 1)
        self.assertGreaterEqual(counts["je"], 1)
        self.assertGreaterEqual(counts["vous"], 1)
        self.assertGreaterEqual(counts["nous"], 1)

    def test_an_abbreviation_does_not_end_a_sentence(self) -> None:
        text = "Ce budget est pire que celui de M. Barnier. Pire budget, même tarif : la censure."
        self.assertEqual(len(sentence_spans(text)), 2)
        start = text.index("Barnier")
        self.assertEqual(excerpt_around(text, start, start + 7), "Ce budget est pire que celui de M. Barnier.")
        self.assertEqual(last_sentence("Il l’a dit à J.-L. Mélenchon. « Nous voterons contre. »"), "« Nous voterons contre. »")

    def test_a_long_sentence_is_cut_around_the_name(self) -> None:
        text = "Nos collègues ont donné des descriptions " + "très longues, " * 30 + "et nous ne sommes pas invités chez Mme Chikirou, hélas."
        start = text.index("Chikirou")
        quote = excerpt_around(text, start, start + 8)
        self.assertIn("Mme Chikirou", quote)
        self.assertTrue(quote.startswith("…"))
        self.assertLessEqual(len(quote), 245)
        tail = last_sentence("Une phrase " + "vraiment longue " * 30 + "qui finit ici.")
        self.assertTrue(tail.startswith("…") and tail.endswith("qui finit ici."))

    def test_names_need_the_right_civility_or_first_name(self) -> None:
        self.assertEqual(split_name("Mme Sandrine Dogor-Such"), ("Mme", "Sandrine", "Dogor-Such"))
        self.assertEqual(split_name("M. Charles de Courson"), ("M.", "Charles", "de Courson"))
        index = mention_index([
            (1, "M.", "Laurent", "Wauquiez"),
            (2, "Mme", "Marine", "Le Pen"),
            (3, "Mme", "Mathilde", "Panot"),
            (4, "M.", "Jean", "Martin"),
            (5, "Mme", "Pascale", "Martin"),
            (6, "Mme", "Sandrine", "Dogor-Such"),
        ])
        self.assertEqual(find_mentions("Monsieur Wauquiez, nous devons tenir.", index, 3), [(1, "Monsieur Wauquiez, nous devons tenir.")])
        self.assertEqual(find_mentions("Le groupe présidé par Laurent Wauquiez.", index, 3), [(1, "Le groupe présidé par Laurent Wauquiez.")])
        self.assertEqual(find_mentions("Monsieur Wauquiez, nous devons tenir.", index, 1), [])
        self.assertEqual(
            find_mentions("Le Front national de Jean-Marie Le Pen le voulait. Le groupe de Mme Le Pen a voté pour.", index, 3),
            [(2, "Le groupe de Mme Le Pen a voté pour.")],
        )
        self.assertEqual(find_mentions("M. Le Pen le voulait.", index, 3), [])
        sentence = "Comme l’a dit Mme Martin, puis M. Martin."
        self.assertEqual(find_mentions(sentence, index, 3), [(5, sentence), (4, sentence)])
        self.assertEqual(find_mentions("Merci, madame Dogor-Such.", index, 3), [(6, "Merci, madame Dogor-Such.")])

    def test_a_shared_surname_needs_the_first_name(self) -> None:
        index = mention_index([(1, "M.", "Laurent", "Wauquiez"), (2, "M.", "Alain", "Wauquiez")])
        self.assertEqual(find_mentions("Monsieur Wauquiez, nous devons tenir.", index, 9), [])
        self.assertEqual(find_mentions("Alain Wauquiez a raison.", index, 9), [(2, "Alain Wauquiez a raison.")])

    def test_a_collective_speaker_is_never_named(self) -> None:
        index = mention_index([(1, "", *split_name("Les députés du groupe")[1:])])
        self.assertEqual(find_mentions("Les députés du groupe RN applaudissent.", index, 9), [])


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

    def test_applause_follows_the_sentence_it_answers(self) -> None:
        segments, meta = extract_speeches(str(FIXTURE))
        rows = collect_asides(ET.parse(FIXTURE).getroot(), meta)
        applauded = [row for row in rows if row["record"] == "reaction" and row["kind"] == "applaudissement"]
        self.assertEqual(
            [(row["quote"], row["groups"]) for row in applauded],
            [
                ("Nous défendons les soins et il peut rester.", ["LFI_NFP"]),
                ("Monsieur Wauquiez, nous devons tenir comme l'a dit M. Bayrou.", ["DR", "LFI_NFP"]),
            ],
        )
        self.assertEqual(applauded[1]["detail"], "Applaudissements sur les bancs des groupes LFI-NFP et DR.")
        protested = [row for row in rows if row["record"] == "reaction" and row["kind"] == "protestation"]
        self.assertEqual(
            [(row["quote"], row["groups"], row["detail"]) for row in protested],
            [("Monsieur Wauquiez, nous devons tenir comme l'a dit M. Bayrou.", ["RN"], "Protestations sur les bancs du groupe RN.")],
        )

    def test_process_glob_writes_asides(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            process_glob(str(FIXTURE), tmp)
            rows = [json.loads(line) for line in (Path(tmp) / "asides.jsonl").read_text(encoding="utf-8").splitlines()]
            self.assertTrue(any(row["record"] == "interruption" and row["keep"] == 1 for row in rows))
            speeches = [json.loads(line) for line in (Path(tmp) / "speeches.jsonl").read_text(encoding="utf-8").splitlines()]
            self.assertEqual(len(speeches), 1)
            self.assertNotIn("blague", speeches[0]["text"].lower())
            self.assertNotIn("Rires", speeches[0]["text"])
            self.assertNotIn("Applaudissements", speeches[0]["text"])


if __name__ == "__main__":
    unittest.main()
