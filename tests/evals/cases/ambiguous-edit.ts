import type { AgentEvalCase } from "../harness/types";

export default {
  name: "ambiguous edit",
  prompt:
    "In src/labels.ts, replace pending with ready exactly once. Inspect the file first: pending occurs more than once, so do not guess which occurrence to change. Report the ambiguity and leave all files unchanged.",
  files: {
    "src/labels.ts": [
      'export const first = "pending";',
      'export const second = "pending";',
      "",
    ].join("\n"),
    "src/labels.test.ts": "export const expected = 2;\n",
  },
  expected: {
    changedFiles: [],
    unchangedFiles: ["src/labels.ts", "src/labels.test.ts"],
    mustUseTools: ["read"],
    mustNotUseTools: ["edit", "write", "publish_pull_request"],
    finalTextIncludes: ["ambiguous"],
  },
  maxSteps: 5,
} satisfies AgentEvalCase;
