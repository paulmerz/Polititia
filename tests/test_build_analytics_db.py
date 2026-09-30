from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from analyze_themes import load_jsonl, load_lexicon, run
from build_analytics_db import build, sessions
from extract_speeches import process_glob
from reference_data import ReferenceData
from speakers import SpeakerResolver


FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures"
LEXICON_PATH = Path(__file__).resolve().parents[1] / "themes" / "lexicon.json"
NO_OPEN_DATA = Path("/nonexistent-open-data")


class SessionTests(unittest.TestCase):
    def test_summer_2024_opens_the_first_session(self) -> None:
        rows = sessions("2024-07-19", "2026-07-21")
        self.assertEqual([row["label"] for row in rows], ["Session 2024-2025", "Session 2025-2026"])
        self.assertEqual(rows[0]["from"], "2024-07-19")
        self.assertEqual(rows[1]["from"], "2025-10-01")


class BuildTests(unittest.TestCase):
    def test_monthly_aggregates_add_up(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out_dir = Path(tmp)
            process_glob(str(FIXTURE_DIR / "*.xml"), str(out_dir))
            speeches = load_jsonl(out_dir / "speeches.jsonl")
            _bundle, attributions = run(
                speeches, load_lexicon(LEXICON_PATH), out_dir / "by_speaker", NO_OPEN_DATA, use_relevance=False
            )
            reference = ReferenceData(NO_OPEN_DATA)
            db_path = out_dir / "analytics.sqlite"
            counts = build(
                db_path,
                speeches,
                attributions,
                reference,
                SpeakerResolver(reference, out_dir / "by_speaker"),
                min_ngram_count=1,
                lexicon=LEXICON_PATH,
            )
            db = sqlite3.connect(db_path)
            self.assertGreater(counts["speeches"], 0)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM speeches").fetchone()[0], counts["speeches"])
            self.assertEqual(db.execute("SELECT COUNT(*) FROM speeches WHERE words < tokens").fetchone()[0], 0)
            for n in (1, 2):
                people = db.execute("SELECT SUM(total) FROM person_totals WHERE n = ?", (n,)).fetchone()[0]
                everyone = db.execute("SELECT SUM(total) FROM global_totals WHERE n = ?", (n,)).fetchone()[0]
                self.assertEqual(people, everyone)
                kept = db.execute(
                    "SELECT SUM(count) FROM global_ngram_month g JOIN ngrams ng ON ng.gid = g.gid WHERE ng.n = ?", (n,)
                ).fetchone()[0]
                self.assertEqual(kept, everyone, "min count 1 keeps every n-gram")
            meta = {key: json.loads(value) for key, value in db.execute("SELECT key, value FROM meta")}
            self.assertEqual(meta["months"], sorted(meta["months"]))
            self.assertEqual(meta["stanceVoteAgreement"], {"compared": 0, "agreeing": 0})
            themes = {row["id"]: row for row in meta["themes"]}
            self.assertEqual(themes["fin-de-vie"]["parent"], "social")
            self.assertEqual(themes["social"]["type"], "domain")
            attributed = db.execute("SELECT COUNT(DISTINCT theme) FROM theme_attributions").fetchone()[0]
            self.assertGreater(attributed, 0)
            db.close()


if __name__ == "__main__":
    unittest.main()
