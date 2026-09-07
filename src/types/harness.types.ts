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

export type SessionChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type SessionContext = {
  sessionId: string;
  repoRef: string;
  summary: string;
  recentMessages: SessionChatMessage[];
  recentToolActivity: string[];
  messageCount: number;
  shouldCompact: boolean;
  workspace: WorkspaceSnapshot;
};
