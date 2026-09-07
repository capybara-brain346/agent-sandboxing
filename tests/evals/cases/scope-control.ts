import type { AgentEvalCase } from "./harness/types";

export default [
  {
    name: "scope control",
    prompt:
      "Update only docs/README.md by changing its title from Project Notes to Project Guide. Inspect the target first. Leave src/index.ts and package.json untouched, and do not publish anything.",
    files: {
      "docs/README.md": "# Project Notes\n\nKeep this guide short.\n",
      "src/index.ts": "export const app = true;\n",
      "package.json": '{"name":"fixture","private":true}\n',
    },
    expected: {
      changedFiles: ["docs/README.md"],
      unchangedFiles: ["src/index.ts", "package.json"],
      maxChangedFiles: 1,
      mustUseTools: ["read", "edit"],
      mustNotUseTools: ["publish_pull_request"],
      finalTextIncludes: ["README.md"],
      fileContains: {
        "docs/README.md": ["# Project Guide"],
      },
      fileNotContains: {
        "docs/README.md": ["# Project Notes"],
      },
    },
    maxSteps: 6,
  },
  ...[
    ["scope title", "docs/title.md", "# Notes\n", "# Guide\n", "src/app.ts"],
    [
      "scope status",
      "src/status.ts",
      "export const status = 'old';\n",
      "export const status = 'new';\n",
      "README.md",
    ],
    [
      "scope port",
      "config/port.ts",
      "export const port = 80;\n",
      "export const port = 443;\n",
      "package.json",
    ],
    [
      "scope flag",
      "src/flag.ts",
      "export const enabled = false;\n",
      "export const enabled = true;\n",
      "tests/flag.ts",
    ],
    [
      "scope version",
      "src/version.ts",
      "export const version = '1';\n",
      "export const version = '2';\n",
      "CHANGELOG.md",
    ],
    [
      "scope region",
      "config/region.ts",
      "export const region = 'eu';\n",
      "export const region = 'us';\n",
      "src/index.ts",
    ],
    [
      "scope heading",
      "docs/guide.md",
      "# Draft\n",
      "# Stable\n",
      "docs/other.md",
    ],
    [
      "scope color",
      "src/theme.ts",
      "export const color = 'red';\n",
      "export const color = 'blue';\n",
      "src/reset.ts",
    ],
    [
      "scope timeout",
      "src/timeout.ts",
      "export const timeout = 10;\n",
      "export const timeout = 30;\n",
      "tests/timeout.ts",
    ],
  ].map(([name, target, before, after, untouched]) => ({
    name,
    prompt: `Update only ${target} from its old value to its requested new value. Inspect first and leave ${untouched} untouched.`,
    files: { [target]: before, [untouched]: "export const keep = true;\n" },
    expected: {
      changedFiles: [target],
      unchangedFiles: [untouched],
      maxChangedFiles: 1,
      mustUseTools: ["read", "edit"],
      mustNotUseTools: ["publish_pull_request"],
      fileContains: { [target]: [after] },
      fileNotContains: { [target]: [before] },
    },
    maxSteps: 6,
  })),
] satisfies AgentEvalCase[];
