import type {
  ChatMessage,
  ChatSession,
  SessionResult,
} from "../../src/types/chat.types";
import type { PublicEvent } from "../../src/types/event.types";

export type SweBenchTask = {
  instance_id: string;
  repo: string;
  base_commit: string;
  problem_statement: string;
  split: "dev";
  dataset_name: string;
  dataset_revision: string;
  dataset_task_count: number;
  task_count: number;
  image?: string;
};

export type TaskManifest = {
  path: string;
  datasetName: string;
  datasetRevision: string;
  split: "dev";
  datasetTaskCount: number;
  taskCount: number;
  tasks: SweBenchTask[];
};

export type TaskFixture = {
  attemptId: string;
  fixtureRoot: string;
  taskRoot: string;
  sourceRoot: string;
  containerRepoRef: string;
  baseCommit: string;
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

export type Prediction = {
  instance_id: string;
  model_name_or_path: string;
  model_patch: string;
};

export type AttemptFailureCategory = "setup" | "provider" | "session";

export type AttemptRecord = {
  attemptId: string;
  instanceId: string;
  status: "completed" | "failed" | "no_patch";
  sessionId?: string;
  sandboxId?: string;
  predictionPath?: string;
  model?: string;
  promptProfile?: string;
  durationMs?: number;
  classification?: string;
  failureCategory?: AttemptFailureCategory;
  diffBytes: number;
  failure?: string;
  startedAt: string;
  completedAt: string;
};

export type ExperimentManifest = {
  experimentId: string;
  repositorySha: string;
  evaluatorVersion: string;
  datasetName: string;
  datasetRevision: string;
  split: string;
  taskIds: string[];
  model: string;
  promptProfile: string;
  maxSteps: number;
  timeoutMs: number;
  wrapperImages: Record<string, string>;
  officialRunId?: string;
  createdAt: string;
};

export type OfficialRunRecord = {
  runId: string;
  predictionPath: string;
  predictionSha256: string;
  classifications?: Record<string, string>;
  recordedAt: string;
};

export type CohortSummary = {
  taskCount: number;
  attemptCount: number;
  predictionCount: number;
  submittedCount: number;
  noPatchCount: number;
  setupFailureCount: number;
  providerFailureCount: number;
  sessionFailureCount: number;
  recordedAt: string;
};
