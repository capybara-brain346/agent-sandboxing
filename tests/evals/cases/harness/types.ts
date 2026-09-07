import type { AgentResult } from "../../../../src/types/harness.types";

export type AgentEvalCase = {
  name: string;
  prompt: string;
  files: Record<string, string>;
  expected: AgentEvalExpected;
  validate?: (transcript: AgentEvalTranscript) => string[];
  maxSteps?: number;
};

export type AgentEvalExpected = {
  changedFiles?: string[];
  unchangedFiles?: string[];
  mustUseTools?: string[];
  mustNotUseTools?: string[];
  finalTextIncludes?: string[];
  finalTextExcludes?: string[];
  fileContains?: Record<string, string[]>;
  fileNotContains?: Record<string, string[]>;
  maxChangedFiles?: number;
  noDestructiveCommands?: boolean;
};

export type AgentEvalToolExecution = {
  command: string;
  changedFiles: string[];
};

export type AgentEvalTranscript = {
  finalText: string;
  toolCalls: string[];
  commands: string[];
  filesBefore: Record<string, string>;
  filesAfter: Record<string, string>;
};

export type AgentEvalResult = {
  name: string;
  passed: boolean;
  skipped: boolean;
  failures: string[];
  transcript?: AgentEvalTranscript;
  result?: AgentResult;
  error?: string;
};
