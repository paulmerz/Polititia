"""Spike 0.5: is commission attendance in the AN Agenda dataset usable?

1. Coverage: which commission meetings of the 17th legislature carry a participant
   list, by organ type, state and month; which presence values exist; do lists
   cover all members (present + absent) or only those present?
2. Agreement: for a random sample of meetings, compare the Agenda list with the
   "Membres présents ou excusés" section of the official commission report
   (https://www.assemblee-nationale.fr/dyn/opendata/<compteRenduRef>.html).

Usage: python scripts/spike_commission_presence.py . <cache_dir> [sample_size]

Needs data/raw/opendata/agenda (Agenda.json.zip from repository/17/vp/reunions) and the AMO
download. The reports are cached in <cache_dir>, one request per second.
"""

from __future__ import annotations

import collections
import html
import json
import random
import re
import sys
import time
import unicodedata
import urllib.request
from datetime import date
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
REPO = Path(sys.argv[1])
OUT = Path(sys.argv[2])
SAMPLE = int(sys.argv[3]) if len(sys.argv) > 3 else 50
TODAY = date.today().isoformat()
AMO = REPO / "data/raw/opendata/amo/json"
AGENDA = REPO / "data/raw/opendata/agenda/json/reunion"


def as_list(v):
    return v if isinstance(v, list) else ([] if v is None else [v])


def fold(s: str) -> str:
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z]+", " ", s.lower()).strip()


organs = {}
for p in (AMO / "organe").glob("*.json"):
    o = json.load(open(p, encoding="utf-8"))["organe"]
    organs[o["uid"]] = (o.get("codeType", ""), o.get("libelleAbrege") or o.get("libelle", ""))

names = {}
for p in (AMO / "acteur").glob("*.json"):
    a = json.load(open(p, encoding="utf-8"))["acteur"]
    ident = a["etatCivil"]["ident"]
    uid = a["uid"]["#text"] if isinstance(a["uid"], dict) else a["uid"]
    names[uid] = f"{ident['prenom']} {ident['nom']}"

meetings = []
for p in AGENDA.glob("RUANR5L17*.json"):
    r = json.load(open(p, encoding="utf-8"))["reunion"]
    if r.get("@xsi:type") != "reunionCommission_type":
        continue
    pi = (r.get("participants") or {}).get("participantsInternes") or {}
    people = as_list(pi.get("participantInterne"))
    meetings.append({
        "uid": r["uid"],
        "date": r["timeStampDebut"][:10],
        "state": r["cycleDeVie"]["etat"],
        "organ": r.get("organeReuniRef"),
        "organ_type": organs.get(r.get("organeReuniRef"), ("?", "?"))[0],
        "organ_name": organs.get(r.get("organeReuniRef"), ("?", "?"))[1],
        "cr": r.get("compteRenduRef"),
        "people": [(x.get("acteurRef"), x.get("presence")) for x in people],
    })

past = [m for m in meetings if m["date"] < TODAY]
print(f"Commission meetings L17: {len(meetings)} (past: {len(past)}, future: {len(meetings) - len(past)})")
print("States (past):", collections.Counter(m["state"] for m in past).most_common())
held = [m for m in past if m["state"].startswith("Confirm")]
with_list = [m for m in held if m["people"]]
print(f"Held (confirmed, past): {len(held)}; with a participant list: {len(with_list)} ({len(with_list) / max(len(held), 1):.1%})")
print("Presence values:", collections.Counter(v for m in with_list for _, v in m["people"]).most_common())

by_type = collections.defaultdict(lambda: [0, 0])
for m in held:
    by_type[m["organ_type"]][0] += 1
    by_type[m["organ_type"]][1] += bool(m["people"])
print("By organ type (held, with list):", {k: tuple(v) for k, v in sorted(by_type.items(), key=lambda kv: -kv[1][0])})

by_month = collections.defaultdict(lambda: [0, 0])
for m in held:
    by_month[m["date"][:7]][0] += 1
    by_month[m["date"][:7]][1] += bool(m["people"])
print("By month (held, with list):", {k: tuple(v) for k, v in sorted(by_month.items())})

sizes = collections.defaultdict(list)
for m in with_list:
    sizes[m["organ_name"]].append(len(m["people"]))
print("List size per organ (min/median/max, top 12 by meetings):")
for name, s in sorted(sizes.items(), key=lambda kv: -len(kv[1]))[:12]:
    s.sort()
    print(f"  {name}: n={len(s)} min={s[0]} med={s[len(s) // 2]} max={s[-1]}")
only_present = sum(1 for m in with_list if all(v and v.startswith("pr") for _, v in m["people"]))
print(f"Lists with only 'présent' entries: {only_present} of {len(with_list)}")

# --- Agreement with the official reports ------------------------------------
random.seed(17)
candidates = [m for m in with_list if m["cr"] and m["organ_type"] in ("COMPER", "CNPE", "CNPS", "COMSPSENAT", "CMP", "GE", "MIS", "DELEG")]
if len(candidates) < SAMPLE:
    candidates = [m for m in with_list if m["cr"]]
sample = random.sample(candidates, min(SAMPLE, len(candidates)))
OUT.mkdir(parents=True, exist_ok=True)

DASH = r"\s*\.\s*[-–—]\s*"
LABEL = r"(?:Présente?s?|Excusée?s?|Assistai(?:t|ent) également à la réunion)"
SECTION = re.compile(r"(" + LABEL + r")" + DASH + r"(.*?)(?=" + LABEL + DASH + r"|$)", re.S)
START = re.compile(r"Présente?s?" + DASH)
rows = []
for m in sample:
    dest = OUT / f"{m['cr']}.html"
    if not dest.exists():
        req = urllib.request.Request(f"https://www.assemblee-nationale.fr/dyn/opendata/{m['cr']}.html", headers={"User-Agent": "Polititia-spike/1.0"})
        try:
            dest.write_bytes(urllib.request.urlopen(req, timeout=30).read())
        except Exception as exc:  # noqa: BLE001
            rows.append({**m, "error": str(exc)})
            continue
        time.sleep(1)
    text = html.unescape(re.sub(r"<[^>]+>", " ", dest.read_text(encoding="utf-8", errors="replace")))
    text = re.sub(r"\s+", " ", text.replace("\xa0", " "))
    # The attendance list closes the report: take the last "Présents. –".
    starts = list(START.finditer(text))
    if not starts:
        rows.append({**m, "error": "no attendance section"})
        continue
    block = text[starts[-1].start():starts[-1].start() + 20000]
    lists = {"present": "", "excused": "", "also": ""}
    for label, body in SECTION.findall(block):
        key = "present" if label.startswith("Présent") else "excused" if label.startswith("Excus") else "also"
        lists[key] += " " + body
    cr_present = fold(lists["present"] + " " + lists["also"])
    cr_excused = fold(lists["excused"])
    agenda_present = [a for a, v in m["people"] if v and v.startswith("pr")]
    agenda_absent = [a for a, v in m["people"] if not (v and v.startswith("pr"))]
    found = sum(1 for a in agenda_present if fold(names.get(a, "?")) in cr_present)
    absent_listed_present = sum(1 for a in agenda_absent if fold(names.get(a, "?")) in cr_present)
    absent_excused = sum(1 for a in agenda_absent if fold(names.get(a, "?")) in cr_excused)
    cr_count = len([x for x in re.split(r",| et ", lists["present"]) if x.strip()])
    rows.append({
        "uid": m["uid"], "date": m["date"], "organ": m["organ_name"], "cr": m["cr"],
        "agenda_present": len(agenda_present), "agenda_absent": len(agenda_absent),
        "present_found_in_cr": found, "absent_but_present_in_cr": absent_listed_present,
        "absent_listed_excused": absent_excused, "cr_present_names": cr_count,
    })

ok = [r for r in rows if "error" not in r]
print(f"\nSample: {len(sample)} meetings, compared: {len(ok)}, errors: {len(rows) - len(ok)}")
for r in rows:
    if "error" in r:
        print("  error", r["uid"], r["error"])
tp = sum(r["present_found_in_cr"] for r in ok)
ap = sum(r["agenda_present"] for r in ok)
crn = sum(r["cr_present_names"] for r in ok)
contra = sum(r["absent_but_present_in_cr"] for r in ok)
exc = sum(r["absent_listed_excused"] for r in ok)
ab = sum(r["agenda_absent"] for r in ok)
print(f"Agenda 'présent' found in the report's present list: {tp}/{ap} ({tp / max(ap, 1):.1%})")
print(f"Names in the report's 'Présents' list: {crn} (agenda présent: {ap})")
print(f"Agenda 'absent' but named present in the report: {contra}/{ab}")
print(f"Agenda 'absent' named 'excusé' in the report: {exc}/{ab}")
perfect = sum(1 for r in ok if r["present_found_in_cr"] == r["agenda_present"] and r["absent_but_present_in_cr"] == 0)
print(f"Meetings in full agreement: {perfect}/{len(ok)}")
for r in ok:
    if r["present_found_in_cr"] != r["agenda_present"] or r["absent_but_present_in_cr"]:
        print("  mismatch", r)
(OUT / "results.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
