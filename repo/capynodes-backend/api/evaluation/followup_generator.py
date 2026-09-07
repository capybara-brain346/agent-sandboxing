import json
import os
from typing import Any, Dict, List

from dotenv import load_dotenv
from groq import Groq

from .graph_processor import GraphProcessor

load_dotenv()


class FollowUpQuestionsGenerator:
    def __init__(
        self,
        problem_statement: str,
        constraints: Dict[str, Any],
        nodes: List[Dict],
        edges: List[Dict],
    ):
        self.problem_statement = problem_statement
        self.constraints = constraints
        self.nodes = nodes
        self.edges = edges
        self.client = None

    def generate(self) -> Dict[str, Any]:
        try:
            self.client = Groq(api_key=os.environ.get("GROQ_API_KEY"))

            diagram_text = self._serialize_diagram()
            prompt = self._build_prompt(diagram_text)

            completion = self.client.chat.completions.create(
                model="qwen/qwen3-32b",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.2,
                max_tokens=2048,
                response_format={"type": "json_object"},
            )

            result = json.loads(completion.choices[0].message.content)

            return {
                "success": True,
                "questions": result.get("questions", [])[:3],
            }

        except Exception as e:
            return {"success": False, "error": str(e), "questions": []}

    def _serialize_diagram(self) -> str:
        processor = GraphProcessor(self.nodes, self.edges)
        return processor.format_as_context()

    def _build_prompt(self, diagram_text: str) -> str:
        constraints_text = "\n".join(
            [f"- {k}: {v}" for k, v in self.constraints.items() if v]
        )

        return f"""You are an expert AI/ML system design interviewer. Based on the problem statement and the candidate's current architecture design, generate exactly 3 thoughtful follow-up questions.

These questions should:
1. Help the candidate think deeper about their design decisions
2. Probe potential weaknesses or unexplored areas
3. Encourage consideration of edge cases, scalability, or reliability concerns
4. Be specific to their actual design (reference their components when relevant)

## Problem Statement
{self.problem_statement}

## Constraints
{constraints_text if constraints_text else "- No specific constraints provided"}

## Candidate's Current Architecture
{diagram_text if diagram_text else "- No components added yet"}

## Response Format
Respond in JSON format with exactly 3 questions:

{{
  "questions": [
    "First follow-up question that probes a specific aspect of their design...",
    "Second follow-up question about scalability, reliability, or edge cases...",
    "Third follow-up question that challenges their assumptions or explores alternatives..."
  ]
}}

Generate questions that are insightful, specific to their design, and would lead to a productive discussion about system design trade-offs."""

    def is_available(self) -> bool:
        try:
            api_key = os.environ.get("GROQ_API_KEY")
            return api_key is not None and api_key != ""
        except Exception:
            return False
