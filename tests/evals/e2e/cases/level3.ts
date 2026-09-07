import path from "node:path";
import { replaceFixtureText } from "../harness/fixture";
import type { CapyNodesEvalCase } from "../harness/types";

const level3: CapyNodesEvalCase = {
  id: "level-3-evaluation-contract",
  level: 3,
  title: "Django and Next agree on the evaluation score contract",
  prompt:
    "Restore the evaluation response contract across Django and Next. The public field is camelCase overallScore, and the backend response, frontend API types, editor store, and score display must agree without introducing a snake_case alias. Keep all other evaluation fields compatible, add or update regression coverage where appropriate, and verify the frontend with its production Next build. Do not modify auth, settings, or migrations.",
  seed: async (root) => {
    await replaceFixtureText(
      root,
      "api/evaluation/score_aggregator.py",
      '            "overallScore": round(final_score, 2),',
      '            "overall_score": round(final_score, 2),',
    );
    await replaceFixtureText(
      root,
      "capynodes-frontend/src/store/editor-store.ts",
      "  overallScore: number;",
      "  overall_score: number;",
    );
  },
  oracleDirectory: path.resolve("tests/evals/e2e/oracles/level3"),
  grading: [
    {
      name: "level 3 hidden evaluation contract tests",
      command:
        "uv run --python 3.12 --no-project --offline python -m unittest discover -s e2e_hidden -p 'test_*.py'",
    },
    {
      name: "level 3 Next production build",
      command:
        "NEXT_FONT_GOOGLE_MOCKED_RESPONSES=/tmp/capynodes-e2e-repo/e2e_hidden/next-font-mocks.json pnpm --dir capynodes-frontend exec next build --webpack",
    },
  ],
  protectedPaths: [
    "api/migrations",
    "capynodes_backend/settings.py",
    "api/models.py",
  ],
  requiredPaths: [
    "api/evaluation/score_aggregator.py",
    "capynodes-frontend/src/store/editor-store.ts",
  ],
};

export default level3;
