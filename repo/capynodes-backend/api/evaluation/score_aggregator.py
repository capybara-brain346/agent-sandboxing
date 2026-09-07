import statistics
from typing import Any, Dict, List

DIFFICULTY_MULTIPLIERS = {"Beginner": 1.0, "Intermediate": 1.1, "Advanced": 1.2}


class ScoreAggregator:
    def __init__(self, difficulty: str = "Intermediate"):
        self.difficulty = difficulty
        self.rule_weight = 0.30
        self.llm_weight = 0.70

    def aggregate(
        self,
        rule_result: Dict[str, Any],
        llm_result: Dict[str, Any],
        fallback_result: Dict[str, Any] = None,
    ) -> Dict[str, Any]:
        structural_score = rule_result.get("structural_score", 0)
        llm_score = llm_result.get("llm_score")

        if llm_score is not None:
            raw_score = llm_score
            source = "hybrid"
        elif fallback_result and fallback_result.get("fallback_score") is not None:
            fallback_score = fallback_result.get("fallback_score", 0)
            raw_score = (structural_score * 0.5) + (fallback_score * 0.5)
            source = "fallback"
        else:
            raw_score = structural_score
            source = "rules_only"

        calibrated_score = self._calibrate_score(raw_score)

        final_score = self._apply_difficulty_bonus(calibrated_score)

        feedback = self._generate_comprehensive_feedback(
            rule_result, llm_result, fallback_result, source
        )

        return {
            "overallScore": round(final_score, 2),
            "rawScore": round(raw_score, 2),
            "calibratedScore": round(calibrated_score, 2),
            "source": source,
            "breakdown": self._build_breakdown(
                rule_result, llm_result, fallback_result, source
            ),
            "strengths": feedback["strengths"],
            "improvements": feedback["improvements"],
            "structuralAnalysis": {
                "score": structural_score,
                "issues": rule_result.get("issues", []),
                "warnings": rule_result.get("warnings", []),
                "positives": rule_result.get("positives", []),
                "deductions": rule_result.get("deductions", {}),
            },
        }

    def _calibrate_score(self, raw_score: float) -> float:
        if raw_score >= 90:
            return 85 + (raw_score - 90) * 1.5
        elif raw_score >= 80:
            return 75 + (raw_score - 80) * 1.0
        elif raw_score >= 70:
            return 65 + (raw_score - 70) * 1.0
        elif raw_score >= 50:
            return 45 + (raw_score - 50) * 1.0
        elif raw_score >= 30:
            return raw_score * 0.8
        else:
            return raw_score * 0.7

    def _apply_difficulty_bonus(self, score: float) -> float:
        multiplier = DIFFICULTY_MULTIPLIERS.get(self.difficulty, 1.0)

        if score >= 80:
            bonus = (score - 80) * (multiplier - 1.0)
            return min(100, score + bonus)
        elif self.difficulty == "Advanced" and score < 50:
            penalty = (50 - score) * 0.15
            return max(0, score - penalty)

        return score

    def _build_breakdown(
        self, rule_result: Dict, llm_result: Dict, fallback_result: Dict, source: str
    ) -> List[Dict]:
        if source == "hybrid" and llm_result.get("breakdown"):
            return llm_result.get("breakdown", [])

        elif source == "fallback":
            return [
                {
                    "category": "Overall Match",
                    "score": fallback_result.get("fallback_score", 50),
                    "weight": 1.0,
                    "explanation": "Scored based on similarity to ideal solution",
                }
            ]

        else:
            return [
                {
                    "category": "Structural Validation",
                    "score": rule_result.get("structural_score", 0),
                    "weight": 1.0,
                    "explanation": "Based on rule-based structural analysis",
                }
            ]

    def _generate_comprehensive_feedback(
        self, rule_result: Dict, llm_result: Dict, fallback_result: Dict, source: str
    ) -> Dict[str, List[str]]:
        strengths = []
        improvements = []

        raw_score = 0
        if source == "hybrid" and llm_result:
            raw_score = llm_result.get("llm_score", 0)
        elif source == "fallback" and fallback_result:
            raw_score = fallback_result.get("fallback_score", 0)
        else:
            raw_score = rule_result.get("structural_score", 0)

        positives = rule_result.get("positives", [])
        strengths.extend(positives[:3])

        issues = rule_result.get("issues", [])
        improvements.extend(issues[:3])

        warnings = rule_result.get("warnings", [])
        if warnings:
            improvements.extend([f"Warning: {w}" for w in warnings[:2]])

        if source == "hybrid" and llm_result:
            llm_strengths = llm_result.get("strengths", [])
            llm_improvements = llm_result.get("improvements", [])

            for strength in llm_strengths[:5]:
                if strength not in strengths:
                    strengths.append(strength)

            for improvement in llm_improvements[:5]:
                if improvement not in improvements:
                    improvements.append(improvement)

        elif source == "fallback" and fallback_result:
            fallback_feedback = fallback_result.get("feedback", [])
            improvements.extend(fallback_feedback)

        if not strengths and raw_score >= 40:
            strengths.append("Diagram structure submitted successfully")

        if not improvements:
            improvements.append(
                "Consider reviewing the architecture against all requirements"
            )

        return {"strengths": strengths[:5], "improvements": improvements[:7]}

    def normalize_scores(self, scores: List[float]) -> List[float]:
        if len(scores) < 2:
            return scores

        mean = statistics.mean(scores)
        stdev = statistics.stdev(scores) if len(scores) > 1 else 0

        if stdev == 0:
            return scores

        normalized = []
        for score in scores:
            z_score = (score - mean) / stdev

            clamped_z = max(-2, min(2, z_score))

            normalized_score = 50 + (clamped_z * 15)
            normalized.append(normalized_score)

        return normalized
