import hashlib
import json
from typing import Any, Dict, List


UI_ONLY_FIELDS = {
    "position",
    "positionAbsolute",
    "width",
    "height",
    "selected",
    "dragging",
    "measured",
    "style",
    "className",
    "hidden",
    "zIndex",
    "extent",
    "parentNode",
    "expandParent",
    "focused",
    "resizing",
    "deletable",
    "selectable",
    "connectable",
    "focusable",
}

EDGE_UI_FIELDS = {
    "style",
    "className",
    "hidden",
    "selected",
    "animated",
    "labelStyle",
    "labelBgStyle",
    "labelBgPadding",
    "labelBgBorderRadius",
    "zIndex",
    "focusable",
    "interactionWidth",
}


def _remove_ui_fields(obj: Dict[str, Any], fields_to_remove: set) -> Dict[str, Any]:
    return {k: v for k, v in obj.items() if k not in fields_to_remove}


def _normalize_node(node: Dict[str, Any]) -> Dict[str, Any]:
    normalized = _remove_ui_fields(node, UI_ONLY_FIELDS)

    if "data" in normalized and isinstance(normalized["data"], dict):
        data = normalized["data"]
        if "position" in data:
            del data["position"]

    return normalized


def _normalize_edge(edge: Dict[str, Any]) -> Dict[str, Any]:
    return _remove_ui_fields(edge, EDGE_UI_FIELDS)


def normalize_graph(nodes: List[Dict], edges: List[Dict]) -> Dict[str, Any]:
    normalized_nodes = sorted(
        [_normalize_node(node) for node in nodes], key=lambda n: n.get("id", "")
    )

    normalized_edges = sorted(
        [_normalize_edge(edge) for edge in edges],
        key=lambda e: (e.get("source", ""), e.get("target", "")),
    )

    return {
        "nodes": normalized_nodes,
        "edges": normalized_edges,
    }


def normalize_graph_to_json(nodes: List[Dict], edges: List[Dict]) -> str:
    normalized = normalize_graph(nodes, edges)
    return json.dumps(normalized, sort_keys=True, separators=(",", ":"))


def hash_graph(nodes: List[Dict], edges: List[Dict]) -> str:
    normalized_json = normalize_graph_to_json(nodes, edges)
    return hashlib.sha256(normalized_json.encode()).hexdigest()


def hash_normalized_json(normalized_json: str) -> str:
    return hashlib.sha256(normalized_json.encode()).hexdigest()
