from __future__ import annotations

import unittest

from analyze_stances import (
    ABSTENTION,
    FAVORABLE,
    MIN_JUDGED,
    UNFAVORABLE,
    Stance,
    analyze,
    evaluate,
    published,
    rule_stance,
)


def stance_of(text: str, section: str = "DISC_GENERALE_1", debate: str = "Un texte") -> str | None:
    found = rule_stance(text, section, debate)
    return found[0] if found else None


class RuleTests(unittest.TestCase):
    def test_explicit_announcements(self) -> None:
        cases = {
            "Pour toutes ces raisons, nous voterons contre ce texte.": UNFAVORABLE,
            "Nous voterons donc résolument contre ce projet de loi.": UNFAVORABLE,
            "Notre groupe s’opposera à cette proposition de loi.": UNFAVORABLE,
            "Nous nous opposerons à ce texte.": UNFAVORABLE,
            "Nous rejetterons ce projet de loi.": UNFAVORABLE,
            "Nous voterons ce texte mais nous serons vigilants.": FAVORABLE,
            "À titre personnel, je voterai en faveur du texte.": FAVORABLE,
            "Notre groupe soutiendra cette proposition de loi.": FAVORABLE,
            "Nous allons voter pour ce texte.": FAVORABLE,
            "C’est pourquoi nous nous abstiendrons sur ce texte.": ABSTENTION,
            "Notre groupe s’abstiendra donc.": ABSTENTION,
        }
        for text, expected in cases.items():
            with self.subTest(text=text):
                self.assertEqual(stance_of(text), expected)

    def test_quote_is_the_announcing_sentence(self) -> None:
        stance, quote = rule_stance("Ce texte est injuste. Nous voterons contre ce texte. Merci.", "DISC_GENERALE_1")
        self.assertEqual(stance, UNFAVORABLE)
        self.assertEqual(quote, "Nous voterons contre ce texte.")

    def test_amendments_articles_and_motions_are_not_the_bill(self) -> None:
        for text in (
            "Nous voterons cet amendement.",
            "Nous voterons contre l’article 3.",
            "Nous voterons la motion de rejet préalable.",
            "Nous voterons contre la motion de censure.",
        ):
            with self.subTest(text=text):
                self.assertIsNone(stance_of(text))

    def test_negations_conditions_questions_and_wishes_are_skipped(self) -> None:
        for text in (
            "Nous ne voterons pas ce texte.",
            "Si cet amendement est adopté, nous voterons contre ce texte.",
            "Sinon, nous voterons contre ce projet de loi.",
            "Voterons-nous ce texte ? Nous voterons ce texte ?",
            "J’espère que nous soutiendrons unanimement ce texte.",
            "Sous réserve de garanties, notre groupe soutiendra la proposition de loi.",
            "Notre groupe laisse la liberté de vote, mais nous voterons ce texte.",
            "Vous voterez contre ce texte, comme d’habitude.",
        ):
            with self.subTest(text=text):
                self.assertIsNone(stance_of(text))

    def test_bare_abstention_needs_a_vote_section(self) -> None:
        self.assertEqual(stance_of("Nous nous abstiendrons.", "DISC_GENERALE_1"), ABSTENTION)
        self.assertIsNone(stance_of("Nous nous abstiendrons.", "DISC_ARTICLES_1_2"))
        self.assertIsNone(stance_of("Sur cet amendement, nous nous abstiendrons.", "DISC_GENERALE_1"))
        self.assertEqual(stance_of("Nous nous abstiendrons sur ce texte.", "DISC_ARTICLES_1_2"), ABSTENTION)

    def test_conflicting_announcements_are_dropped(self) -> None:
        text = "Nous nous abstiendrons lors du vote du projet de loi. Nous voterons contre ce texte."
        self.assertIsNone(stance_of(text))

    def test_named_bill_in_a_joint_debate_is_ambiguous(self) -> None:
        joint = "Accompagnement et soins palliatifs – Droit à l’aide à mourir"
        text = "Je voterai pour la proposition de loi relative aux soins palliatifs."
        self.assertIsNone(stance_of(text, "DISC_ARTICLES_1_2", joint))
        self.assertEqual(stance_of(text, "DISC_ARTICLES_1_2", "Soins palliatifs"), FAVORABLE)


class PipelineTests(unittest.TestCase):
    def test_stances_follow_debate_themes_only(self) -> None:
        speeches = [
            {"speech_id": "a", "text": "Nous voterons contre ce texte.", "section_code": "DISC_GENERALE_1"},
            {"speech_id": "b", "text": "Nous voterons contre ce texte.", "section_code": "DISC_GENERALE_1"},
            {"speech_id": "c", "text": "Rien à signaler.", "section_code": "DISC_GENERALE_1"},
        ]
        results = analyze(speeches, {"a": ["fin-de-vie", "sante"], "c": ["sante"]})
        self.assertEqual([(item.speech_id, item.theme_id) for item in results], [("a", "fin-de-vie"), ("a", "sante")])
        self.assertTrue(all(item.method == "rule" and item.stance == UNFAVORABLE for item in results))

    def test_classifiers_fill_in_vote_sections_above_their_threshold(self) -> None:
        speeches = [
            {"speech_id": "a", "text": "Un long discours.", "section_code": "DISC_GENERALE_1", "debate_topic": "Budget"},
            {"speech_id": "b", "text": "Un discours hésitant.", "section_code": "DISC_GENERALE_1"},
            {"speech_id": "c", "text": "Sur l’article.", "section_code": "DISC_ARTICLES_1_2"},
        ]
        scores = {"Un long discours.": (FAVORABLE, 0.95), "Un discours hésitant.": (UNFAVORABLE, 0.6)}
        seen: list[str] = []

        def fake(text: str, debate: str) -> tuple[str, float]:
            seen.append(debate)
            return scores.get(text, ("aucune", 1.0))

        results = analyze(speeches, {"a": ["budget"], "b": ["budget"], "c": ["budget"]}, {"nli": (fake, 0.9)})
        self.assertEqual([(item.speech_id, item.stance, item.method) for item in results], [("a", FAVORABLE, "nli")])
        self.assertEqual(seen, ["Budget", ""])

    def test_only_methods_above_the_precision_threshold_are_published(self) -> None:
        good = [Stance(f"s{i}", "t", FAVORABLE, 0.95, "rule", "q") for i in range(MIN_JUDGED)]
        bad = [Stance(f"s{i}", "t", UNFAVORABLE, 0.9, "nli", "q") for i in range(MIN_JUDGED)]
        gold = [{"speech_id": f"s{i}", "stance": FAVORABLE, "sample": "holdout" if i % 2 else "dev"} for i in range(MIN_JUDGED)]
        evaluation = evaluate(good + bad, gold)
        self.assertTrue(evaluation["methods"]["rule"]["published"])
        self.assertFalse(evaluation["methods"]["nli"]["published"])
        self.assertEqual(evaluation["methods"]["rule"]["bySample"]["holdout"]["judged"], MIN_JUDGED // 2)
        self.assertEqual({item.method for item in published(good + bad, evaluation)}, {"rule"})

    def test_too_few_judgements_are_not_published(self) -> None:
        results = [Stance("s0", "t", FAVORABLE, 0.95, "rule", "q")]
        evaluation = evaluate(results, [{"speech_id": "s0", "stance": FAVORABLE}])
        self.assertEqual(evaluation["methods"]["rule"]["precision"], 1.0)
        self.assertFalse(evaluation["methods"]["rule"]["published"])


if __name__ == "__main__":
    unittest.main()
