from typing import Any, Dict, List, Set

NODE_CATEGORIES = {
    "ingestion": [
        "kafka",
        "kinesis",
        "s3-ingestion",
        "api-endpoint",
        "webhook",
        "pubsub",
    ],
    "storage": ["postgresql", "dynamodb", "mongodb", "cassandra", "s3-storage"],
    "cache": ["redis", "pinecone", "feature-store"],
    "processing": [
        "spark",
        "flink",
        "batch-etl",
        "airflow",
        "dataflow",
        "lambda",
        "feature-engineering",
        "model-training",
        "fine-tuning",
        "hyperparameter-tuning",
        "data-validation",
        "custom-transformer",
    ],
    "serving": [
        "llm-api",
        "quantized-model",
        "embedding-model",
        "classification-model",
        "regression-model",
        "vllm-server",
        "tgi-server",
        "sagemaker-endpoint",
        "batch-inference",
        "triton-server",
        "torchserve",
    ],
    "infrastructure": [
        "load-balancer",
        "sharding",
        "replication",
        "sqs-queue",
        "circuit-breaker",
        "retry-handler",
    ],
    "monitoring": ["prometheus", "logging", "ab-testing", "grafana"],
}

NODE_TO_CATEGORY = {}
for category, nodes in NODE_CATEGORIES.items():
    for node in nodes:
        NODE_TO_CATEGORY[node] = category


class RuleEngine:
    def __init__(
        self, nodes: List[Dict], edges: List[Dict], constraints: Dict[str, Any]
    ):
        self.nodes = nodes
        self.edges = edges
        self.constraints = constraints
        self.issues = []
        self.warnings = []
        self.positives = []

    def evaluate(self) -> Dict[str, Any]:
        structural_score = 100

        if self._is_empty_diagram():
            return {
                "structural_score": 0,
                "issues": ["Empty diagram - no nodes present"],
                "warnings": [],
                "positives": [],
                "deductions": {"empty_diagram": 100},
            }

        deductions = {}

        orphaned_penalty = self._check_orphaned_nodes()
        if orphaned_penalty > 0:
            deductions["orphaned_nodes"] = orphaned_penalty
            structural_score -= orphaned_penalty

        flow_penalty = self._check_data_flow()
        if flow_penalty > 0:
            deductions["data_flow"] = flow_penalty
            structural_score -= flow_penalty

        constraint_penalty = self._check_constraint_violations()
        if constraint_penalty > 0:
            deductions["constraint_violations"] = constraint_penalty
            structural_score -= constraint_penalty

        anti_pattern_penalty = self._check_anti_patterns()
        if anti_pattern_penalty > 0:
            deductions["anti_patterns"] = anti_pattern_penalty
            structural_score -= anti_pattern_penalty

        compatibility_penalty = self._check_node_compatibility()
        if compatibility_penalty > 0:
            deductions["incompatible_connections"] = compatibility_penalty
            structural_score -= compatibility_penalty

        self._check_best_practices()

        structural_score = max(0, min(100, structural_score))

        return {
            "structural_score": structural_score,
            "issues": self.issues,
            "warnings": self.warnings,
            "positives": self.positives,
            "deductions": deductions,
        }

    def _is_empty_diagram(self) -> bool:
        return len(self.nodes) == 0

    def _check_orphaned_nodes(self) -> int:
        if len(self.nodes) <= 1:
            return 0

        connected_nodes = set()
        for edge in self.edges:
            connected_nodes.add(edge.get("source"))
            connected_nodes.add(edge.get("target"))

        orphaned = []
        for node in self.nodes:
            node_id = node.get("id")
            if node_id not in connected_nodes:
                orphaned.append(node_id)

        if orphaned:
            self.issues.append(
                f"Orphaned nodes detected: {len(orphaned)} node(s) with no connections"
            )
            return min(20, len(orphaned) * 5)
        else:
            self.positives.append("All nodes are connected")

        return 0

    def _check_data_flow(self) -> int:
        penalty = 0
        node_types = [node.get("type") for node in self.nodes]

        has_ingestion = any(
            NODE_TO_CATEGORY.get(nt) == "ingestion" for nt in node_types
        )
        has_processing = any(
            NODE_TO_CATEGORY.get(nt) == "processing" for nt in node_types
        )
        has_serving = any(NODE_TO_CATEGORY.get(nt) == "serving" for nt in node_types)

        if not has_ingestion:
            self.warnings.append("No data ingestion component detected")
            penalty += 10

        if not has_serving and not has_processing:
            self.issues.append("No processing or serving components detected")
            penalty += 20

        if has_ingestion and has_processing and has_serving:
            self.positives.append(
                "Complete data pipeline: ingestion → processing → serving"
            )

        return penalty

    def _check_constraint_violations(self) -> int:
        penalty = 0

        qps = self._parse_numeric_constraint("qps")
        latency_ms = self._parse_numeric_constraint("latency")
        data_volume = self._parse_numeric_constraint("dataVolume")

        node_types = [node.get("type") for node in self.nodes]

        if qps and qps > 1000:
            has_load_balancer = "load-balancer" in node_types
            has_cache = any(NODE_TO_CATEGORY.get(nt) == "cache" for nt in node_types)
            has_queue = "sqs-queue" in node_types or "kafka" in node_types

            if not has_load_balancer:
                self.issues.append(f"High QPS ({qps}) requires load balancing")
                penalty += 10

            if not has_cache:
                self.warnings.append(
                    f"High QPS ({qps}) would benefit from caching layer"
                )
                penalty += 5

            if qps > 10000 and not has_queue:
                self.warnings.append(
                    f"Very high QPS ({qps}) should include message queue for smoothing"
                )
                penalty += 5

        if latency_ms and latency_ms < 100:
            has_cache = any(NODE_TO_CATEGORY.get(nt) == "cache" for nt in node_types)
            num_hops = self._estimate_pipeline_hops()

            if not has_cache:
                self.issues.append(
                    f"Low latency requirement ({latency_ms}ms) needs caching"
                )
                penalty += 10

            if num_hops > 5:
                self.warnings.append(
                    f"Low latency requirement ({latency_ms}ms) but {num_hops} processing hops detected"
                )
                penalty += 5

        if data_volume and "TB" in str(data_volume).upper():
            has_storage = any(
                NODE_TO_CATEGORY.get(nt) == "storage" for nt in node_types
            )
            has_distributed_processing = any(
                nt in ["spark", "flink", "dataflow"] for nt in node_types
            )

            if not has_storage:
                self.issues.append("Large data volume requires persistent storage")
                penalty += 15

            if not has_distributed_processing:
                self.warnings.append(
                    "Large data volume would benefit from distributed processing"
                )
                penalty += 5

        return penalty

    def _check_anti_patterns(self) -> int:
        penalty = 0
        node_types = [node.get("type") for node in self.nodes]

        has_replication = "replication" in node_types
        has_redundancy = (
            has_replication
            or len([n for n in node_types if NODE_TO_CATEGORY.get(n) == "storage"]) > 1
        )

        availability = self._parse_availability_constraint()
        if availability and availability >= 99.9:
            if not has_redundancy:
                self.issues.append(
                    f"High availability ({availability}%) requires redundancy/replication"
                )
                penalty += 15

            has_circuit_breaker = "circuit-breaker" in node_types
            has_retry = "retry-handler" in node_types
            if not (has_circuit_breaker or has_retry):
                self.warnings.append(
                    "High availability should include fault tolerance mechanisms"
                )
                penalty += 5

        if len(self.nodes) <= 10:
            complexity_needed = self._assess_complexity_needed()
            num_nodes = len(self.nodes)

            if complexity_needed == "medium":
                if num_nodes < 4:
                    self.issues.append(
                        f"Solution is far too simple for medium complexity requirements ({num_nodes} node(s) present)"
                    )
                    penalty += 30
                elif num_nodes < 6:
                    self.warnings.append(
                        "Solution appears simplified for medium complexity requirements"
                    )
                    penalty += 15
            elif complexity_needed == "high":
                if num_nodes < 6:
                    self.issues.append(
                        f"Solution is critically incomplete for high complexity requirements ({num_nodes} node(s) present)"
                    )
                    penalty += 50
                elif num_nodes < 10:
                    self.issues.append(
                        "Solution is too simple for high complexity requirements"
                    )
                    penalty += 25
            elif complexity_needed == "low" and num_nodes <= 2:
                self.positives.append("Simple solution appropriate for problem scope")

        if len(self.nodes) > 15:
            complexity_needed = self._assess_complexity_needed()
            if complexity_needed == "high":
                self.positives.append(
                    "Comprehensive architecture addresses complex requirements"
                )
            else:
                self.warnings.append(
                    "Architecture may be over-engineered for requirements"
                )
                penalty += 5

        critical_nodes = self._find_single_point_of_failure()
        if critical_nodes:
            self.warnings.append(
                f"Potential single points of failure: {len(critical_nodes)} critical node(s)"
            )
            penalty += 5

        return penalty

    def _check_node_compatibility(self) -> int:
        penalty = 0

        for edge in self.edges:
            source_node = self._find_node_by_id(edge.get("source"))
            target_node = self._find_node_by_id(edge.get("target"))

            if not source_node or not target_node:
                continue

            source_type = source_node.get("type")
            target_type = target_node.get("type")

            if not self._are_nodes_compatible(source_type, target_type):
                self.warnings.append(
                    f"Unusual connection: {source_type} → {target_type}"
                )
                penalty += 2

        return min(10, penalty)

    def _check_best_practices(self):
        node_types = [node.get("type") for node in self.nodes]

        has_monitoring = any(
            NODE_TO_CATEGORY.get(nt) == "monitoring" for nt in node_types
        )
        if has_monitoring:
            self.positives.append("Includes monitoring/observability")
        elif len(self.nodes) > 5:
            self.warnings.append("Consider adding monitoring for production system")

        has_cache = any(NODE_TO_CATEGORY.get(nt) == "cache" for nt in node_types)
        qps = self._parse_numeric_constraint("qps")
        if has_cache and qps and qps > 100:
            self.positives.append("Caching strategy for performance optimization")

        has_queue = "sqs-queue" in node_types or "kafka" in node_types
        if has_queue:
            self.positives.append("Asynchronous processing with message queue")

    def _find_node_by_id(self, node_id: str) -> Dict:
        for node in self.nodes:
            if node.get("id") == node_id:
                return node
        return None

    def _are_nodes_compatible(self, source_type: str, target_type: str) -> bool:
        source_cat = NODE_TO_CATEGORY.get(source_type)
        target_cat = NODE_TO_CATEGORY.get(target_type)

        valid_flows = [
            ("ingestion", "storage"),
            ("ingestion", "processing"),
            ("ingestion", "cache"),
            ("storage", "processing"),
            ("processing", "storage"),
            ("processing", "serving"),
            ("processing", "cache"),
            ("cache", "serving"),
            ("infrastructure", "storage"),
            ("infrastructure", "serving"),
            ("serving", "monitoring"),
            ("storage", "serving"),
        ]

        if (source_cat, target_cat) in valid_flows:
            return True

        if source_cat == target_cat and source_cat in ["processing", "infrastructure"]:
            return True

        return True

    def _estimate_pipeline_hops(self) -> int:
        if not self.edges:
            return len(self.nodes)

        return max(3, len(self.edges) // max(1, len(self.nodes) - 1))

    def _find_single_point_of_failure(self) -> List[str]:
        if len(self.nodes) <= 2:
            return []

        node_connections = {}
        for node in self.nodes:
            node_connections[node.get("id")] = {"in": 0, "out": 0}

        for edge in self.edges:
            source = edge.get("source")
            target = edge.get("target")
            if source in node_connections:
                node_connections[source]["out"] += 1
            if target in node_connections:
                node_connections[target]["in"] += 1

        critical = []
        for node_id, connections in node_connections.items():
            if connections["out"] >= 3 and connections["in"] <= 1:
                critical.append(node_id)

        return critical

    def _assess_complexity_needed(self) -> str:
        qps = self._parse_numeric_constraint("qps") or 0
        latency = self._parse_numeric_constraint("latency") or 1000
        availability = self._parse_availability_constraint() or 0

        if qps > 10000 or latency < 50 or availability >= 99.9:
            return "high"
        elif qps > 1000 or latency < 200 or availability >= 99:
            return "medium"
        else:
            return "low"

    def _parse_numeric_constraint(self, key: str) -> int:
        keys_to_check = [key]
        if key == "qps":
            keys_to_check = ["qps", "targetQPS", "throughput", "requestsPerSecond"]
        elif key == "latency":
            keys_to_check = [
                "latency",
                "latencyRequirement",
                "responseTime",
                "maxLatency",
            ]

        value = None
        for k in keys_to_check:
            if k in self.constraints:
                value = self.constraints[k]
                break

        if value is None:
            return None

        try:
            if isinstance(value, (int, float)):
                return int(value)

            value_str = str(value).strip().replace(",", "")
            numeric_part = ""
            for char in value_str:
                if char.isdigit() or char == ".":
                    numeric_part += char
                elif numeric_part:
                    break
                else:
                    continue

            if numeric_part:
                return int(float(numeric_part))
        except:
            pass

        return None

    def _parse_availability_constraint(self) -> float:
        keys_to_check = ["availability", "uptimeRequirement", "sla"]
        value = None
        for k in keys_to_check:
            if k in self.constraints:
                value = self.constraints[k]
                break

        if value is None:
            return None

        try:
            if isinstance(value, (int, float)):
                return float(value)

            value_str = str(value).strip().replace("%", "")
            return float(value_str)
        except:
            pass

        return None
