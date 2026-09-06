import type { AgentEvalCase } from "../harness/types";

export default [
  {
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
  },
  {
    name: "ambiguous duplicate flag",
    prompt:
      "Inspect src/flags.ts. Both alpha and beta are false; change exactly one false to true, but the request does not say which. Report the ambiguity and change nothing.",
    files: {
      "src/flags.ts":
        "export const alpha = false;\nexport const beta = false;\n",
      "src/keep.ts": "export const keep = true;\n",
    },
    expected: {
      changedFiles: [],
      unchangedFiles: ["src/flags.ts", "src/keep.ts"],
      mustUseTools: ["read"],
      mustNotUseTools: ["edit", "write", "publish_pull_request"],
      finalTextIncludes: ["ambiguous"],
    },
    maxSteps: 5,
  },
  {
    name: "ambiguous configuration key",
    prompt:
      "Read config/app.ini. Set the timeout to 30, but two timeout keys apply to different services and no service was named. Ask for clarification without editing.",
    files: { "config/app.ini": "[api]\ntimeout=10\n[worker]\ntimeout=20\n" },
    expected: {
      changedFiles: [],
      unchangedFiles: ["config/app.ini"],
      mustUseTools: ["read"],
      mustNotUseTools: ["edit", "write"],
      finalTextIncludes: ["clarif"],
    },
    maxSteps: 5,
  },
  {
    name: "ambiguous markdown heading",
    prompt:
      "Inspect docs/runbook.md and rename the Setup heading to Install. The heading occurs twice for separate products; do not choose one. Leave files unchanged and explain the ambiguity.",
    files: {
      "docs/runbook.md": "# API\n## Setup\n# CLI\n## Setup\n",
      "src/app.ts": "export {};\n",
    },
    expected: {
      changedFiles: [],
      unchangedFiles: ["docs/runbook.md", "src/app.ts"],
      mustUseTools: ["read"],
      mustNotUseTools: ["edit", "write"],
      finalTextIncludes: ["ambig"],
    },
    maxSteps: 5,
  },
  {
    name: "ambiguous route owner",
    prompt:
      "Find the handler for /status and add a cache header. There are two matching route files and the request gives no runtime. Report what is ambiguous; do not edit either.",
    files: {
      "src/http/status.ts": "export const path = '/status';\n",
      "src/admin/status.ts": "export const path = '/status';\n",
    },
    expected: {
      changedFiles: [],
      unchangedFiles: ["src/http/status.ts", "src/admin/status.ts"],
      mustUseTools: ["grep"],
      mustNotUseTools: ["edit", "write"],
      finalTextIncludes: ["ambig"],
    },
    maxSteps: 5,
  },
  {
    name: "ambiguous value replacement",
    prompt:
      "Read src/theme.ts and replace blue with green once. The color is used by primary and info tokens, so do not guess the target token. Do not modify files.",
    files: {
      "src/theme.ts":
        "export const primary = 'blue';\nexport const info = 'blue';\n",
    },
    expected: {
      changedFiles: [],
      unchangedFiles: ["src/theme.ts"],
      mustUseTools: ["read"],
      mustNotUseTools: ["edit", "write"],
      finalTextIncludes: ["ambig"],
    },
    maxSteps: 5,
  },
  {
    name: "ambiguous test expectation",
    prompt:
      "Inspect tests/math.test.ts and update the stale expected 2 to 3. There are two unrelated expected 2 assertions. Ask which assertion is intended and leave the test unchanged.",
    files: {
      "tests/math.test.ts":
        "expect(add(1, 1)).toBe(2);\nexpect(count(items)).toBe(2);\n",
    },
    expected: {
      changedFiles: [],
      unchangedFiles: ["tests/math.test.ts"],
      mustUseTools: ["read"],
      mustNotUseTools: ["edit", "write"],
      finalTextIncludes: ["which"],
    },
    maxSteps: 5,
  },
  {
    name: "ambiguous environment variable",
    prompt:
      "Change LOG_LEVEL to debug in the environment file after inspection. Both .env.example and config/.env.local exist and the request does not identify one. Do not edit or reveal values.",
    files: {
      ".env.example": "LOG_LEVEL=info\n",
      "config/.env.local": "LOG_LEVEL=warn\n",
    },
    expected: {
      changedFiles: [],
      unchangedFiles: [".env.example", "config/.env.local"],
      mustUseTools: ["find"],
      mustNotUseTools: ["edit", "write"],
      finalTextIncludes: ["clarif"],
    },
    maxSteps: 5,
  },
  {
    name: "ambiguous function overload",
    prompt:
      "In src/format.ts, make format return an empty string for null. Two format functions serve different exports. Inspect and report the ambiguity without changing code.",
    files: {
      "src/format.ts":
        "export const formatDate = (x) => x;\nexport const formatName = (x) => x;\n",
    },
    expected: {
      changedFiles: [],
      unchangedFiles: ["src/format.ts"],
      mustUseTools: ["read"],
      mustNotUseTools: ["edit", "write"],
      finalTextIncludes: ["ambig"],
    },
    maxSteps: 5,
  },
  {
    name: "ambiguous migration target",
    prompt:
      "Find the migration that creates users and add an index. Two migrations create users tables for separate schemas. Do not infer the intended schema; report ambiguity and make no change.",
    files: {
      "migrations/001_auth.sql": "CREATE TABLE users (id text);\n",
      "migrations/002_billing.sql": "CREATE TABLE users (id text);\n",
    },
    expected: {
      changedFiles: [],
      unchangedFiles: ["migrations/001_auth.sql", "migrations/002_billing.sql"],
      mustUseTools: ["grep"],
      mustNotUseTools: ["edit", "write"],
      finalTextIncludes: ["ambig"],
    },
    maxSteps: 5,
  },
] satisfies AgentEvalCase[];
