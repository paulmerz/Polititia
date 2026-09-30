"""Link public votes (scrutins) to themes.

A vote's title names what is voted on ("l'amendement n° 916 ... de la
proposition de loi relative au droit à l'aide à mourir"). Matched against
the legislative files, it gives the dossier; matched against the themes'
``title_keywords`` (the same rule as debates, omnibus titles excluded), it
gives the themes.

"Key" votes are the ones a citizen would look for first: solemn votes,
censure motions and final votes on a whole text. Amendment votes are kept
for the deviation-from-group statistics.

Usage: python analyze_votes.py   # prints how many votes each theme gets
"""

from __future__ import annotations

import argparse
from collections import Counter
from pathlib import Path

from analyze_themes import DEFAULT_LEXICON, load_lexicon, title_themes
from reference_data import DEFAULT_OPEN_DATA_DIR, Dossier, ReferenceData, Vote, fold


KEY_VOTE_TYPES = {"SPS", "MOC"}
KEY_TITLE_PREFIXES = ("l ensemble", "la motion de censure", "la declaration du gouvernement")


def is_key_vote(vote: Vote) -> bool:
    return vote.vote_type in KEY_VOTE_TYPES or fold(vote.title).startswith(KEY_TITLE_PREFIXES)


def vote_theme_matcher(lexicon_path: Path = DEFAULT_LEXICON):
    lexicon = load_lexicon(lexicon_path)

    def themes(vote: Vote, dossier: Dossier | None) -> list[str]:
        text = " | ".join(part for part in (vote.title, dossier.title if dossier else "") if part)
        found = title_themes(text, lexicon)
        parents = [lexicon.parent[theme] for theme in found if lexicon.parent.get(theme)]
        if not parents and dossier and dossier.domain:
            parents.append(dossier.domain)
        return list(dict.fromkeys(found + parents))

    return themes


def dossier_for_vote(reference: ReferenceData, vote: Vote) -> Dossier | None:
    return reference.dossiers.get(vote.dossier_uid) or reference.dossier_for_title(vote.title)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--open-data", type=Path, default=DEFAULT_OPEN_DATA_DIR)
    args = parser.parse_args()
    reference = ReferenceData(args.open_data)
    matcher = vote_theme_matcher()
    counts: Counter[str] = Counter()
    key_counts: Counter[str] = Counter()
    votes = reference.votes()
    for vote in votes:
        for theme in matcher(vote, dossier_for_vote(reference, vote)):
            counts[theme] += 1
            if is_key_vote(vote):
                key_counts[theme] += 1
    print(f"{len(votes)} votes")
    for theme, count in counts.most_common():
        print(f"{theme:24} {count:6} votes, {key_counts[theme]:4} key votes")


if __name__ == "__main__":
    main()
