from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from extract_speeches import (
    extract_speeches,
    normalize_session_date,
    process_glob,
    write_speech_files,
)


FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures"
MINI_XML = FIXTURE_DIR / "compte_rendu_mini.xml"
LATER_XML = FIXTURE_DIR / "compte_rendu_later.xml"


class NormalizeSessionDateTests(unittest.TestCase):
    def test_compact_date_seance(self) -> None:
        self.assertEqual(
            normalize_session_date({"dateSeance": "20241001150000000"}),
            "2024-10-01",
        )

    def test_french_date_seance_jour(self) -> None:
        self.assertEqual(
            normalize_session_date({"dateSeanceJour": "mardi 12 mars 2024"}),
            "2024-03-12",
        )

    def test_iso_date_passthrough(self) -> None:
        self.assertEqual(
            normalize_session_date({"dateSeanceJour": "2024-06-18"}),
            "2024-06-18",
        )


class ExtractSpeechesTests(unittest.TestCase):
    def test_fixture_metadata_and_segments(self) -> None:
        segments, meta = extract_speeches(str(MINI_XML))
        self.assertEqual(meta["uid"], "CRTESTMINI001")
        self.assertEqual(normalize_session_date(meta), "2024-03-12")
        speakers = [segment["speaker"] for segment in segments]
        self.assertEqual(
            speakers,
            [
                "Mme Sophie Panonacle EPR",
                "Mme Mathilde Panot LFI NFP",
                "M. Laurent Wauquiez DR",
            ],
        )

    def test_jsonl_index_from_fixture_glob(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            process_glob(str(FIXTURE_DIR / "compte_rendu_*.xml"), tmp)
            index_path = Path(tmp) / "speeches.jsonl"
            self.assertTrue(index_path.exists())
            rows = [json.loads(line) for line in index_path.read_text(encoding="utf-8").splitlines()]
            self.assertEqual(len(rows), 6)
            early = [row for row in rows if row["date"] == "2024-03-12"]
            later = [row for row in rows if row["date"] == "2024-06-18"]
            self.assertEqual(len(early), 3)
            self.assertEqual(len(later), 3)
            first = next(row for row in early if row["speaker_slug"] == "Mme_Sophie_Panonacle_EPR")
            self.assertEqual(first["speech_id"], "compte_rendu_mini__01__Mme_Sophie_Panonacle_EPR")
            self.assertIn("aide à mourir", first["text"])
            self.assertTrue(first["normalized_text"])
            self.assertTrue(any("qasoldy charcot" in row["normalized_text"] for row in later))
            self.assertTrue((Path(tmp) / "by_speaker" / "Mme_Sophie_Panonacle_EPR.txt").exists())

    def test_write_speech_files_keeps_txt_and_stable_ids(self) -> None:
        segments, meta = extract_speeches(str(MINI_XML))
        with tempfile.TemporaryDirectory() as tmp:
            records = write_speech_files(segments, tmp, str(MINI_XML), meta)
            self.assertEqual(len(records), 3)
            self.assertTrue((Path(tmp) / f"{records[0]['speech_id']}.txt").exists())
            self.assertEqual(records[0]["date"], "2024-03-12")


if __name__ == "__main__":
    unittest.main()
