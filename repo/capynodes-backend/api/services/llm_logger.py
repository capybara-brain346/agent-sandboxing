import os
import time
from typing import Any, Dict, List, Optional

from django.utils import timezone

from ..observability_models import LLMCallLog
from ..evaluation.graph_normalizer import hash_graph, normalize_graph_to_json


class LLMLogger:
    def __init__(
        self,
        endpoint_name: str,
        nodes: List[Dict],
        edges: List[Dict],
        model_name: str = "qwen/qwen3-32b",
        system_prompt_version: str = None,
        graph_schema_version: str = "1.0",
    ):
        self.endpoint_name = endpoint_name
        self.nodes = nodes
        self.edges = edges
        self.model_name = model_name
        self.system_prompt_version = system_prompt_version or os.environ.get(
            "SYSTEM_PROMPT_VERSION", "1.0"
        )
        self.graph_schema_version = graph_schema_version

        self.graph_json = normalize_graph_to_json(nodes, edges)
        self.graph_hash = hash_graph(nodes, edges)

        self._start_time: Optional[float] = None
        self._log_entry: Optional[LLMCallLog] = None
        self._model_parameters: Dict[str, Any] = {}

    def start(self, model_parameters: Dict[str, Any] = None) -> "LLMLogger":
        self._start_time = time.perf_counter()
        self._model_parameters = model_parameters or {}
        return self

    def log_success(
        self,
        response_text: str,
        token_usage: Dict[str, int] = None,
        finish_reason: str = "",
    ) -> LLMCallLog:
        latency_ms = self._calculate_latency()

        self._log_entry = LLMCallLog.objects.create(
            endpoint_name=self.endpoint_name,
            graph_json={"nodes": self.nodes, "edges": self.edges},
            graph_hash=self.graph_hash,
            graph_schema_version=self.graph_schema_version,
            system_prompt_version=self.system_prompt_version,
            model_name=self.model_name,
            model_parameters=self._model_parameters,
            response_text=response_text,
            token_usage=token_usage or {},
            latency_ms=latency_ms,
            finish_reason=finish_reason,
        )

        return self._log_entry

    def log_error(self, error: str) -> LLMCallLog:
        latency_ms = self._calculate_latency()

        self._log_entry = LLMCallLog.objects.create(
            endpoint_name=self.endpoint_name,
            graph_json={"nodes": self.nodes, "edges": self.edges},
            graph_hash=self.graph_hash,
            graph_schema_version=self.graph_schema_version,
            system_prompt_version=self.system_prompt_version,
            model_name=self.model_name,
            model_parameters=self._model_parameters,
            latency_ms=latency_ms,
            error=error,
        )

        return self._log_entry

    def _calculate_latency(self) -> Optional[int]:
        if self._start_time is None:
            return None
        elapsed = time.perf_counter() - self._start_time
        return int(elapsed * 1000)

    @property
    def log_entry(self) -> Optional[LLMCallLog]:
        return self._log_entry


def log_llm_call(
    endpoint_name: str,
    nodes: List[Dict],
    edges: List[Dict],
    model_name: str,
    model_parameters: Dict[str, Any],
    response_text: str,
    token_usage: Dict[str, int] = None,
    latency_ms: int = None,
    finish_reason: str = "",
    error: str = "",
) -> LLMCallLog:
    graph_json = normalize_graph_to_json(nodes, edges)
    graph_hash = hash_graph(nodes, edges)

    return LLMCallLog.objects.create(
        endpoint_name=endpoint_name,
        graph_json={"nodes": nodes, "edges": edges},
        graph_hash=graph_hash,
        graph_schema_version="1.0",
        system_prompt_version=os.environ.get("SYSTEM_PROMPT_VERSION", "1.0"),
        model_name=model_name,
        model_parameters=model_parameters,
        response_text=response_text,
        token_usage=token_usage or {},
        latency_ms=latency_ms,
        finish_reason=finish_reason,
        error=error,
    )
