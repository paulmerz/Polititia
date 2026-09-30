"""Tests for topic speech-filename and date helpers."""

from __future__ import annotations

import unittest
from pathlib import Path

from analyze_topics import assign_topic_titles, load_topic_labels, parse_speech_filename
from scripts.index_session_dates import normalize_session_date


class FilenameTests(unittest.TestCase):
    def test_parse_speech_filename(self) -> None:
        path = Path("CRSANR5L17S2024D1N001__001__M_Dupont_SOC.txt")
        self.assertEqual(
            parse_speech_filename(path),
            ("CRSANR5L17S2024D1N001", "M_Dupont_SOC"),
        )

    def test_rejects_speaker_corpus(self) -> None:
        self.assertIsNone(parse_speech_filename(Path("M_Dupont_SOC.txt")))


class TopicTitleTests(unittest.TestCase):
    def test_titles_follow_keywords_not_topic_order(self) -> None:
        labels = load_topic_labels(Path(__file__).resolve().parents[1] / "themes" / "topic_labels.json")
        topics = [
            {"topic_id": 0, "terms": "droit | état | conseil | procédure | personnes | dispositif"},
            {"topic_id": 1, "terms": "mourir | aide mourir | aide | patient | médecin | suicide"},
            {"topic_id": 2, "terms": "zzz | yyy | xxx"},
        ]
        assign_topic_titles(topics, labels)
        self.assertEqual(topics[0]["title"], "Justice, droit et procédures")
        self.assertEqual(topics[1]["title"], "Fin de vie et aide à mourir")
        self.assertEqual(topics[2]["title"], "Autre sujet : zzz")

    def test_each_title_used_once(self) -> None:
        labels = [{"title": "Outre-mer", "keywords": ["mayotte", "outre mer"]}]
        topics = [
            {"topic_id": 0, "terms": "mayotte | outre mer | mahorais"},
            {"topic_id": 1, "terms": "outre mer | mayotte"},
        ]
        assign_topic_titles(topics, labels)
        self.assertEqual(topics[0]["title"], "Outre-mer")
        self.assertTrue(topics[1]["title"].startswith("Autre sujet"))


class DateTests(unittest.TestCase):
    def test_iso_date(self) -> None:
        self.assertEqual(normalize_session_date("2024-10-02"), "2024-10-02")

    def test_compact_datetime(self) -> None:
        self.assertEqual(normalize_session_date("20241002153000"), "2024-10-02")
        self.assertEqual(normalize_session_date("20260527213000000"), "2026-05-27")


if __name__ == "__main__":
    unittest.main()
