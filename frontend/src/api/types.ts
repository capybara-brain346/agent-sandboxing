export const TASK_STATUSES = [
  "created",
  "provisioning",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TERMINAL_STATUSES = new Set<TaskStatus>([
  "completed",
  "failed",
  "cancelled",
]);

export const TASK_EXIT_REASONS = [
  "completed",
  "failed",
  "cancelled",
  "timed_out",
] as const;
export type TaskExitReason = (typeof TASK_EXIT_REASONS)[number];

export type TaskFailure = {
  code: string;
  message: string;
};

export const REPO_SOURCES = ["fixture", "github"] as const;
export type RepoSource = (typeof REPO_SOURCES)[number];

export type RepoScope = {
  source: RepoSource;
  ref: string;
  provider: string | null;
  owner: string | null;
  name: string | null;
  repoId: string | null;
  defaultBranch: string | null;
  installationId: string | null;
  baseBranch: string | null;
  baseSha: string | null;
};

export type CreateChatSessionRequest = {
  repo: {
    source: RepoSource;
    ref: string;
    provider?: string;
    owner?: string;
    name?: string;
    repoId?: string;
    defaultBranch?: string;
    installationId?: string;
    baseBranch?: string;
    baseSha?: string;
  };
  title?: string;
  image?: string;
};

export type UpdateChatSessionRequest = {
  title: string;
};

export type CreateMessageRequest = {
  content: string;
  startRun?: boolean;
};

export type ArtifactPointer = {
  artifactId: string;
  kind: string;
  contentType: string;
  byteSize: number;
  truncated: boolean;
  redacted: boolean;
};

export type ArtifactContent = ArtifactPointer & {
  sessionId: string;
  runId: string | null;
  content: string;
  createdAt: string;
};

export type ChatMessageRole = "user" | "assistant" | "system";

export type ChatMessage = {
  messageId: string;
  chatSessionId: string;
  role: ChatMessageRole;
  content: string;
  taskRunId: string | null;
  createdAt: string;
};

export type RunSnapshot = {
  taskRunId: string;
  chatSessionId: string;
  triggerMessageId: string | null;
  status: TaskStatus;
  sandboxId: string | null;
  resultUrl: string;
  eventsUrl: string;
  createdAt: string;
  provisioningAt: string | null;
  runningAt: string | null;
  completedAt: string | null;
  failure: TaskFailure | null;
};

export type RunResult = {
  taskRunId: string;
  chatSessionId: string;
  status: Extract<TaskStatus, "completed" | "failed" | "cancelled">;
  diff: string;
  artifacts: ArtifactPointer[];
  assistantMessageId: string | null;
  agentSummary: string | null;
  exitReason: TaskExitReason;
  failure: TaskFailure | null;
  createdAt: string;
  completedAt: string;
};

export type RunCancellationResponse =
  | {
      taskRunId: string;
      status: "cancelling";
      eventsUrl: string;
    }
  | {
      taskRunId: string;
      status: "cancelled";
    };

export type ChatSession = {
  chatSessionId: string;
  title: string | null;
  repo: RepoScope;
  status: "active";
  sandboxId: string | null;
  eventsUrl: string;
  messagesUrl: string;
  latestRun: RunSnapshot | null;
  createdAt: string;
  updatedAt: string;
};

export type ChatSessionListItem = ChatSession & {
  latestRunStatus: TaskStatus | null;
  lastMessagePreview: string | null;
};

export type Page<T> = {
  items: T[];
  nextCursor: string | null;
};

export type CreateMessageResponse = {
  message: ChatMessage;
  run: RunSnapshot | null;
  eventsUrl: string;
};

export type PublicChatEvent = {
  id: string;
  streamId: string;
  streamScope: "session" | "run";
  domain: string;
  sessionId: string;
  runId: string | null;
  taskId: string | null;
  messageId: string | null;
  artifactId: string | null;
  sandboxId: string | null;
  commandId: string | null;
  sequence: number;
  type: string;
  producerService: string;
  producerId: string;
  correlationId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};

export const EVENT_TYPES = [
  "session_created",
  "message_created",
  "run_requested",
  "run_created",
  "run_completed",
  "run_failed",
  "run_cancelled",
  "run_result_ready",
  "sandbox_created",
  "sandbox_provisioning_started",
  "repo_clone_started",
  "repo_clone_completed",
  "repo_checkout_completed",
  "fixture_repo_copy_started",
  "fixture_repo_copied",
  "sandbox_ready",
  "sandbox_failed",
  "sandbox_stopping",
  "sandbox_stopped",
  "command_started",
  "command_output",
  "command_completed",
  "command_failed",
  "command_timed_out",
  "command_cancelled",
  "agent_tool_call",
  "agent_tool_result",
  "artifact_created",
  "git_diff_requested",
  "git_diff_completed",
  "cleanup_started",
  "cleanup_completed",
  "task_created",
  "task_provisioning_started",
  "task_running",
  "task_completed",
  "task_failed",
  "task_cancelled",
  "task_result_ready",
] as const;

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export type AuthMe = {
  sub: string;
  login: string;
  avatarUrl: string;
  email: string | null;
  iat: number;
  exp: number;
};

export type GitHubInstallation = {
  installationId: string;
  accountLogin: string;
  accountType: "user";
};

export type GitHubBranch = {
  name: string;
  sha: string;
  protected: boolean;
};

export type GitHubRepository = {
  repoId: string;
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  installationId: string;
  branches: GitHubBranch[];
};

export type GitHubRepositoriesResponse = {
  installations: GitHubInstallation[];
  repositories: GitHubRepository[];
  installUrl: string;
};
