import json
import os
import time
from typing import Any, Dict, Optional

from dotenv import load_dotenv
from google import genai

load_dotenv()


class Judge:
    JUDGE_MODEL = "gemini-3-flash-preview"

    def __init__(self):
        self.client = None
        self._init_client()

    def _init_client(self):
        try:
            api_key = os.environ.get("GEMINI_API_KEY")
            if api_key:
                self.client = genai.Client(api_key=api_key)
        except ImportError:
            pass

    def is_available(self) -> bool:
        api_key = os.environ.get("GEMINI_API_KEY")
        return api_key is not None and api_key != "" and self.client is not None

    def evaluate(
        self,
        graph_json: Dict[str, Any],
        system_prompt: str,
        model_response: str,
        problem_statement: str = "",
    ) -> Dict[str, Any]:
        if not self.is_available():
            return {
                "success": False,
                "error": "Gemini API not available",
            }

        prompt = self._build_judge_prompt(
            graph_json, system_prompt, model_response, problem_statement
        )

        try:
            from google.genai import types

            start_time = time.perf_counter()

            response_schema = {
                "type": "OBJECT",
                "properties": {
                    "graph_fidelity_score": {"type": "INTEGER"},
                    "logical_correctness_score": {"type": "INTEGER"},
                    "instruction_adherence_score": {"type": "INTEGER"},
                    "hallucination_flag": {"type": "BOOLEAN"},
                    "notes": {"type": "STRING"},
                },
                "required": [
                    "graph_fidelity_score",
                    "logical_correctness_score",
                    "instruction_adherence_score",
                    "hallucination_flag",
                    "notes",
                ],
            }

            response = self.client.models.generate_content(
                model=self.JUDGE_MODEL,
                contents=prompt,
                config=types.GenerateContentConfig(
                    temperature=0.3,
                    max_output_tokens=8192,
                    response_mime_type="application/json",
                    response_schema=response_schema,
                ),
            )

            latency_ms = int((time.perf_counter() - start_time) * 1000)

            if hasattr(response, "candidates") and response.candidates:
                candidate = response.candidates[0]
                print(f"DEBUG: Finish reason: {candidate.finish_reason}")
                if candidate.finish_reason != "STOP":
                    print(
                        f"DEBUG: Candidate content missing or partial. Reason: {candidate.finish_reason}"
                    )
            else:
                print("DEBUG: No candidates in response")

            if hasattr(response, "parsed") and response.parsed:
                result = response.parsed
                if not isinstance(result, dict):
                    result = (
                        result.model_dump()
                        if hasattr(result, "model_dump")
                        else vars(result)
                    )
            else:
                text = response.text.strip()
                if text.startswith("```json"):
                    text = text.split("```json", 1)[1].split("```", 1)[0].strip()
                elif text.startswith("```"):
                    text = text.split("```", 1)[1].split("```", 1)[0].strip()

                try:
                    result = json.loads(text)
                except json.JSONDecodeError as e:
                    print(f"DEBUG: Failed to parse JSON. Raw text: \n{text}")
                    print(f"DEBUG: Text length: {len(text)}")
                    raise e

            return {
                "success": True,
                "graph_fidelity_score": int(result.get("graph_fidelity_score", 3)),
                "logical_correctness_score": int(
                    result.get("logical_correctness_score", 3)
                ),
                "instruction_adherence_score": int(
                    result.get("instruction_adherence_score", 3)
                ),
                "hallucination_flag": bool(result.get("hallucination_flag", False)),
                "notes": str(result.get("notes", "")),
                "latency_ms": latency_ms,
            }

        except Exception as e:
            return {
                "success": False,
                "error": f"{type(e).__name__}: {str(e)}",
            }

    def _build_judge_prompt(
        self,
        graph_json: Dict[str, Any],
        system_prompt: str,
        model_response: str,
        problem_statement: str,
    ) -> str:
        graph_str = json.dumps(graph_json, indent=2)

        return f"""You are an expert evaluator assessing an LLM's response to a system design problem.

## Task
Evaluate the following LLM response based on the input graph and context.

## Problem Statement
{problem_statement if problem_statement else "Not provided"}

## Input Graph (JSON)
```json
{graph_str}
```

## System Prompt Used
{system_prompt[:1000]}{"..." if len(system_prompt) > 1000 else ""}

## Model Response to Evaluate
{model_response[:3000]}{"..." if len(model_response) > 3000 else ""}

## Evaluation Criteria

Score each dimension on a scale of 1-5:
- 1: Very Poor - Major issues, largely incorrect
- 2: Poor - Significant problems
- 3: Acceptable - Meets basic requirements
- 4: Good - Well done with minor issues
- 5: Excellent - Outstanding quality

### Dimensions

1. **Graph Fidelity (1-5)**: Does the response accurately reflect the components and connections in the input graph? Does it correctly identify nodes, edges, and their relationships?

2. **Logical Correctness (1-5)**: Is the analysis logically sound? Are the conclusions supported by the evidence in the graph? Are there any logical errors or inconsistencies?

3. **Instruction Adherence (1-5)**: Does the response follow the format and requirements specified in the system prompt? Does it address all requested aspects?

4. **Hallucination Flag (boolean)**: Does the response contain fabricated information not present in the input? (true = hallucination detected, false = no hallucination)

## Response Format

Respond in JSON format:
{{
    "graph_fidelity_score": <1-5>,
    "logical_correctness_score": <1-5>,
    "instruction_adherence_score": <1-5>,
    "hallucination_flag": <true/false>,
    "notes": "Brief explanation of scores and any issues found"
}}"""


def evaluate_llm_call(llm_call_log) -> Optional[Dict[str, Any]]:
    judge = Judge()

    if not judge.is_available():
        return None

    system_prompt = f"Model: {llm_call_log.model_name}, Version: {llm_call_log.system_prompt_version}"

    result = judge.evaluate(
        graph_json=llm_call_log.graph_json,
        system_prompt=system_prompt,
        model_response=llm_call_log.response_text,
    )

    return result if result.get("success") else None
