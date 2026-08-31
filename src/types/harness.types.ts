export const SESSION_AGENT_STATUSES = [
  "completed",
  "blocked",
  "failed",
] as const;
export type SessionAgentStatus = (typeof SESSION_AGENT_STATUSES)[number];

export type SessionAgentResult = {
  status: SessionAgentStatus;
  summary: string;
};

export type AgentResult = {
  finalText: string;
  usage: unknown;
  toolCalls: unknown[];
  startedAt: string;
  completedAt: string;
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
