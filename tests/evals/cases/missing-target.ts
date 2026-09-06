import type { AgentEvalCase } from "../harness/types";

export default [
  {
    name: "missing target",
    prompt:
      "Update docs/missing.md by replacing the old heading with the new heading. Inspect the workspace first; if the requested file is absent, report that it is missing instead of creating it. Do not create or modify any file.",
    files: {
      "docs/README.md": "# Existing guide\n",
    },
    expected: {
      changedFiles: [],
      mustUseTools: ["find"],
      mustNotUseTools: ["write", "edit", "publish_pull_request"],
      finalTextIncludes: ["missing"],
      finalTextExcludes: ["updated docs/missing.md"],
    },
    maxSteps: 5,
  },
  ...[
    ["missing changelog", "docs/CHANGELOG.md"],
    ["missing route", "src/routes/health.ts"],
    ["missing schema", "prisma/schema.prisma"],
    ["missing config", "config/prod.yml"],
    ["missing test", "tests/widget.test.ts"],
    ["missing script", "scripts/release.sh"],
    ["missing guide", "docs/deploy.md"],
    ["missing component", "src/ui/Button.ts"],
    ["missing migration", "migrations/003_add_logs.sql"],
  ].map(([name, target]) => ({
    name,
    prompt: `Inspect the workspace for ${target}. If it is absent, report it as missing and do not create or modify any file.`,
    files: {
      "README.md": "# Fixture\n",
      "src/keep.ts": "export const keep = true;\n",
    },
    expected: {
      changedFiles: [],
      unchangedFiles: ["README.md", "src/keep.ts"],
      mustUseTools: ["find"],
      mustNotUseTools: ["write", "edit", "publish_pull_request"],
      finalTextIncludes: ["missing"],
      finalTextExcludes: [`updated ${target}`],
    },
    maxSteps: 5,
  })),
] satisfies AgentEvalCase[];
