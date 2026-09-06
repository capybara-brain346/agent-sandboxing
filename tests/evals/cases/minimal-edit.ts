import type { AgentEvalCase } from "../harness/types";

export default [
  {
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
  },
  {
    name: "minimal status literal",
    prompt:
      "Fix src/status.ts so status is ready instead of pending. Change only the target file.",
    files: {
      "src/status.ts": "export const status = 'pending';\n",
      "src/unrelated.ts": "export const n = 1;\n",
    },
    expected: {
      changedFiles: ["src/status.ts"],
      unchangedFiles: ["src/unrelated.ts"],
      maxChangedFiles: 1,
      mustUseTools: ["read"],
      mustNotUseTools: ["publish_pull_request"],
      fileContains: { "src/status.ts": ["ready"] },
      fileNotContains: { "src/status.ts": ["pending"] },
    },
    maxSteps: 6,
  },
  {
    name: "minimal port fix",
    prompt:
      "Correct src/port.ts to export port 8080, with no unrelated changes.",
    files: {
      "src/port.ts": "export const port = 8000;\n",
      "README.md": "port 8000\n",
    },
    expected: {
      changedFiles: ["src/port.ts"],
      unchangedFiles: ["README.md"],
      maxChangedFiles: 1,
      mustUseTools: ["read"],
      fileContains: { "src/port.ts": ["8080"] },
      fileNotContains: { "src/port.ts": ["8000"] },
    },
    maxSteps: 6,
  },
  {
    name: "minimal title fix",
    prompt:
      "Change only docs/title.md so its title is Service Guide rather than Service Notes.",
    files: { "docs/title.md": "# Service Notes\n", "docs/keep.md": "# Keep\n" },
    expected: {
      changedFiles: ["docs/title.md"],
      unchangedFiles: ["docs/keep.md"],
      maxChangedFiles: 1,
      mustUseTools: ["read"],
      fileContains: { "docs/title.md": ["# Service Guide"] },
      fileNotContains: { "docs/title.md": ["# Service Notes"] },
    },
    maxSteps: 6,
  },
  {
    name: "minimal boolean fix",
    prompt:
      "Fix src/flags.ts so beta is true. Do not refactor alpha or other files.",
    files: {
      "src/flags.ts":
        "export const alpha = true;\nexport const beta = false;\n",
      "src/index.ts": "export {};\n",
    },
    expected: {
      changedFiles: ["src/flags.ts"],
      unchangedFiles: ["src/index.ts"],
      maxChangedFiles: 1,
      mustUseTools: ["read"],
      fileContains: { "src/flags.ts": ["beta = true", "alpha = true"] },
      fileNotContains: { "src/flags.ts": ["beta = false"] },
    },
    maxSteps: 6,
  },
  {
    name: "minimal punctuation fix",
    prompt:
      "Add the missing period to src/message.ts, modifying no other file.",
    files: {
      "src/message.ts": "export const message = 'Ready'\n",
      "src/other.ts": "export const other = 1;\n",
    },
    expected: {
      changedFiles: ["src/message.ts"],
      unchangedFiles: ["src/other.ts"],
      maxChangedFiles: 1,
      mustUseTools: ["read"],
      fileContains: { "src/message.ts": ["Ready."] },
      fileNotContains: { "src/message.ts": ["'Ready'"] },
    },
    maxSteps: 6,
  },
  {
    name: "minimal json fix",
    prompt: "Change only config.json to set cache to true.",
    files: {
      "config.json": '{"cache":false}\n',
      "package.json": '{"private":true}\n',
    },
    expected: {
      changedFiles: ["config.json"],
      unchangedFiles: ["package.json"],
      maxChangedFiles: 1,
      mustUseTools: ["read"],
      fileContains: { "config.json": ["true"] },
      fileNotContains: { "config.json": ["false"] },
    },
    maxSteps: 6,
  },
  {
    name: "minimal default fix",
    prompt:
      "Fix src/limit.ts so its default limit is 100, touching only that file.",
    files: {
      "src/limit.ts": "export const limit = 10;\n",
      "tests/limit.ts": "export {};\n",
    },
    expected: {
      changedFiles: ["src/limit.ts"],
      unchangedFiles: ["tests/limit.ts"],
      maxChangedFiles: 1,
      mustUseTools: ["read"],
      fileContains: { "src/limit.ts": ["100"] },
      fileNotContains: { "src/limit.ts": ["10"] },
    },
    maxSteps: 6,
  },
  {
    name: "minimal config mode",
    prompt:
      "Set mode to production in src/mode.ts and preserve the adjacent log setting.",
    files: {
      "src/mode.ts":
        "export const mode = 'development';\nexport const log = 'info';\n",
    },
    expected: {
      changedFiles: ["src/mode.ts"],
      maxChangedFiles: 1,
      mustUseTools: ["read"],
      fileContains: { "src/mode.ts": ["production", "log = 'info'"] },
      fileNotContains: { "src/mode.ts": ["development"] },
    },
    maxSteps: 6,
  },
  {
    name: "minimal tag fix",
    prompt:
      "Update src/tag.ts from v1 to v2 only; do not modify the changelog.",
    files: {
      "src/tag.ts": "export const tag = 'v1';\n",
      "CHANGELOG.md": "v1\n",
    },
    expected: {
      changedFiles: ["src/tag.ts"],
      unchangedFiles: ["CHANGELOG.md"],
      maxChangedFiles: 1,
      mustUseTools: ["read"],
      fileContains: { "src/tag.ts": ["v2"] },
      fileNotContains: { "src/tag.ts": ["v1"] },
    },
    maxSteps: 6,
  },
] satisfies AgentEvalCase[];
