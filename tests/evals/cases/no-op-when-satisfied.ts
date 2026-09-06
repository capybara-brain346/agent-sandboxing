import type { AgentEvalCase } from "../harness/types";

export default {
  name: "no-op when satisfied",
  prompt: "Change the greeting so greet('Ada') returns Hello, Ada.",
  files: {
    "src/greeting.ts": [
      "export const greet = (name: string): string => {",
      "  return `Hello, ${name}`;",
      "};",
      "",
    ].join("\n"),
  },
  expected: {
    changedFiles: [],
    mustUseTools: ["read"],
    mustNotUseTools: ["write", "edit", "publish_pull_request"],
  },
  maxSteps: 5,
} satisfies AgentEvalCase;
