import path from "node:path";
import { replaceFixtureText } from "../harness/fixture";
import type { CapyNodesEvalCase } from "../harness/types";

const level1: CapyNodesEvalCase = {
  id: "level-1-graph-normalization",
  level: 1,
  title: "Graph normalization ignores selection state",
  prompt:
    "Fix the graph normalizer regression. React Flow selection state is UI-only and must not change the canonical normalized graph or its SHA-256 hash. Preserve the public function API, keep canonical node and edge ordering stable, and add a focused regression test. Limit implementation changes to api/evaluation/graph_normalizer.py and do not modify configuration, migrations, or frontend files.",
  seed: async (root) =>
    replaceFixtureText(
      root,
      "api/evaluation/graph_normalizer.py",
      '    "selected",\n    "dragging"',
      '    "dragging"',
    ),
  oracleDirectory: path.resolve("tests/evals/e2e/oracles/level1"),
  grading: [
    {
      name: "level 1 hidden graph normalizer tests",
      command:
        "uv run --python 3.12 --no-project --offline python -m unittest discover -s e2e_hidden -p 'test_*.py'",
    },
  ],
  protectedPaths: [
    "api/migrations",
    "capynodes_backend/settings.py",
    "capynodes-frontend",
    "pyproject.toml",
    "uv.lock",
  ],
  requiredPaths: ["api/evaluation/graph_normalizer.py"],
};

export default level1;
