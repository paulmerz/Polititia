from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from analyze_themes import build_bundle, excerpt_for, load_jsonl, load_lexicon, match_themes
from extract_speeches import process_glob


FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures"
LEXICON_PATH = Path(__file__).resolve().parents[1] / "themes" / "lexicon.json"


class ThemeMatchingTests(unittest.TestCase):
    def test_alias_subsequence(self) -> None:
        themes = load_lexicon(LEXICON_PATH)
        tokens = "nous défendons l aide à mourir comme une liberté".split()
        self.assertIn("fin-de-vie", match_themes(tokens, themes))

    def test_excerpt_centers_on_alias(self) -> None:
        text = "Avant le vote, l'aide à mourir doit rester un choix libre et accompagné."
        snippet = excerpt_for(text, ["aide à mourir"])
        self.assertIn("aide à mourir", snippet)


class ThemeBundleTests(unittest.TestCase):
    def test_fixture_attribution_burst_and_excerpts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out_dir = Path(tmp)
            process_glob(str(FIXTURE_DIR / "compte_rendu_*.xml"), str(out_dir))
            speeches = load_jsonl(out_dir / "speeches.jsonl")
            lexicon = load_lexicon(LEXICON_PATH)
            bundle = build_bundle(
                speeches,
                lexicon,
                out_dir / "by_speaker",
                min_burst_count=2,
                min_burst_speakers=2,
                max_emerging=10,
            )

            catalog = {theme["id"]: theme for theme in bundle["themes"]}
            self.assertIn("fin-de-vie", catalog)
            self.assertGreaterEqual(catalog["fin-de-vie"]["speechCount"], 4)
            self.assertEqual(catalog["fin-de-vie"]["firstDate"], "2024-03-12")

            emerging_ids = [theme["id"] for theme in bundle["themes"] if theme["type"] == "emerging"]
            self.assertTrue(any("qasoldy" in theme_id for theme_id in emerging_ids))

            scores = bundle["politicianThemeScores"]
            epr_id = "mme-sophie-panonacle--epr"
            self.assertIn(epr_id, scores)
            self.assertIn("fin-de-vie", scores[epr_id])

            excerpts = bundle["themeExcerpts"]["fin-de-vie"]
            self.assertTrue(excerpts)
            self.assertTrue(any(item["snippet"] for item in excerpts))

            ownership = bundle["themeOwnership"]["fin-de-vie"]
            self.assertTrue(ownership)
            self.assertTrue(all("lift" in row for row in ownership))


if __name__ == "__main__":
    unittest.main()
