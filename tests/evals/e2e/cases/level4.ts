import path from "node:path";
import { replaceFixtureText } from "../harness/fixture";
import type { CapyNodesEvalCase } from "../harness/types";

const level4: CapyNodesEvalCase = {
  id: "level-4-analytics-average",
  level: 4,
  title: "Analytics preserves the average score",
  prompt:
    "Debug the analytics regression end to end. After evaluations are persisted, the profile analytics average_score must be the arithmetic mean of the user's scored submissions, not their sum. Trace the request, submission persistence, stats updater, and profile response, add a regression test for multiple scores, and leave settings, migrations, and the frontend untouched.",
  seed: async (root) =>
    replaceFixtureText(
      root,
      "api/stats_updater.py",
      "    stats.average_score = total_score / stats.total_submissions",
      "    stats.average_score = total_score",
    ),
  oracleDirectory: path.resolve("tests/evals/e2e/oracles/level4/e2e_hidden"),
  grading: [
    {
      name: "level 4 hidden analytics regression tests",
      command:
        "DATABASE_URL='' DJANGO_SETTINGS_MODULE=capynodes_backend.settings uv run --project /opt/capynodes-backend --frozen --offline python manage.py test e2e_hidden.test_analytics_average",
    },
  ],
  protectedPaths: [
    "api/migrations",
    "capynodes_backend/settings.py",
    "capynodes-frontend",
    "pyproject.toml",
    "uv.lock",
  ],
  requiredPaths: ["api/stats_updater.py"],
};

export default level4;
