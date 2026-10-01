from __future__ import annotations

import tempfile
import unittest
from collections import Counter
from pathlib import Path

from analyze_themes import (
    best_paragraph,
    load_jsonl,
    load_lexicon,
    passes_text_rule,
    run,
    text_hits,
    title_themes,
)
from extract_speeches import process_glob


FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures"
LEXICON_PATH = Path(__file__).resolve().parents[1] / "themes" / "lexicon.json"
NO_OPEN_DATA = Path("/nonexistent-open-data")


class TitleTests(unittest.TestCase):
    def setUp(self) -> None:
        self.lexicon = load_lexicon(LEXICON_PATH)

    def test_question_topic_names_theme(self) -> None:
        self.assertEqual(title_themes("Indemnisation des chômeurs", self.lexicon), ["emploi-chomage"])

    def test_longer_keyword_masks_shorter(self) -> None:
        themes = title_themes("Projet de loi de financement de la sécurité sociale pour 2026", self.lexicon)
        self.assertIn("protection-sociale", themes)
        self.assertNotIn("securite", themes)

    def test_legitimate_defence_is_not_defence_policy(self) -> None:
        themes = title_themes("Présomption de légitime défense pour les forces de l’ordre", self.lexicon)
        self.assertNotIn("defense", themes)
        self.assertIn("securite", themes)

    def test_omnibus_title_names_no_theme(self) -> None:
        title = (
            "Adaptation au droit de l’Union européenne en matière économique, financière, "
            "environnementale, énergétique, de transport, de santé et de circulation des personnes"
        )
        self.assertEqual(title_themes(title, self.lexicon), [])


class TextRuleTests(unittest.TestCase):
    def setUp(self) -> None:
        self.lexicon = load_lexicon(LEXICON_PATH)

    def test_single_mention_is_not_enough(self) -> None:
        text = (
            "Les demandeurs d'emploi diplômés de l'enseignement supérieur bénéficient de droits longs "
            "et la réforme de l'assurance chômage réduit leur durée d'indemnisation de plusieurs mois."
        )
        hits = text_hits(text, self.lexicon)
        self.assertNotIn("enseignement-superieur", hits)

    def test_requires_and_excludes(self) -> None:
        hits = text_hits("L'enseignement supérieur et les universités manquent de moyens.", self.lexicon)
        self.assertIn("enseignement superieur", hits["enseignement-superieur"])

    def test_two_distinct_expressions_pass(self) -> None:
        hits = Counter({"aide a mourir": 1, "soins palliatifs": 1})
        self.assertTrue(passes_text_rule(hits, 40))

    def test_single_word_needs_three_mentions(self) -> None:
        self.assertFalse(passes_text_rule(Counter({"pauvrete": 2}), 40))
        self.assertTrue(passes_text_rule(Counter({"pauvrete": 3}), 40))

    def test_weak_expressions_never_suffice(self) -> None:
        weak = self.lexicon.weak_phrases
        self.assertIn("maires", weak)
        self.assertFalse(passes_text_rule(Counter({"maires": 2, "elus locaux": 2}), 40, weak))
        self.assertTrue(passes_text_rule(Counter({"maires": 2, "decentralisation": 1}), 40, weak))

    def test_density(self) -> None:
        self.assertFalse(passes_text_rule(Counter({"aide a mourir": 1, "soins palliatifs": 1}), 1000))


class ExcerptTests(unittest.TestCase):
    def test_whole_paragraph_about_the_theme(self) -> None:
        text = "Merci, madame la présidente.\n\nL'aide à mourir doit rester encadrée, et les soins palliatifs accessibles partout."
        index, excerpt = best_paragraph(text, ["aide a mourir", "soins palliatifs"])
        self.assertEqual(index, 1)
        self.assertTrue(excerpt.startswith("L'aide à mourir"))
        self.assertTrue(excerpt.endswith("partout."))


class AttributionTests(unittest.TestCase):
    def extract(self, pattern: str, out_dir: Path) -> list[dict[str, str]]:
        process_glob(str(FIXTURE_DIR / pattern), str(out_dir))
        return load_jsonl(out_dir / "speeches.jsonl")

    def test_gruet_question_on_unemployment_is_not_higher_education(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out_dir = Path(tmp)
            speeches = self.extract("context_seance.xml", out_dir)
            bundle, attributions = run(
                speeches,
                load_lexicon(LEXICON_PATH),
                out_dir / "by_speaker",
                NO_OPEN_DATA,
                use_relevance=False,
            )
            by_actor: dict[str, set[str]] = {}
            methods: dict[tuple[str, str], str] = {}
            for item in attributions:
                by_actor.setdefault(str(item["acteur_id"]), set()).add(str(item["theme_id"]))
                methods[(str(item["acteur_id"]), str(item["theme_id"]))] = str(item["method"])

            self.assertIn("emploi-chomage", by_actor["PA111"])
            self.assertEqual(methods[("PA111", "emploi-chomage")], "debate")
            self.assertNotIn("enseignement-superieur", by_actor["PA111"])
            self.assertNotIn("education", by_actor["PA111"])
            self.assertIn("fin-de-vie", by_actor["PA333"])

            excerpts = bundle["themeExcerpts"]["emploi-chomage"]
            self.assertTrue(all(item["debate"] == "Indemnisation des chômeurs" for item in excerpts))
            self.assertTrue(all("/comptes-rendus/seance/" in item["url"] for item in excerpts))

    def test_bundle_shape(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out_dir = Path(tmp)
            speeches = self.extract("compte_rendu_*.xml", out_dir)
            bundle, _attributions = run(
                speeches,
                load_lexicon(LEXICON_PATH),
                out_dir / "by_speaker",
                NO_OPEN_DATA,
                use_relevance=False,
            )
            catalog = {theme["id"]: theme for theme in bundle["themes"]}
            self.assertEqual(catalog["fin-de-vie"]["type"], "theme")
            self.assertEqual(catalog["fin-de-vie"]["parent"], "social")
            self.assertEqual(catalog["social"]["type"], "domain")
            self.assertGreaterEqual(catalog["fin-de-vie"]["speechCount"], 1)
            self.assertFalse(any(theme["type"] == "emerging" for theme in bundle["themes"]))
            for key in ("politicianThemeScores", "partyThemeSeries", "themeOwnership", "themeExcerpts", "politicianThemeExcerpts"):
                self.assertIn(key, bundle)


if __name__ == "__main__":
    unittest.main()
