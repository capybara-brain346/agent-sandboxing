import unittest

from api.evaluation.graph_normalizer import hash_graph, normalize_graph


class GraphNormalizerOracleTests(unittest.TestCase):
    def test_selection_state_is_not_part_of_the_canonical_graph(self):
        nodes = [
            {"id": "b", "type": "storage", "selected": True},
            {"id": "a", "type": "source", "selected": False},
        ]
        edges = [{"id": "e", "source": "a", "target": "b"}]
        before = {"nodes": [dict(node) for node in nodes], "edges": [dict(edge) for edge in edges]}
        selected_hash = hash_graph(nodes, edges)
        nodes[0]["selected"] = False
        nodes[1]["selected"] = True
        self.assertEqual(selected_hash, hash_graph(nodes, edges))
        normalized = normalize_graph(nodes, edges)
        self.assertEqual([node["id"] for node in normalized["nodes"]], ["a", "b"])
        self.assertTrue(all("selected" not in node for node in normalized["nodes"]))
        self.assertEqual(before["edges"], edges)


if __name__ == "__main__":
    unittest.main()
