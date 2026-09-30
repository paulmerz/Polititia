from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from analyze_votes import is_key_vote, vote_theme_matcher
from reference_data import ReferenceData, Vote, majority_position


def write(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def vote(title: str, vote_type: str = "SPO") -> Vote:
    return Vote(uid="V", number=1, date="2025-05-27", title=title, adopted=True, vote_type=vote_type, positions={}, group_majority={})


class MajorityTests(unittest.TestCase):
    def test_majority_follows_the_tally(self) -> None:
        self.assertEqual(majority_position({"pour": 12, "contre": 106, "abstention": 0}), "contre")
        self.assertEqual(majority_position({"pour": 5, "contre": 5, "abstention": 1}), "")
        self.assertEqual(majority_position({"pour": 0, "contre": 0, "abstention": 0}), "")

    def test_scrutin_file_uses_counts_not_declared_position(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            write(base / "amo" / "json" / "organe" / "PO1.json", {"organe": {"uid": "PO1", "codeType": "GP", "libelleAbrev": "RN"}})
            write(
                base / "scrutins" / "json" / "VTANR5L17V1.json",
                {
                    "scrutin": {
                        "uid": "VTANR5L17V1",
                        "numero": "8280",
                        "dateScrutin": "2026-07-15",
                        "titre": "l'ensemble de la proposition de loi relative au droit à l'aide à mourir",
                        "sort": {"code": "adopté"},
                        "typeVote": {"codeTypeVote": "SPS"},
                        "syntheseVote": {"decompte": {"pour": "291", "contre": "241", "abstentions": "29"}},
                        "ventilationVotes": {
                            "organe": {
                                "groupes": {
                                    "groupe": [
                                        {
                                            "organeRef": "PO1",
                                            "nombreMembresGroupe": "122",
                                            "vote": {
                                                "positionMajoritaire": "pour",
                                                "decompteVoix": {"pour": "12", "contre": "106", "abstentions": "0"},
                                                "decompteNominatif": {
                                                    "pours": {"votant": [{"acteurRef": "PA1"}]},
                                                    "contres": {"votant": [{"acteurRef": "PA2"}]},
                                                },
                                            },
                                        }
                                    ]
                                }
                            }
                        },
                    }
                },
            )
            parsed = ReferenceData(base).votes()
        self.assertEqual(len(parsed), 1)
        self.assertEqual(parsed[0].group_majority, {"RN": "contre"})
        self.assertEqual(parsed[0].group_counts["RN"], {"pour": 12, "contre": 106, "abstention": 0, "members": 122})
        self.assertEqual(parsed[0].group_counts["_total"], {"pour": 291, "contre": 241, "abstention": 29})
        self.assertEqual(parsed[0].positions, {"PA1": "pour", "PA2": "contre"})


class KeyVoteTests(unittest.TestCase):
    def test_final_votes_and_censure_are_key(self) -> None:
        self.assertTrue(is_key_vote(vote("l'ensemble de la proposition de loi relative au droit à l'aide à mourir")))
        self.assertTrue(is_key_vote(vote("la motion de censure déposée par M. Boris Vallaud", "MOC")))
        self.assertFalse(is_key_vote(vote("l'amendement n° 916 de M. Hetzel à l'article 2")))

    def test_vote_themes_include_the_parent_domain(self) -> None:
        themes = vote_theme_matcher()(vote("l'ensemble de la proposition de loi relative au droit à l'aide à mourir"), None)
        self.assertEqual(themes[:2], ["fin-de-vie", "social"])


if __name__ == "__main__":
    unittest.main()
