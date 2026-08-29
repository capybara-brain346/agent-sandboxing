export const MESSAGE_PROCESSING_STATUSES = [
  "queued",
  "working",
  "completed",
  "failed",
  "cancelled",
] as const;
export type MessageProcessingStatus =
  (typeof MESSAGE_PROCESSING_STATUSES)[number];

export const TERMINAL_STATUSES = new Set<MessageProcessingStatus>([
  "completed",
  "failed",
  "cancelled",
]);

export const MESSAGE_EXIT_REASONS = [
  "completed",
  "failed",
  "cancelled",
  "timed_out",
] as const;
export type MessageExitReason = (typeof MESSAGE_EXIT_REASONS)[number];

export type MessageProcessingFailure = {
  code: string;
  message: string;
};

export const PULL_REQUEST_STATUSES = [
  "creating",
  "open",
  "closed",
  "merged",
  "failed",
] as const;
export type PullRequestStatus = (typeof PULL_REQUEST_STATUSES)[number];

export type PullRequestMetadata = {
  provider: "github";
  url: string | null;
  number: number | null;
  branch: string;
  baseBranch: string;
  title: string;
  status: PullRequestStatus;
  draft: boolean;
  failure: MessageProcessingFailure | null;
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
  messageId: string | null;
  content: string;
  createdAt: string;
};

export type ChatMessageRole = "user" | "assistant" | "system";

export type ChatMessage = {
  messageId: string;
  chatSessionId: string;
  role: ChatMessageRole;
  content: string;
  processingStatus: MessageProcessingStatus | null;
  processingStartedAt: string | null;
  processingCompletedAt: string | null;
  failure: MessageProcessingFailure | null;
  agentSummary: string | null;
  createdAt: string;
};

export type SessionResult = {
  messageId: string;
  chatSessionId: string;
  status: Extract<
    MessageProcessingStatus,
    "completed" | "failed" | "cancelled"
  >;
  diff: string;
  artifacts: ArtifactPointer[];
  agentSummary: string | null;
  exitReason: MessageExitReason;
  failure: MessageProcessingFailure | null;
  pullRequest: PullRequestMetadata | null;
  createdAt: string;
  completedAt: string;
};

export type MessageCancellationResponse =
  | {
      messageId: string;
      status: "cancelling";
      eventsUrl: string;
    }
  | {
      messageId: string;
      status: "cancelled";
    };

export type ChatSession = {
  chatSessionId: string;
  title: string | null;
  repo: RepoScope;
  status: "active" | "working";
  activeMessageId: string | null;
  sandboxId: string | null;
  eventsUrl: string;
  messagesUrl: string;
  createdAt: string;
  updatedAt: string;
};

export type ChatSessionListItem = ChatSession & {
  latestMessageStatus: MessageProcessingStatus | null;
  lastMessagePreview: string | null;
};

export type Page<T> = {
  items: T[];
  nextCursor: string | null;
};

export type CreateMessageResponse = {
  message: ChatMessage;
  sessionUrl: string;
  messagesUrl: string;
  eventsUrl: string;
};

export type PublicChatEvent = {
  id: string;
  streamId: string;
  streamScope: "session";
  domain: string;
  sessionId: string;
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
  "message_processing_requested",
  "message_processing_started",
  "message_processing_completed",
  "message_processing_failed",
  "message_processing_cancelled",
  "message_result_ready",
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
  "pull_request_creation_started",
  "pull_request_branch_pushed",
  "pull_request_created",
  "pull_request_updated",
  "pull_request_closed",
  "pull_request_reopened",
  "pull_request_commented",
  "pull_request_failed",
  "artifact_created",
  "git_diff_requested",
  "git_diff_completed",
  "cleanup_started",
  "cleanup_completed",
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
