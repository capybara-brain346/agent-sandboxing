import type { AgentEvalCase } from "../harness/types";

export default [
  {
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
  },
  ...[
    [
      "subagent profile tools",
      "profiles.yaml",
      "tools: [read, grep, find, ls]\n",
      "read",
    ],
    [
      "subagent write boundary",
      "src/subagent.ts",
      "export const tools = ['read', 'grep'];\n",
      "grep",
    ],
    [
      "subagent shell boundary",
      "docs/subagent.md",
      "Subagents cannot run bash.\n",
      "bash",
    ],
    [
      "subagent edit boundary",
      "docs/profile.md",
      "Restricted profile excludes edit and write.\n",
      "edit",
    ],
    [
      "subagent report boundary",
      "src/report.ts",
      "export const maximum = 20000;\n",
      "20000",
    ],
    [
      "subagent nesting boundary",
      "src/runner.ts",
      "export const nested = 'subagent';\n",
      "subagent",
    ],
    ["subagent find capability", "profiles.yml", "allowed: find\n", "find"],
    ["subagent ls capability", "profiles.yml", "allowed: ls\n", "ls"],
    [
      "subagent read-only boundary",
      "README.md",
      "The subagent is read-only.\n",
      "read-only",
    ],
  ].map(([name, target, content, fact]) => ({
    name,
    prompt: `Investigate ${target} for the subagent capability boundary and summarize it. Use a subagent for the investigation; do not modify files.`,
    files: { [target]: content },
    expected: {
      changedFiles: [],
      unchangedFiles: [target],
      mustUseTools: ["subagent"],
      mustNotUseTools: ["write", "edit", "publish_pull_request"],
      finalTextIncludes: [fact],
    },
    maxSteps: 10,
  })),
] satisfies AgentEvalCase[];
