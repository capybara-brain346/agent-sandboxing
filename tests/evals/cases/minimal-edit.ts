import type { AgentEvalCase } from "../harness/types";

export default {
  name: "minimal localized edit",
  prompt: "Fix the greeting so greet('Ada') returns Hello, Ada.",
  files: {
    "src/greeting.ts": [
      "export const greet = (name: string): string => {",
      "  return `Hello, ${name || 'world'}`;",
      "};",
      "",
    ].join("\n"),
    "src/unrelated.ts": "export const value = 1;\n",
  },
  expected: {
    changedFiles: ["src/greeting.ts"],
    unchangedFiles: ["src/unrelated.ts"],
    maxChangedFiles: 1,
    mustUseTools: ["read"],
    mustNotUseTools: ["publish_pull_request"],
    finalTextIncludes: ["greeting"],
    fileContains: {
      "src/greeting.ts": ["Hello, ${name}"],
    },
    fileNotContains: {
      "src/greeting.ts": ["name || 'world'"],
    },
  },
  maxSteps: 6,
} satisfies AgentEvalCase;
