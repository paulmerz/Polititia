from __future__ import annotations

import json
import unittest
from pathlib import Path

from lexical_stats import dirichlet_log_odds


EXAMPLE = Path(__file__).resolve().parents[1] / "server" / "tests" / "fixtures" / "log_odds_example.json"


class LogOddsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.example = json.loads(EXAMPLE.read_text(encoding="utf-8"))

    def run_example(self) -> list[dict]:
        example = self.example
        return dirichlet_log_odds(
            example["target"],
            example["targetTotal"],
            example["everyone"],
            example["everyoneTotal"],
            example["prior"],
        )

    def test_frequent_signature_phrase_beats_rare_one(self) -> None:
        rows = self.run_example()
        phrases = [row["ngram"] for row in rows]
        self.assertEqual(phrases[0], "justice fiscale")
        self.assertNotIn("mot rare", phrases)

    def test_shared_phrases_are_not_distinctive(self) -> None:
        phrases = [row["ngram"] for row in self.run_example()]
        self.assertNotIn("projet de loi", phrases)

    def test_ratio_and_expected_values(self) -> None:
        rows = {row["ngram"]: row for row in self.run_example()}
        for phrase, expected in self.example["expected"].items():
            self.assertAlmostEqual(rows[phrase]["z"], expected["z"], places=6)
            self.assertAlmostEqual(rows[phrase]["ratio"], expected["ratio"], places=6)
        self.assertGreater(rows["justice fiscale"]["ratio"], 5)

    def test_empty_rest(self) -> None:
        self.assertEqual(dirichlet_log_odds({"a": 5}, 5, {"a": 5}, 5, {"a": 1.0}), [])


if __name__ == "__main__":
    unittest.main()
