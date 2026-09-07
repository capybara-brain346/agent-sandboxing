import type { AgentEvalCase } from "./harness/types";

export default [
  {
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
  },
  {
    name: "inspect env edit",
    prompt:
      "Read src/env.ts before changing API_URL from http://old to https://new. Change only that value.",
    files: {
      "src/env.ts": "export const API_URL = 'http://old';\n",
      "src/keep.ts": "export {};\n",
    },
    expected: {
      changedFiles: ["src/env.ts"],
      unchangedFiles: ["src/keep.ts"],
      maxChangedFiles: 1,
      mustUseTools: ["read", "edit"],
      fileContains: { "src/env.ts": ["https://new"] },
      fileNotContains: { "src/env.ts": ["http://old"] },
    },
    validate: (t) =>
      t.toolCalls.indexOf("read") < t.toolCalls.indexOf("edit")
        ? []
        : ["expected read before edit"],
    maxSteps: 6,
  },
  {
    name: "inspect json edit",
    prompt:
      "Inspect config.json, then change retry from 1 to 2. Do not modify package.json.",
    files: {
      "config.json": '{"retry":1}\n',
      "package.json": '{"name":"keep"}\n',
    },
    expected: {
      changedFiles: ["config.json"],
      unchangedFiles: ["package.json"],
      maxChangedFiles: 1,
      mustUseTools: ["read", "edit"],
      fileContains: { "config.json": ['"retry":2'] },
      fileNotContains: { "config.json": ['"retry":1'] },
    },
    validate: (t) =>
      t.toolCalls.indexOf("read") < t.toolCalls.indexOf("edit")
        ? []
        : ["expected read before edit"],
    maxSteps: 6,
  },
  {
    name: "inspect markdown edit",
    prompt:
      "Read docs/guide.md first, then change Draft to Stable in its title only.",
    files: {
      "docs/guide.md": "# Draft Guide\nBody\n",
      "docs/other.md": "# Draft Other\n",
    },
    expected: {
      changedFiles: ["docs/guide.md"],
      unchangedFiles: ["docs/other.md"],
      maxChangedFiles: 1,
      mustUseTools: ["read", "edit"],
      fileContains: { "docs/guide.md": ["# Stable Guide"] },
      fileNotContains: { "docs/guide.md": ["# Draft Guide"] },
    },
    validate: (t) =>
      t.toolCalls.indexOf("read") < t.toolCalls.indexOf("edit")
        ? []
        : ["expected read before edit"],
    maxSteps: 6,
  },
  {
    name: "inspect boolean edit",
    prompt:
      "Inspect src/feature.ts before switching enabled from false to true. Leave tests untouched.",
    files: {
      "src/feature.ts": "export const enabled = false;\n",
      "tests/feature.ts": "export {};\n",
    },
    expected: {
      changedFiles: ["src/feature.ts"],
      unchangedFiles: ["tests/feature.ts"],
      maxChangedFiles: 1,
      mustUseTools: ["read", "edit"],
      fileContains: { "src/feature.ts": ["true"] },
      fileNotContains: { "src/feature.ts": ["false"] },
    },
    validate: (t) =>
      t.toolCalls.indexOf("read") < t.toolCalls.indexOf("edit")
        ? []
        : ["expected read before edit"],
    maxSteps: 6,
  },
  {
    name: "inspect yaml edit",
    prompt:
      "Read config/service.yml before changing replicas from 1 to 2. Make no other edit.",
    files: {
      "config/service.yml": "replicas: 1\n",
      "config/keep.yml": "region: us\n",
    },
    expected: {
      changedFiles: ["config/service.yml"],
      unchangedFiles: ["config/keep.yml"],
      maxChangedFiles: 1,
      mustUseTools: ["read", "edit"],
      fileContains: { "config/service.yml": ["replicas: 2"] },
      fileNotContains: { "config/service.yml": ["replicas: 1"] },
    },
    validate: (t) =>
      t.toolCalls.indexOf("read") < t.toolCalls.indexOf("edit")
        ? []
        : ["expected read before edit"],
    maxSteps: 6,
  },
  {
    name: "inspect export edit",
    prompt:
      "Inspect src/constants.ts then change MAX from 5 to 6, preserving MIN.",
    files: {
      "src/constants.ts": "export const MIN = 1;\nexport const MAX = 5;\n",
    },
    expected: {
      changedFiles: ["src/constants.ts"],
      maxChangedFiles: 1,
      mustUseTools: ["read", "edit"],
      fileContains: { "src/constants.ts": ["MAX = 6", "MIN = 1"] },
      fileNotContains: { "src/constants.ts": ["MAX = 5"] },
    },
    validate: (t) =>
      t.toolCalls.indexOf("read") < t.toolCalls.indexOf("edit")
        ? []
        : ["expected read before edit"],
    maxSteps: 6,
  },
  {
    name: "inspect css edit",
    prompt:
      "Read src/style.css before changing the .card border from gray to black.",
    files: {
      "src/style.css": ".card { border: gray; }\n",
      "src/reset.css": "body {}\n",
    },
    expected: {
      changedFiles: ["src/style.css"],
      unchangedFiles: ["src/reset.css"],
      maxChangedFiles: 1,
      mustUseTools: ["read", "edit"],
      fileContains: { "src/style.css": ["border: black"] },
      fileNotContains: { "src/style.css": ["border: gray"] },
    },
    validate: (t) =>
      t.toolCalls.indexOf("read") < t.toolCalls.indexOf("edit")
        ? []
        : ["expected read before edit"],
    maxSteps: 6,
  },
  {
    name: "inspect error code",
    prompt:
      "Inspect src/error.ts and change NOT_FOUND from 404 to 410 only after reading it.",
    files: { "src/error.ts": "export const NOT_FOUND = 404;\n" },
    expected: {
      changedFiles: ["src/error.ts"],
      maxChangedFiles: 1,
      mustUseTools: ["read", "edit"],
      fileContains: { "src/error.ts": ["410"] },
      fileNotContains: { "src/error.ts": ["404"] },
    },
    validate: (t) =>
      t.toolCalls.indexOf("read") < t.toolCalls.indexOf("edit")
        ? []
        : ["expected read before edit"],
    maxSteps: 6,
  },
  {
    name: "inspect list edit",
    prompt:
      "Read src/roles.ts before replacing viewer with reader in the exported list. Do not touch docs.",
    files: {
      "src/roles.ts": "export const roles = ['viewer'];\n",
      "docs/roles.md": "viewer\n",
    },
    expected: {
      changedFiles: ["src/roles.ts"],
      unchangedFiles: ["docs/roles.md"],
      maxChangedFiles: 1,
      mustUseTools: ["read", "edit"],
      fileContains: { "src/roles.ts": ["reader"] },
      fileNotContains: { "src/roles.ts": ["viewer"] },
    },
    validate: (t) =>
      t.toolCalls.indexOf("read") < t.toolCalls.indexOf("edit")
        ? []
        : ["expected read before edit"],
    maxSteps: 6,
  },
] satisfies AgentEvalCase[];
