#!/usr/bin/env python3
"""Download and extract the Assemblee nationale Syceron XML corpus."""

from __future__ import annotations

import argparse
import sys
import zipfile
from pathlib import Path

try:
    from scripts._fetch import download_zip  # python -m scripts.download_assemblee_data
except ModuleNotFoundError:
    from _fetch import download_zip  # python scripts/download_assemblee_data.py


DEFAULT_URL = (
    "https://data.assemblee-nationale.fr/static/openData/repository/17/"
    "vp/syceronbrut/syseron.xml.zip"
)
DEFAULT_ARCHIVE = Path("data/raw/syseron.xml.zip")
DEFAULT_EXTRACT_DIR = Path("data/raw")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Download the official Assemblee nationale debate XML archive."
    )
    parser.add_argument(
        "--url",
        default=DEFAULT_URL,
        help=f"Archive URL. Default: {DEFAULT_URL}",
    )
    parser.add_argument(
        "--archive",
        type=Path,
        default=DEFAULT_ARCHIVE,
        help=f"Local ZIP path. Default: {DEFAULT_ARCHIVE}",
    )
    parser.add_argument(
        "--extract-dir",
        type=Path,
        default=DEFAULT_EXTRACT_DIR,
        help=f"Directory where the ZIP is extracted. Default: {DEFAULT_EXTRACT_DIR}",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-download and re-extract even if files already exist.",
    )
    parser.add_argument(
        "--no-extract",
        action="store_true",
        help="Only download the ZIP archive.",
    )
    return parser.parse_args()


def download(url: str, archive: Path, force: bool) -> None:
    if archive.exists() and not force:
        print(f"[skip] archive already exists: {archive}")
        return

    # Checks the size, resumes a cut transfer and validates the ZIP before writing.
    download_zip(url, archive)


def safe_extract(archive: Path, extract_dir: Path, force: bool) -> None:
    target_xml_dir = extract_dir / "xml" / "compteRendu"
    if target_xml_dir.exists() and any(target_xml_dir.glob("*.xml")) and not force:
        print(f"[skip] extracted XML already exists: {target_xml_dir}")
        return

    extract_dir.mkdir(parents=True, exist_ok=True)
    root = extract_dir.resolve()
    extracted = 0

    with zipfile.ZipFile(archive) as zf:
        for member in zf.infolist():
            target = (extract_dir / member.filename).resolve()
            if not target.is_relative_to(root):
                raise SystemExit(f"Unsafe ZIP member path: {member.filename}")
            zf.extract(member, extract_dir)
            extracted += 1

    print(f"[ok] extracted {extracted} file(s) to {extract_dir}")


def main() -> int:
    args = parse_args()
    download(args.url, args.archive, args.force)
    if not args.no_extract:
        safe_extract(args.archive, args.extract_dir, args.force)
    return 0


if __name__ == "__main__":
    sys.exit(main())
