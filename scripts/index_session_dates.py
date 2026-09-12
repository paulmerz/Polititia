#!/usr/bin/env python3
"""Index Assemblee XML session dates without re-extracting speeches."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from extract_speeches import NS, _get_metadata  # noqa: E402

DEFAULT_XML_DIR = Path("data/raw/xml/compteRendu")
DEFAULT_OUTPUT = Path("analysis_outputs/plain_project_content_stable/session_dates.json")


def normalize_session_date(raw: str) -> str | None:
    text = raw.strip()
    if len(text) >= 10 and text[4] == "-" and text[7] == "-":
        return text[:10]
    digits = "".join(char for char in text if char.isdigit())
    if len(digits) >= 8:
        return f"{digits[0:4]}-{digits[4:6]}-{digits[6:8]}"
    return None


def index_session_dates(xml_dir: Path) -> dict[str, str]:
    dates: dict[str, str] = {}
    for path in sorted(xml_dir.glob("*.xml")):
        try:
            root = ET.parse(path).getroot()
        except ET.ParseError:
            continue
        raw = _get_metadata(root).get("dateSeanceJour", "")
        date = normalize_session_date(raw)
        if date:
            dates[path.stem] = date
    return dates


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Write session stem -> ISO date JSON.")
    parser.add_argument("--xml-dir", type=Path, default=DEFAULT_XML_DIR)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not args.xml_dir.is_dir():
        raise SystemExit(f"XML directory not found: {args.xml_dir}")
    dates = index_session_dates(args.xml_dir)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(dates, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(dates)} session dates to {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
