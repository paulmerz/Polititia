"""Which expressions a speaker (or group) uses more than the rest of the Assembly.

Weighted log-odds ratio with an informative Dirichlet prior (Monroe, Colaresi
and Quinn, 2008, "Fightin' Words"). Compared with TF-IDF it:

- compares a speaker with everyone else instead of counting in how many
  speakers' vocabularies a phrase appears;
- shrinks rare phrases towards the Assembly-wide rate, so a phrase said
  twice by a quiet deputy does not outrank a phrase said 200 times;
- gives a z-score, so "distinctive" can mean "significant at 95 %".

The server ports this function (``server/src/lexical.ts``); both are tested
against the same example.
"""

from __future__ import annotations

import math
from collections.abc import Mapping


DEFAULT_ALPHA0 = 1000.0
MIN_COUNT = 3
Z_THRESHOLD = 1.96


def dirichlet_log_odds(
    target: Mapping[str, int],
    target_total: int,
    everyone: Mapping[str, int],
    everyone_total: int,
    prior: Mapping[str, float],
    alpha0: float = DEFAULT_ALPHA0,
    min_count: int = MIN_COUNT,
    z_threshold: float = Z_THRESHOLD,
) -> list[dict[str, float | str | int]]:
    """Phrases over-used by ``target`` compared with the rest of ``everyone``.

    ``everyone`` includes the target's own counts. ``prior`` maps a phrase to
    its share of the whole corpus (all periods), the background rate the
    estimate shrinks towards. Rows are sorted by decreasing z-score.
    """
    rest_total = everyone_total - target_total
    rows: list[dict[str, float | str | int]] = []
    if target_total <= 0 or rest_total <= 0:
        return rows
    for phrase, count in target.items():
        if count < min_count:
            continue
        alpha = alpha0 * prior.get(phrase, 0.0)
        if alpha <= 0:
            alpha = alpha0 / max(everyone_total, 1)
        rest = max(everyone.get(phrase, count) - count, 0)
        delta = math.log((count + alpha) / (target_total + alpha0 - count - alpha)) - math.log(
            (rest + alpha) / (rest_total + alpha0 - rest - alpha)
        )
        variance = 1.0 / (count + alpha) + 1.0 / (rest + alpha)
        z = delta / math.sqrt(variance)
        if z < z_threshold:
            continue
        ratio = ((count + 0.5) / (target_total + 0.5)) / ((rest + 0.5) / (rest_total + 0.5))
        rows.append({"ngram": phrase, "count": count, "z": z, "ratio": ratio})
    rows.sort(key=lambda row: (-float(row["z"]), str(row["ngram"])))
    return rows
