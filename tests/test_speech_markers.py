"""Unit tests for parliamentary address and negation detectors."""

from __future__ import annotations

import unittest

from speech_markers import (
    classify_marker,
    find_address_phrases,
    find_negation_phrases,
    marker_tokens,
    rate_per_thousand,
)


class AddressTests(unittest.TestCase):
    def test_formula_address(self) -> None:
        tokens = marker_tokens("monsieur le ministre chers collègues")
        self.assertEqual(
            find_address_phrases(tokens),
            ["monsieur le ministre", "chers collègues"],
        )

    def test_possessive_colleague(self) -> None:
        self.assertEqual(find_address_phrases(["notre", "collègue"]), ["notre collègue"])

    def test_bare_ministre_is_not_address(self) -> None:
        tokens = marker_tokens("le ministre des affaires")
        self.assertEqual(find_address_phrases(tokens), [])


class NegationTests(unittest.TestCase):
    def test_ne_pas_window(self) -> None:
        tokens = marker_tokens("n est pas acceptable")
        self.assertEqual(find_negation_phrases(tokens), ["n est pas"])

    def test_comparative_plus_is_ignored(self) -> None:
        self.assertEqual(find_negation_phrases(marker_tokens("les plus vulnérables")), [])
        self.assertEqual(find_negation_phrases(marker_tokens("beaucoup plus de moyens")), [])
        self.assertEqual(find_negation_phrases(marker_tokens("ne plus de délais")), [])

    def test_ne_plus_negation(self) -> None:
        self.assertEqual(find_negation_phrases(marker_tokens("ne plus attendre")), ["ne plus"])

    def test_standalone_jamais(self) -> None:
        self.assertEqual(find_negation_phrases(["jamais", "accepté"]), ["jamais accepté"])

    def test_classify_no_longer_uses_pas(self) -> None:
        self.assertIsNone(classify_marker(["est", "pas"]))
        self.assertEqual(classify_marker(["avis", "défavorable"]), "procedure")

    def test_rate(self) -> None:
        self.assertEqual(rate_per_thousand(2, 1000), 2.0)
        self.assertEqual(rate_per_thousand(1, 0), 0.0)


if __name__ == "__main__":
    unittest.main()
