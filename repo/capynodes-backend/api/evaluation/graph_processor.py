import collections
from typing import Any, Dict, List, Set

from .node_labels import NODE_LABELS


class GraphProcessor:
    def __init__(self, nodes: List[Dict], edges: List[Dict]):
        self.nodes = {n["id"]: n for n in nodes}
        self.edges = edges
        self.adj_list = collections.defaultdict(list)
        self.rev_adj_list = collections.defaultdict(list)
        self.in_degree = collections.defaultdict(int)

        self._build_graph()

    def _build_graph(self):
        for e in self.edges:
            src, tgt = e.get("source"), e.get("target")
            if src in self.nodes and tgt in self.nodes:
                self.adj_list[src].append(tgt)
                self.rev_adj_list[tgt].append(src)
                self.in_degree[tgt] += 1
                if src not in self.in_degree:
                    self.in_degree[src] = 0

    def get_layers(self) -> Dict[int, List[str]]:
        layers = collections.defaultdict(list)
        queue = collections.deque()
        depths = {}

        for node_id in self.nodes:
            if self.in_degree[node_id] == 0:
                queue.append((node_id, 0))
                depths[node_id] = 0

        if not queue and self.nodes:
            start_node = list(self.nodes.keys())[0]
            queue.append((start_node, 0))
            depths[start_node] = 0

        visited = set()
        while queue:
            node_id, depth = queue.popleft()

            if node_id in visited:
                continue
            visited.add(node_id)

            layers[depth].append(node_id)

            for neighbor in self.adj_list[node_id]:
                if neighbor not in depths:
                    depths[neighbor] = depth + 1
                    queue.append((neighbor, depth + 1))

        for node_id in self.nodes:
            if node_id not in visited:
                layers[999].append(node_id)

        return layers

    def extract_critical_paths(self, max_paths=5, max_depth=10) -> List[str]:
        paths = []
        sources = [n for n in self.nodes if self.in_degree[n] == 0]
        if not sources:
            sources = list(self.nodes.keys())[:1]

        def dfs(current_path, depth):
            if len(paths) >= max_paths:
                return
            if depth > max_depth:
                return

            curr = current_path[-1]
            neighbors = self.adj_list[curr]

            if not neighbors:
                paths.append(list(current_path))
                return

            for neighbor in neighbors:
                if neighbor not in current_path:
                    dfs(current_path + [neighbor], depth + 1)

        for src in sources:
            dfs([src], 0)

        return [" -> ".join([self._get_label(nid) for nid in p]) for p in paths]

    def _get_label(self, node_id):
        node = self.nodes.get(node_id)
        if not node:
            return node_id
        lbl = NODE_LABELS.get(node.get("type"), node.get("type", "Unknown"))
        return f"[{lbl}]"

    def format_as_context(self) -> str:
        layers = self.get_layers()
        sorted_depths = sorted(layers.keys())

        output = []

        paths = self.extract_critical_paths()
        if paths:
            output.append("### 1. Key Data Flows (Traces)")
            for i, p in enumerate(paths, 1):
                output.append(f"Trace {i}: {p}")
            output.append("")

        output.append("### 2. Architecture Layers")

        layer_names = {
            0: "Layer 1 (Ingestion / Entry)",
            1: "Layer 2 (Processing / Routing)",
            2: "Layer 3",
            3: "Layer 4",
            999: "Disconnected / Isolated Components (WARNING: No incoming or outgoing connections detected)",
        }

        for depth in sorted_depths:
            layer_nodes = layers[depth]
            if not layer_nodes:
                continue

            layer_name = layer_names.get(depth, f"Layer {depth + 1}")
            output.append(f"#### {layer_name}")

            for nid in layer_nodes:
                node = self.nodes[nid]
                node_type = node.get("type")
                type_label = NODE_LABELS.get(node_type, node_type)

                data = node.get("data", {})
                desc = data.get("description")
                config_str = ""

                important_keys = [
                    k
                    for k in data.keys()
                    if k
                    not in [
                        "description",
                        "label",
                        "isDemo",
                        "onDemoClick",
                        "onDemoDelete",
                    ]
                ]
                if important_keys:
                    kv_pairs = [f"{k}={data[k]}" for k in important_keys if data[k]]
                    if kv_pairs:
                        config_str = f" (Config: {', '.join(kv_pairs)})"

                line = f"- {nid}: **{type_label}**{config_str}"
                if desc:
                    line += f"\n  - 📝 Context: {desc}"
                output.append(line)

            output.append("")

        if self.edges:
            output.append("### 3. Explicit Connections")
            for edge in self.edges:
                src_id = edge.get("source")
                tgt_id = edge.get("target")
                src_label = self._get_label(src_id)
                tgt_label = self._get_label(tgt_id)
                output.append(f"- {src_id} {src_label} -> {tgt_id} {tgt_label}")
            output.append("")

        formatted_context = "\n".join(output)
        # print(formatted_context)
        return formatted_context
