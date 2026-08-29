export const WORKER_STATUSES = ["completed", "blocked", "failed"] as const;
export type WorkerStatus = (typeof WORKER_STATUSES)[number];

export type WorkerResult = {
  status: WorkerStatus;
  summary: string;
};

export type MessageIntent = "clarification" | "code";

export type WorkspaceSnapshot = {
  hasPriorProcessing: boolean;
  lastProcessingStatus: string | null;
  lastProcessingSummary: string | null;
  changedFilesHint: string[];
};

export type OrchestratorChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type OrchestratorContext = {
  sessionId: string;
  repoRef: string;
  summary: string;
  recentMessages: OrchestratorChatMessage[];
  recentToolActivity: string[];
  messageCount: number;
  shouldCompact: boolean;
  workspace: WorkspaceSnapshot;
};
