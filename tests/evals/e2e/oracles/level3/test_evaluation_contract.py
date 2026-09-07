import unittest

from api.evaluation.score_aggregator import ScoreAggregator


class EvaluationContractOracleTests(unittest.TestCase):
    def test_score_uses_the_camel_case_frontend_contract(self):
        result = ScoreAggregator("Beginner").aggregate(
            {"structural_score": 80, "issues": [], "warnings": [], "positives": []},
            {"llm_score": None},
        )
        self.assertIn("overallScore", result)
        self.assertNotIn("overall_score", result)
        self.assertIsInstance(result["overallScore"], float)


if __name__ == "__main__":
    unittest.main()
