#!/usr/bin/env python3
"""Download the Assemblee nationale reference datasets used next to the debates.

- AMO30: every actor, mandate and organ (political groups, government, committees)
- Scrutins: every public vote with the nominative breakdown
- Dossiers legislatifs: bills, their documents and the committee in charge
- Agenda: public sittings and committee meetings, their order of business and
  committee attendance. Kept as a ZIP: build_agenda_db.py reads it directly, so
  a meeting the Assembly removes does not linger as a stale extracted file.
"""

from __future__ import annotations

import argparse
import sys
import zipfile
from pathlib import Path

try:
    from scripts._fetch import download_zip  # python -m scripts.download_open_data
except ModuleNotFoundError:
    from _fetch import download_zip  # python scripts/download_open_data.py


BASE_URL = "https://data.assemblee-nationale.fr/static/openData/repository/17"
DATASETS = {
    "amo": f"{BASE_URL}/amo/tous_acteurs_mandats_organes_xi_legislature/"
    "AMO30_tous_acteurs_tous_mandats_tous_organes_historique.json.zip",
    "scrutins": f"{BASE_URL}/loi/scrutins/Scrutins.json.zip",
    "dossiers": f"{BASE_URL}/loi/dossiers_legislatifs/Dossiers_Legislatifs.json.zip",
    "agenda": f"{BASE_URL}/vp/reunions/Agenda.json.zip",
}
ARCHIVE_ONLY = {"agenda"}
DEFAULT_OUT_DIR = Path("data/raw/opendata")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    parser.add_argument("--only", choices=sorted(DATASETS), nargs="*")
    parser.add_argument("--force", action="store_true")
    return parser.parse_args()


def download(url: str, archive: Path, force: bool) -> None:
    if archive.exists() and not force:
        print(f"[skip] {archive}")
        return
    # Checks the size, resumes a cut transfer and validates the ZIP before writing.
    download_zip(url, archive)


def extract(archive: Path, target: Path, force: bool) -> None:
    if target.is_dir() and any(target.rglob("*.json")) and not force:
        print(f"[skip] {target}")
        return
    root = target.resolve()
    with zipfile.ZipFile(archive) as zf:
        for member in zf.infolist():
            destination = (target / member.filename).resolve()
            if not destination.is_relative_to(root):
                raise SystemExit(f"Unsafe ZIP member path: {member.filename}")
            zf.extract(member, target)
    print(f"[ok] {target}")


def main() -> int:
    args = parse_args()
    for name in args.only or sorted(DATASETS):
        archive = args.out_dir / f"{name}.json.zip"
        download(DATASETS[name], archive, args.force)
        if name not in ARCHIVE_ONLY:
            extract(archive, args.out_dir / name, args.force)
    return 0


if __name__ == "__main__":
    sys.exit(main())
