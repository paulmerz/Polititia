"""Tests for topic speech-filename and date helpers."""

from __future__ import annotations

import unittest
from pathlib import Path

from analyze_topics import parse_speech_filename
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


class DateTests(unittest.TestCase):
    def test_iso_date(self) -> None:
        self.assertEqual(normalize_session_date("2024-10-02"), "2024-10-02")

    def test_compact_datetime(self) -> None:
        self.assertEqual(normalize_session_date("20241002153000"), "2024-10-02")
        self.assertEqual(normalize_session_date("20260527213000000"), "2026-05-27")


if __name__ == "__main__":
    unittest.main()
