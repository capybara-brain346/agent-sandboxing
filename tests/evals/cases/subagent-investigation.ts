import type { AgentEvalCase } from "../harness/types";

export default {
  name: "subagent investigation",
  prompt:
    "Investigate how the agent service limits subagent capabilities and summarize the answer.",
  files: {
    "src/services/agent/tools/profiles/profiles.yaml": [
      "profiles:",
      "  main:",
      "    all: true",
      "  subagent:",
      "    tools:",
      "      - read",
      "      - grep",
      "      - find",
      "      - ls",
      "",
    ].join("\n"),
    "src/services/agent/agent-runner.ts": [
      "const runSubagent = profile === 'main' ? async input => new AgentRunner({ profile: 'subagent' }).process({ instructions: input.task }) : undefined;",
      "const system = profile === 'subagent' ? SUBAGENT_SYSTEM_PROMPT : AGENT_SYSTEM_PROMPT;",
      "",
    ].join("\n"),
  },
  expected: {
    changedFiles: [],
    mustUseTools: ["subagent"],
    mustNotUseTools: ["write", "edit", "publish_pull_request"],
    finalTextIncludes: ["read", "grep", "find", "ls"],
  },
  maxSteps: 10,
} satisfies AgentEvalCase;
