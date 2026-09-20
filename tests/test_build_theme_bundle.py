from __future__ import annotations

import importlib.util
import json
import unittest
from pathlib import Path


def load_builder():
    path = Path(__file__).resolve().parents[1] / "dashboard" / "build_dashboard_data.py"
    spec = importlib.util.spec_from_file_location("build_dashboard_data", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class ThemeBundleLoadTests(unittest.TestCase):
    def test_empty_bundle_keys(self) -> None:
        module = load_builder()
        bundle = module.EMPTY_THEME_BUNDLE
        self.assertEqual(bundle["themes"], [])
        self.assertEqual(bundle["politicianThemeScores"], {})

    def test_reads_written_bundle(self) -> None:
        module = load_builder()
        payload = {
            "themes": [{"id": "fin-de-vie", "label": "Fin de vie"}],
            "politicianThemeScores": {"mme-sophie-panonacle--epr": {"fin-de-vie": {"speechCount": 2}}},
            "partyThemeSeries": {},
            "themeOwnership": {},
            "themeExcerpts": {},
            "politicianThemeExcerpts": {},
        }
        module.THEME_BUNDLE_PATH.parent.mkdir(parents=True, exist_ok=True)
        original = module.THEME_BUNDLE_PATH.read_text(encoding="utf-8") if module.THEME_BUNDLE_PATH.exists() else None
        try:
            module.THEME_BUNDLE_PATH.write_text(json.dumps(payload), encoding="utf-8")
            bundle = module.build_theme_bundle()
            self.assertEqual(bundle["themes"][0]["id"], "fin-de-vie")
            self.assertIn("mme-sophie-panonacle--epr", bundle["politicianThemeScores"])
            self.assertTrue(bundle["source"])
        finally:
            if original is None:
                module.THEME_BUNDLE_PATH.unlink(missing_ok=True)
            else:
                module.THEME_BUNDLE_PATH.write_text(original, encoding="utf-8")


if __name__ == "__main__":
    unittest.main()
