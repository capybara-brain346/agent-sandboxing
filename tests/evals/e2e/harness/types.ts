import type {
  ChatMessage,
  ChatSession,
  SessionResult,
} from "../../../../src/types/chat.types";
import type { PublicEvent } from "../../../../src/types/event.types";

export type EvalLevel = 1 | 2 | 3 | 4;
export type EvalClassification =
  "correct" | "incorrect" | "harness_failure" | "preflight_failure";

export type EvalSeed = (root: string) => Promise<void>;

export type EvalGraderCommand = {
  name: string;
  command: string;
};

export type CapyNodesEvalCase = {
  id: string;
  level: EvalLevel;
  title: string;
  prompt: string;
  seed: EvalSeed;
  oracleDirectory: string;
  grading: EvalGraderCommand[];
  protectedPaths: string[];
  requiredPaths: string[];
  image?: string;
  timeoutMs?: number;
};

export type FixtureSnapshot = Record<string, string>;

export type TaskFixture = {
  attemptId: string;
  taskRoot: string;
  sourceRoot: string;
  containerRepoRef: string;
  baselineDigest: string;
  seededDigest: string;
  baselineSha: string;
  seededFiles: FixtureSnapshot;
};

export type SseEvidence = {
  status: number;
  contentType: string;
  events: PublicEvent[];
};

export type ChatEvidence = {
  session: ChatSession;
  message: ChatMessage;
  messages: ChatMessage[];
  result: SessionResult;
  sse: SseEvidence;
  durationMs: number;
};

export type GraderResult = {
  name: string;
  command: string;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
};

export type SandboxEvidence = {
  sandboxId: string;
  containerId: string;
  containerName: string;
  checkoutRoot: string;
  grader: GraderResult[];
};

export type Assertion = {
  name: string;
  passed: boolean;
  detail?: string | undefined;
};

export type AttemptEvidence = {
  chat?: ChatEvidence;
  sandbox?: SandboxEvidence;
  changedFiles: string[];
  diffBytes: number;
  sourceIntegrity: {
    baselineUnchanged: boolean;
    seededSourceUnchanged: boolean;
  };
};

export type EvalAttempt = {
  attemptId: string;
  caseId: string;
  level: EvalLevel;
  title: string;
  classification: EvalClassification;
  passed: boolean;
  durationMs: number;
  changedFiles: string[];
  assertions: Assertion[];
  evidence: AttemptEvidence;
  failure?: string | undefined;
  recordedAt: string;
};

export type OracleSmokeResult = {
  caseId: string;
  knownGoodPassed: boolean;
  knownBadFailed: boolean;
  details: string[];
};
