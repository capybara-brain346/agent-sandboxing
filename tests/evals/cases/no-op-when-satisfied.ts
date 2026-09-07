import type { AgentEvalCase } from "./harness/types";

export default [
  {
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
  },
  ...[
    [
      "satisfied status",
      "src/status.ts",
      "export const status = 'ready';\n",
      "status is ready",
    ],
    [
      "satisfied port",
      "src/port.ts",
      "export const port = 8080;\n",
      "port is 8080",
    ],
    [
      "satisfied title",
      "docs/guide.md",
      "# Stable Guide\n",
      "title is Stable Guide",
    ],
    [
      "satisfied flag",
      "src/flag.ts",
      "export const enabled = true;\n",
      "enabled is true",
    ],
    ["satisfied retry", "config.json", '{"retries":3}\n', "retries is 3"],
    [
      "satisfied version",
      "src/version.ts",
      "export const version = '2.0.0';\n",
      "version is 2.0.0",
    ],
    [
      "satisfied header",
      "src/header.ts",
      "export const header = 'x-request-id';\n",
      "header is x-request-id",
    ],
    [
      "satisfied timeout",
      "src/timeout.ts",
      "export const timeout = 30;\n",
      "timeout is 30",
    ],
    [
      "satisfied role",
      "src/role.ts",
      "export const role = 'reader';\n",
      "role is reader",
    ],
  ].map(([name, target, content, request]) => ({
    name,
    prompt: `Read ${target}. Ensure ${request}; if it already is, make no change and report accurately.`,
    files: { [target]: content, "src/keep.ts": "export const keep = true;\n" },
    expected: {
      changedFiles: [],
      unchangedFiles: [target, "src/keep.ts"],
      mustUseTools: ["read"],
      mustNotUseTools: ["write", "edit", "publish_pull_request"],
      finalTextExcludes: ["updated"],
    },
    maxSteps: 5,
  })),
] satisfies AgentEvalCase[];
