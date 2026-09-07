from typing import Any, Dict, List, Set


class FallbackEngine:
    def __init__(
        self,
        nodes: List[Dict],
        edges: List[Dict],
        ideal_solution: Dict[str, Any] = None,
    ):
        self.nodes = nodes
        self.edges = edges
        self.ideal_solution = ideal_solution or {}

    def evaluate(self) -> Dict[str, Any]:
        if not self.ideal_solution:
            return self._basic_fallback()

        ideal_nodes = self.ideal_solution.get("nodes", [])
        ideal_edges = self.ideal_solution.get("edges", [])

        node_score = self._calculate_node_similarity(ideal_nodes)

        edge_score = self._calculate_edge_similarity(ideal_edges)

        pattern_score = self._calculate_pattern_similarity(ideal_nodes, ideal_edges)

        fallback_score = (node_score * 0.4) + (edge_score * 0.3) + (pattern_score * 0.3)

        feedback = self._generate_feedback(
            ideal_nodes, ideal_edges, node_score, edge_score
        )

        return {
            "success": True,
            "fallback_score": round(fallback_score, 2),
            "node_similarity": round(node_score, 2),
            "edge_similarity": round(edge_score, 2),
            "pattern_similarity": round(pattern_score, 2),
            "feedback": feedback,
            "warning": "LLM evaluation unavailable - using fallback matching",
        }

    def _basic_fallback(self) -> Dict[str, Any]:
        base_score = 20

        if len(self.nodes) == 0:
            score = 0
            feedback = ["Empty diagram submitted"]
        elif len(self.nodes) < 3:
            score = base_score - 10
            feedback = ["Solution appears incomplete - very few components"]
        elif len(self.nodes) > 20:
            score = base_score
            feedback = ["Solution may be over-complex"]
        else:
            score = base_score + 10
            feedback = ["Diagram submitted successfully"]

        if len(self.edges) == 0 and len(self.nodes) > 1:
            score -= 15
            feedback.append("No connections between components")

        if score < 0:
            score = 0

        return {
            "success": True,
            "fallback_score": score,
            "node_similarity": None,
            "edge_similarity": None,
            "pattern_similarity": None,
            "feedback": feedback,
            "warning": "LLM evaluation unavailable and no ideal solution - using basic scoring",
        }

    def _calculate_node_similarity(self, ideal_nodes: List[Dict]) -> float:
        if not ideal_nodes:
            return 50.0

        user_node_types = set(node.get("type") for node in self.nodes)
        ideal_node_types = set(node.get("type") for node in ideal_nodes)

        if not ideal_node_types:
            return 50.0

        intersection = len(user_node_types & ideal_node_types)
        union = len(user_node_types | ideal_node_types)

        if union == 0:
            return 0.0

        jaccard_similarity = intersection / union

        score = jaccard_similarity * 100

        if len(user_node_types) > len(ideal_node_types) * 1.5:
            score *= 0.9

        return min(100.0, score)

    def _calculate_edge_similarity(self, ideal_edges: List[Dict]) -> float:
        if not ideal_edges:
            return 50.0

        user_edge_patterns = self._extract_edge_patterns(self.nodes, self.edges)
        ideal_edge_patterns = self._extract_edge_patterns(
            self.ideal_solution.get("nodes", []), ideal_edges
        )

        if not ideal_edge_patterns:
            return 50.0

        intersection = len(user_edge_patterns & ideal_edge_patterns)
        union = len(user_edge_patterns | ideal_edge_patterns)

        if union == 0:
            return 0.0

        return (intersection / union) * 100

    def _extract_edge_patterns(
        self, nodes: List[Dict], edges: List[Dict]
    ) -> Set[tuple]:
        node_id_to_type = {node.get("id"): node.get("type") for node in nodes}

        patterns = set()
        for edge in edges:
            source_type = node_id_to_type.get(edge.get("source"))
            target_type = node_id_to_type.get(edge.get("target"))
            if source_type and target_type:
                patterns.add((source_type, target_type))

        return patterns

    def _calculate_pattern_similarity(
        self, ideal_nodes: List[Dict], ideal_edges: List[Dict]
    ) -> float:
        if not ideal_nodes:
            return 50.0

        user_patterns = self._detect_architecture_patterns(self.nodes, self.edges)
        ideal_patterns = self._detect_architecture_patterns(ideal_nodes, ideal_edges)

        if not ideal_patterns:
            return 50.0

        matches = sum(1 for pattern in ideal_patterns if pattern in user_patterns)

        return (matches / len(ideal_patterns)) * 100

    def _detect_architecture_patterns(
        self, nodes: List[Dict], edges: List[Dict]
    ) -> Set[str]:
        patterns = set()
        node_types = [node.get("type") for node in nodes]

        if "load-balancer" in node_types:
            patterns.add("load_balancing")

        if "redis" in node_types or "pinecone" in node_types:
            patterns.add("caching")

        if (
            "kafka" in node_types
            or "sqs-queue" in node_types
            or "kinesis" in node_types
        ):
            patterns.add("message_queue")

        if "replication" in node_types or node_types.count("postgresql") > 1:
            patterns.add("replication")

        if "spark" in node_types or "flink" in node_types or "dataflow" in node_types:
            patterns.add("distributed_processing")

        serving_nodes = [
            "vllm-server",
            "tgi-server",
            "triton-server",
            "torchserve",
            "sagemaker-endpoint",
            "llm-api",
        ]
        if any(node in node_types for node in serving_nodes):
            patterns.add("model_serving")

        if (
            "prometheus" in node_types
            or "grafana" in node_types
            or "logging" in node_types
        ):
            patterns.add("observability")

        if "circuit-breaker" in node_types or "retry-handler" in node_types:
            patterns.add("fault_tolerance")

        return patterns

    def _generate_feedback(
        self,
        ideal_nodes: List[Dict],
        ideal_edges: List[Dict],
        node_score: float,
        edge_score: float,
    ) -> List[str]:
        feedback = []

        user_node_types = set(node.get("type") for node in self.nodes)
        ideal_node_types = set(node.get("type") for node in ideal_nodes)

        missing_nodes = ideal_node_types - user_node_types
        if missing_nodes:
            feedback.append(
                f"Missing components from ideal solution: {', '.join(list(missing_nodes)[:3])}"
            )

        extra_nodes = user_node_types - ideal_node_types
        if len(extra_nodes) > 3:
            feedback.append(
                f"Solution includes {len(extra_nodes)} additional components not in ideal solution"
            )

        if node_score >= 80:
            feedback.append("Component selection closely matches ideal solution")
        elif node_score >= 60:
            feedback.append("Component selection partially matches ideal solution")
        else:
            feedback.append(
                "Component selection differs significantly from ideal solution"
            )

        if edge_score >= 70:
            feedback.append("Data flow pattern is well-structured")
        elif edge_score < 40:
            feedback.append("Consider reviewing the data flow connections")

        ideal_patterns = self._detect_architecture_patterns(ideal_nodes, ideal_edges)
        user_patterns = self._detect_architecture_patterns(self.nodes, self.edges)

        missing_patterns = ideal_patterns - user_patterns
        if missing_patterns:
            pattern_names = {
                "load_balancing": "load balancing",
                "caching": "caching layer",
                "message_queue": "message queue",
                "replication": "replication",
                "distributed_processing": "distributed processing",
                "model_serving": "model serving",
                "observability": "monitoring/observability",
                "fault_tolerance": "fault tolerance",
            }
            readable_patterns = [pattern_names.get(p, p) for p in missing_patterns]
            feedback.append(f"Consider adding: {', '.join(readable_patterns[:2])}")

        return feedback
