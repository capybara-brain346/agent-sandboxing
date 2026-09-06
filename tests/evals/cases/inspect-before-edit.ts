import type { AgentEvalCase } from "../harness/types";

export default {
  name: "inspect before edit",
  prompt:
    "In src/settings.ts, change the mode value from development to production. The target is unclear until you inspect the file, so read it first, then make only the requested edit. Do not touch adjacent files or publish anything.",
  files: {
    "src/settings.ts": [
      "export const settings = {",
      '  mode: "development",',
      "  retries: 2,",
      "};",
      "",
    ].join("\n"),
    "src/adjacent.ts": "export const adjacent = true;\n",
  },
  expected: {
    changedFiles: ["src/settings.ts"],
    unchangedFiles: ["src/adjacent.ts"],
    maxChangedFiles: 1,
    mustUseTools: ["read", "edit"],
    mustNotUseTools: ["publish_pull_request"],
    finalTextIncludes: ["settings.ts", "production"],
    fileContains: {
      "src/settings.ts": ['mode: "production"'],
    },
    fileNotContains: {
      "src/settings.ts": ['mode: "development"'],
    },
  },
  validate: (transcript) => {
    const firstRead = transcript.toolCalls.indexOf("read");
    const firstEdit = transcript.toolCalls.indexOf("edit");
    return firstRead >= 0 && firstRead < firstEdit
      ? []
      : [
          "expected the first read tool call to precede the first edit tool call",
        ];
  },
  maxSteps: 6,
} satisfies AgentEvalCase;
