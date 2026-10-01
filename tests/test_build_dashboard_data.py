from __future__ import annotations

import importlib.util
import sqlite3
import tempfile
import unittest
from pathlib import Path

from analyze_themes import load_jsonl, load_lexicon, run
from build_analytics_db import build
from extract_speeches import process_glob
from reference_data import ReferenceData
from speakers import SpeakerResolver


FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures"
LEXICON_PATH = Path(__file__).resolve().parents[1] / "themes" / "lexicon.json"
NO_OPEN_DATA = Path("/nonexistent-open-data")


def load_builder():
    path = Path(__file__).resolve().parents[1] / "dashboard" / "build_dashboard_data.py"
    spec = importlib.util.spec_from_file_location("build_dashboard_data", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class DashboardBundleTests(unittest.TestCase):
    def test_bundle_matches_the_analytics_database(self) -> None:
        module = load_builder()
        with tempfile.TemporaryDirectory() as tmp:
            out_dir = Path(tmp)
            process_glob(str(FIXTURE_DIR / "*.xml"), str(out_dir))
            speeches_path = out_dir / "speeches.jsonl"
            speeches = load_jsonl(speeches_path)
            _bundle, attributions = run(
                speeches, load_lexicon(LEXICON_PATH), out_dir / "by_speaker", NO_OPEN_DATA, use_relevance=False
            )
            reference = ReferenceData(NO_OPEN_DATA)
            resolver = SpeakerResolver(reference, out_dir / "by_speaker")
            db_path = out_dir / "analytics.sqlite"
            build(db_path, speeches, attributions, reference, resolver, min_ngram_count=1, lexicon=LEXICON_PATH)

            bundle = module.build_bundle(db_path, speeches_path, resolver)

            db = sqlite3.connect(db_path)
            db_ids = {row[0] for row in db.execute("SELECT id FROM politicians")}
            db_speeches = db.execute("SELECT COUNT(*) FROM speeches").fetchone()[0]
            db.close()

        self.assertEqual({item["id"] for item in bundle["politicians"]}, db_ids)
        self.assertEqual(bundle["meta"]["totalSpeeches"], db_speeches)
        self.assertEqual(sum(party["speechCount"] for party in bundle["parties"]), db_speeches)
        self.assertEqual(bundle["partyOrder"], [party["id"] for party in bundle["parties"]])
        self.assertIn("GOUV", bundle["partyOrder"])
        self.assertIn("UNLABELED", bundle["partyOrder"])
        for key in ("tfidf", "topics", "themes", "phrasesByPolitician", "partyPhrases"):
            self.assertNotIn(key, bundle)
        self.assertTrue(set(bundle["markersByPolitician"]) <= db_ids)
        some = next(iter(bundle["markersByPolitician"].values()))
        self.assertEqual(set(some), {"markers", "markerRates", "markerCounts"})
        order = {party_id: index for index, party_id in enumerate(bundle["partyOrder"])}
        positions = [order[item["party"]] for item in bundle["politicians"]]
        self.assertEqual(positions, sorted(positions), "seats follow the hemicycle order")


if __name__ == "__main__":
    unittest.main()
