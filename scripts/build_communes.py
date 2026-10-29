#!/usr/bin/env python3
"""Build the commune -> constituency table behind « Trouver mon député ».

Sources, downloaded once under ``data/raw/geo/`` (Licence Ouverte):

- INSEE, ``circo_composition.xlsx``: every commune and the constituencies it
  lies in, entirely or partly;
- La Poste, base officielle des codes postaux: the postal codes of each
  commune, and the arrondissements of Paris, Lyon and Marseille;
- Ministère de l'Intérieur, 2024 legislative results by polling station and by
  constituency. INSEE lists Paris, Lyon and Marseille as single communes: a
  polling station code starts with its arrondissement (``1105`` is in the 11th)
  and its list of candidates identifies its constituency, which narrows the
  search to the arrondissement.

Output: ``dashboard/data/communes.json``, searched by ``/api/communes``.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import shutil
import sys
import tempfile
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from collections import defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from reference_data import DEFAULT_OPEN_DATA_DIR, ReferenceData  # noqa: E402

RESULTS_2024 = (
    "https://static.data.gouv.fr/resources/"
    "elections-legislatives-des-30-juin-et-7-juillet-2024-resultats-definitifs-du-1er-tour"
)
SOURCES = {
    "circo_composition.xlsx": "https://www.insee.fr/fr/statistiques/fichier/6436476/circo_composition.xlsx",
    "codes_postaux.csv": "https://datanova.laposte.fr/data-fair/api/v1/datasets/laposte-hexasmal/data-files/019HexaSmal.csv",
    "bureaux_2024.csv": f"{RESULTS_2024}/20240710-171445/resultats-definitifs-par-bureau-de-vote.csv",
    "circonscriptions_2024.csv": f"{RESULTS_2024}/20240710-171413/resultats-definitifs-par-circonscriptions-legislatives.csv",
}
DEFAULT_RAW_DIR = Path("data/raw/geo")
DEFAULT_OUT = Path("dashboard/data/communes.json")

# Commune code -> (city, first arrondissement code). Arrondissement n is code + n - 1.
PLM = {"75056": ("Paris", 75101, 20), "13055": ("Marseille", 13201, 16), "69123": ("Lyon", 69381, 9)}
# INSEE files Saint-Martin and Saint-Barthélemy under 978, the Assembly under 977.
DEPARTMENT_ALIASES = {"978": "977"}
SMALL_WORDS = {"EN", "SUR", "SOUS", "LE", "LA", "LES", "DE", "DU", "DES", "ET", "AU", "AUX", "LES", "PRES", "L'", "D'"}
ABROAD = {"code": "99", "name": "Français établis hors de France", "dept": "099", "circos": list(range(1, 12))}

SHEET_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--raw-dir", type=Path, default=DEFAULT_RAW_DIR)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--open-data", type=Path, default=DEFAULT_OPEN_DATA_DIR,
                        help="AMO download, to report constituencies without a deputy (optional)")
    parser.add_argument("--force", action="store_true", help="download the sources again")
    return parser.parse_args()


def download(url: str, target: Path, force: bool) -> None:
    if target.exists() and not force:
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=target.parent, prefix=f".{target.name}.", delete=False) as tmp:
        tmp_path = Path(tmp.name)
    try:
        print(f"[download] {url}")
        with urllib.request.urlopen(url) as response, tmp_path.open("wb") as handle:
            shutil.copyfileobj(response, handle)
        tmp_path.replace(target)
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise


def xlsx_rows(path: Path, sheet_name: str) -> list[list[str]]:
    """Rows of one sheet, as strings. Enough for INSEE's plain tables (no dependency)."""
    with zipfile.ZipFile(path) as book:
        rels = ET.fromstring(book.read("xl/_rels/workbook.xml.rels"))
        targets = {rel.get("Id"): rel.get("Target") for rel in rels}
        workbook = ET.fromstring(book.read("xl/workbook.xml"))
        rel_id = next(
            sheet.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
            for sheet in workbook.iter(f"{SHEET_NS}sheet")
            if sheet.get("name") == sheet_name
        )
        shared: list[str] = []
        if "xl/sharedStrings.xml" in book.namelist():
            for item in ET.fromstring(book.read("xl/sharedStrings.xml")).findall(f"{SHEET_NS}si"):
                shared.append("".join(text.text or "" for text in item.iter(f"{SHEET_NS}t")))
        sheet = ET.fromstring(book.read(f"xl/{targets[rel_id].lstrip('/').removeprefix('xl/')}"))
    rows = []
    for row in sheet.iter(f"{SHEET_NS}row"):
        cells: dict[int, str] = {}
        for cell in row.findall(f"{SHEET_NS}c"):
            column = re.match(r"[A-Z]+", cell.get("r") or "A").group()
            index = 0
            for letter in column:
                index = index * 26 + ord(letter) - 64
            value = cell.find(f"{SHEET_NS}v")
            if value is None:
                inline = cell.find(f"{SHEET_NS}is")
                text = "".join(t.text or "" for t in inline.iter(f"{SHEET_NS}t")) if inline is not None else ""
            else:
                text = shared[int(value.text)] if cell.get("t") == "s" else (value.text or "")
            cells[index - 1] = text.strip()
        if cells:
            rows.append([cells.get(i, "") for i in range(max(cells) + 1)])
    return rows


def split_circo(code: str) -> tuple[str, int]:
    """INSEE constituency code -> (department, number): 01004, 2A001, 97601, 98801."""
    department, number = (code[:3], code[3:]) if code[:2] in ("97", "98") else (code[:2], code[2:])
    return DEPARTMENT_ALIASES.get(department, department), int(number)


def read_table(rows: list[list[str]]) -> list[dict[str, str]]:
    header = [cell.strip() for cell in rows[0]]
    return [dict(zip(header, row)) for row in rows[1:]]


def load_insee(path: Path) -> tuple[dict[str, dict], dict[str, str]]:
    communes: dict[str, dict] = {}
    departments: dict[str, str] = {}
    for row in read_table(xlsx_rows(path, "table")):
        code, circo = row.get("COMMUNE_RESID", ""), row.get("circo", "")
        if not code or not circo:
            continue
        department, number = split_circo(circo)
        departments.setdefault(department, row.get("libdep", ""))
        item = communes.setdefault(code, {"code": code, "name": row.get("LIBcom", ""), "dept": department, "circos": set()})
        item["circos"].add(number)
    for row in read_table(xlsx_rows(path, "table COM")):
        code, circo = row.get("DEPCOM", ""), row.get("circo", "")
        if not code or not circo:
            continue
        department, number = split_circo(circo)
        departments.setdefault(department, row.get("COM", ""))
        item = communes.setdefault(code, {"code": code, "name": row.get("LIBcom", ""), "dept": department, "circos": set()})
        item["circos"].add(number)
    return communes, departments


def load_postcodes(path: Path) -> dict[str, set[str]]:
    postcodes: dict[str, set[str]] = defaultdict(set)
    with path.open(encoding="latin-1", newline="") as handle:
        reader = csv.reader(handle, delimiter=";")
        next(reader, None)
        for row in reader:
            if len(row) >= 3 and row[0] and row[2]:
                postcodes[row[0].strip()].add(row[2].strip())
    return postcodes


def load_postcode_names(path: Path) -> dict[str, str]:
    """La Poste spells names in capitals without accents: L OIE -> L'Oie, STE FLORENCE -> Sainte-Florence."""
    names: dict[str, str] = {}
    with path.open(encoding="latin-1", newline="") as handle:
        reader = csv.reader(handle, delimiter=";")
        next(reader, None)
        for row in reader:
            if len(row) >= 2 and row[0] and row[0] not in names:
                words = re.sub(r"\b(L|D) ", r"\1' ", row[1].strip()).split()
                words = [{"ST": "SAINT", "STE": "SAINTE"}.get(word, word) for word in words]
                text = "-".join(
                    word.lower() if index and word in SMALL_WORDS else word.capitalize() for index, word in enumerate(words)
                )
                names[row[0]] = re.sub(r"\b([LlDd])'-", r"\1'", text)
    return names


def candidates(row: list[str], header: list[str]) -> frozenset[str]:
    return frozenset(
        row[index].strip().upper()
        for index, name in enumerate(header)
        if name.startswith("Nom candidat") and index < len(row) and row[index].strip()
    )


def arrondissement_circos(bureaux: Path, circonscriptions: Path) -> dict[str, set[int]]:
    """Arrondissement code (75111, 13201, 69381...) -> constituencies, from 2024 polling stations."""
    by_candidates: dict[tuple[str, frozenset[str]], int] = {}
    with circonscriptions.open(encoding="utf-8", newline="") as handle:
        reader = csv.reader(handle, delimiter=";")
        header = next(reader)
        for row in reader:
            department, code = row[0], row[2]
            if department in ("75", "13", "69"):
                by_candidates[(department, candidates(row, header))] = int(code[len(department):])
    result: dict[str, set[int]] = defaultdict(set)
    unmatched = 0
    with bureaux.open(encoding="utf-8", newline="") as handle:
        reader = csv.reader(handle, delimiter=";")
        header = next(reader)
        for row in reader:
            city = PLM.get(row[2])
            if city is None:
                continue
            arrondissement = row[4][:-2]
            circo = by_candidates.get((row[0], candidates(row, header)))
            if not arrondissement.isdigit() or circo is None:
                unmatched += 1
                continue
            number = int(arrondissement)
            if 1 <= number <= city[2]:
                result[str(city[1] + number - 1)].add(circo)
    if unmatched:
        print(f"[warn] {unmatched} polling stations of Paris, Lyon or Marseille not placed")
    return result


def ordinal(number: int) -> str:
    return f"{number}{'er' if number == 1 else 'e'}"


def build(raw_dir: Path) -> dict:
    communes, departments = load_insee(raw_dir / "circo_composition.xlsx")
    postcodes = load_postcodes(raw_dir / "codes_postaux.csv")
    arrondissements = arrondissement_circos(raw_dir / "bureaux_2024.csv", raw_dir / "circonscriptions_2024.csv")

    rows = []
    for code, item in communes.items():
        if code in PLM:
            city, first, count = PLM[code]
            codes = [str(first + index) for index in range(count)]
            item_postcodes = sorted({postcode for arr in codes for postcode in postcodes.get(arr, ())})
            rows.append([code, item["name"], item["dept"], item_postcodes, sorted(item["circos"])])
            for index, arr in enumerate(codes, start=1):
                circos = arrondissements.get(arr) or item["circos"]
                rows.append([arr, f"{city} {ordinal(index)} arrondissement", item["dept"], sorted(postcodes.get(arr, ())), sorted(circos)])
            continue
        rows.append([code, item["name"], item["dept"], sorted(postcodes.get(code, ())), sorted(item["circos"])])
    # Communes created after the INSEE geography (communes nouvelles): the
    # constituencies of the communes sharing their postal codes.
    by_postcode: dict[tuple[str, str], set[int]] = defaultdict(set)
    for row in rows:
        for postcode in row[3]:
            by_postcode[(row[2], postcode)].update(row[4])
    names = load_postcode_names(raw_dir / "codes_postaux.csv")
    skipped = []
    for code in sorted(set(postcodes) - {row[0] for row in rows}):
        department = code[:3] if code[:2] in ("97", "98") else code[:2]
        circos = set().union(*(by_postcode.get((department, postcode), set()) for postcode in postcodes[code]))
        if circos:
            rows.append([code, names.get(code, code), department, sorted(postcodes[code]), sorted(circos)])
        else:
            skipped.append(code)
    if skipped:
        print(f"[warn] no constituency for La Poste communes {skipped}")
    rows.append([ABROAD["code"], ABROAD["name"], ABROAD["dept"], [], ABROAD["circos"]])
    departments[ABROAD["dept"]] = ABROAD["name"]
    rows.sort(key=lambda row: row[0])
    return {
        "builtOn": date.today().isoformat(),
        "sources": list(SOURCES.values()),
        "departments": dict(sorted(departments.items())),
        "columns": ["code", "name", "dept", "postcodes", "circos"],
        "communes": rows,
    }


def report_coverage(payload: dict, open_data: Path) -> None:
    if not (open_data / "amo").is_dir():
        return
    reference = ReferenceData(open_data)
    seats = set()
    for actor in reference.actors.values():
        seat = actor.current_seat()
        if seat and not seat.end:
            seats.add((seat.department, seat.number))
    circos = {(row[2], number) for row in payload["communes"] for number in row[4]}
    print(f"[check] {len(seats)} open seats, {len(circos)} constituencies reachable from a commune")
    if circos - seats:
        print(f"[check] constituencies without a sitting deputy: {sorted(circos - seats)}")
    if seats - circos:
        print(f"[check] seats no commune leads to: {sorted(seats - circos)}")


def main() -> int:
    args = parse_args()
    for name, url in SOURCES.items():
        download(url, args.raw_dir / name, args.force)
    payload = build(args.raw_dir)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Wrote {args.out}: {len(payload['communes'])} communes")
    report_coverage(payload, args.open_data)
    return 0


if __name__ == "__main__":
    sys.exit(main())
