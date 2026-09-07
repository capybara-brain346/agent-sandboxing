from typing import Any, Dict, List

from dotenv import load_dotenv

from ..logging_utils import log_execution_time
from .fallback_engine import FallbackEngine
from .llm_evaluator import LLMEvaluator
from .rule_engine import RuleEngine
from .score_aggregator import ScoreAggregator

load_dotenv()


@log_execution_time
def evaluate_diagram(
    problem_statement: str,
    constraints: Dict[str, Any],
    nodes: List[Dict],
    edges: List[Dict],
    difficulty: str = "Intermediate",
    ideal_solution: Dict[str, Any] = None,
) -> Dict[str, Any]:
    rule_engine = RuleEngine(nodes, edges, constraints)
    rule_result = rule_engine.evaluate()

    llm_evaluator = LLMEvaluator(problem_statement, constraints, nodes, edges)
    llm_result = llm_evaluator.evaluate()

    fallback_result = None
    if not llm_result.get("success"):
        fallback_engine = FallbackEngine(nodes, edges, ideal_solution)
        fallback_result = fallback_engine.evaluate()

    aggregator = ScoreAggregator(difficulty)
    final_result = aggregator.aggregate(rule_result, llm_result, fallback_result)

    final_result["evaluation_metadata"] = {
        "stages_completed": {
            "rule_based": True,
            "llm_evaluation": llm_result.get("success", False),
            "fallback_used": fallback_result is not None,
        },
        "weights": {
            "rule_based": 0.00 if llm_result.get("success") else 0.50,
            "llm_evaluation": 1.00 if llm_result.get("success") else 0.00,
            "fallback": 0.50 if fallback_result else 0.00,
        },
    }

    if llm_result.get("error"):
        final_result["evaluation_metadata"]["llm_error"] = llm_result["error"]

    return final_result
