import type { AgentEvalCase } from "../harness/types";

export default [
  {
    name: "read-only investigation",
    prompt:
      "Find where session-agent context is composed and explain the flow. Do not modify files.",
    files: {
      "src/services/chat/session-agent-processor.ts": [
        "export const composeSessionAgentMessage = (context, request) => [",
        "  `Session summary:${context.summary}`,",
        "  `Recent conversation:${context.recentMessages}`,",
        "  `User request:${request}`,",
        "].join('\\n\\n');",
        "export class SessionAgentProcessor { process(context) { return this.runner.process({ instructions: composeSessionAgentMessage({}, context.instructions) }); } }",
        "",
      ].join("\n"),
      "src/services/agent/agent-runner.ts": [
        "export class AgentRunner {",
        "  process(context) { return generateText({ messages: [{ role: 'user', content: context.instructions }] }); }",
        "}",
        "",
      ].join("\n"),
    },
    expected: {
      changedFiles: [],
      mustUseTools: ["read"],
      mustNotUseTools: ["write", "edit", "publish_pull_request"],
      finalTextIncludes: [
        "composeSessionAgentMessage",
        "session-agent-processor",
      ],
    },
    maxSteps: 5,
  },
  ...[
    [
      "read-only config ownership",
      "src/config.ts",
      "export const config = { region: 'us' };\n",
      "config",
    ],
    [
      "read-only route lookup",
      "src/routes/health.ts",
      "export const path = '/health';\n",
      "health",
    ],
    [
      "read-only export lookup",
      "src/index.ts",
      "export { handler } from './handler';\n",
      "handler",
    ],
    [
      "read-only dependency lookup",
      "package.json",
      '{"name":"fixture","type":"module"}\n',
      "module",
    ],
    [
      "read-only prompt lookup",
      "prompts/system.txt",
      "Use concise output.\n",
      "concise",
    ],
    [
      "read-only test lookup",
      "tests/app.test.ts",
      "expect(true).toBe(true);\n",
      "test",
    ],
    [
      "read-only schema lookup",
      "prisma/schema.prisma",
      "model User { id String @id }\n",
      "User",
    ],
    [
      "read-only documentation lookup",
      "docs/README.md",
      "# Operations\n",
      "Operations",
    ],
    ["read-only profile lookup", "profiles.yaml", "tools:\n  - read\n", "read"],
  ].map(([name, target, content, fact]) => ({
    name,
    prompt: `Read ${target} and summarize the relevant implementation fact. Do not modify files.`,
    files: { [target]: content, "src/keep.ts": "export const keep = true;\n" },
    expected: {
      changedFiles: [],
      unchangedFiles: [target, "src/keep.ts"],
      mustUseTools: ["read"],
      mustNotUseTools: ["write", "edit", "publish_pull_request"],
      finalTextIncludes: [fact],
    },
    maxSteps: 5,
  })),
] satisfies AgentEvalCase[];
