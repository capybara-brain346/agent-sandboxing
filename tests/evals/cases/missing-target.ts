import type { AgentEvalCase } from "../harness/types";

export default {
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
} satisfies AgentEvalCase;
