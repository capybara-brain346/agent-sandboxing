import type { AgentEvalCase } from "../harness/types";

export default {
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
} satisfies AgentEvalCase;
