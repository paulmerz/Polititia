#!/usr/bin/env python3
"""Download the Assemblee nationale reference datasets used next to the debates.

- AMO30: every actor, mandate and organ (political groups, government, committees)
- Scrutins: every public vote with the nominative breakdown
- Dossiers legislatifs: bills, their documents and the committee in charge
"""

from __future__ import annotations

import argparse
import shutil
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path


BASE_URL = "https://data.assemblee-nationale.fr/static/openData/repository/17"
DATASETS = {
    "amo": f"{BASE_URL}/amo/tous_acteurs_mandats_organes_xi_legislature/"
    "AMO30_tous_acteurs_tous_mandats_tous_organes_historique.json.zip",
    "scrutins": f"{BASE_URL}/loi/scrutins/Scrutins.json.zip",
    "dossiers": f"{BASE_URL}/loi/dossiers_legislatifs/Dossiers_Legislatifs.json.zip",
}
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
    archive.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=archive.parent, prefix=f".{archive.name}.", delete=False) as tmp:
        tmp_path = Path(tmp.name)
    try:
        print(f"[download] {url}")
        with urllib.request.urlopen(url) as response, tmp_path.open("wb") as handle:
            shutil.copyfileobj(response, handle)
        tmp_path.replace(archive)
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise


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
        extract(archive, args.out_dir / name, args.force)
    return 0


if __name__ == "__main__":
    sys.exit(main())
