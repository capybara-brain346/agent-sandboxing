import type { AgentEvalCase } from "../harness/types";

export default {
  name: "contradictory constraints",
  prompt:
    "Inspect src/config.ts, then identify the conflict: change its mode to production, but do not modify any files. Ask for clarification and leave the workspace unchanged; do not call editing tools.",
  files: {
    "src/config.ts": 'export const mode = "development";\n',
    "src/other.ts": "export const other = true;\n",
  },
  expected: {
    changedFiles: [],
    unchangedFiles: ["src/config.ts", "src/other.ts"],
    mustUseTools: ["read"],
    mustNotUseTools: ["write", "edit", "publish_pull_request"],
    finalTextIncludes: ["conflict"],
  },
  maxSteps: 4,
} satisfies AgentEvalCase;
