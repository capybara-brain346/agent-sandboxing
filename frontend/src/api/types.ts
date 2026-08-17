// Hand-ported from src/types/task.types.ts and src/types/event.types.ts.
// Keep field names identical to the backend contract; do not add fields the
// backend does not send.

export const TASK_STATUSES = [
  "created",
  "provisioning",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_EXIT_REASONS = [
  "completed",
  "failed",
  "cancelled",
  "timed_out",
] as const;
export type TaskExitReason = (typeof TASK_EXIT_REASONS)[number];

export type CreateTaskRequest = {
  repoRef: string;
  instructions: string;
  image?: string;
};

export type TaskFailure = {
  code: string;
  message: string;
};

export type CreateTaskResponse = {
  taskId: string;
  status: TaskStatus;
  eventsUrl: string;
};

export type TaskSnapshot = {
  taskId: string;
  status: TaskStatus;
  repoRef: string;
  instructions: string;
  eventsUrl: string;
  resultUrl: string;
  createdAt: string;
  provisioningAt: string | null;
  runningAt: string | null;
  completedAt: string | null;
  failure: TaskFailure | null;
};

export type TaskResult = {
  taskId: string;
  status: Extract<TaskStatus, "completed" | "failed" | "cancelled">;
  diff: string;
  agentSummary: string | null;
  exitReason: TaskExitReason;
  failure: TaskFailure | null;
  createdAt: string;
  completedAt: string;
};

export type TaskCancellationResponse =
  | {
      taskId: string;
      status: "cancelling";
      eventsUrl: string;
    }
  | {
      taskId: string;
      status: "cancelled";
    };

export type PublicTaskEvent = {
  id: string;
  streamId: string;
  taskId: string;
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

// Mirrors EVENT_TYPES in src/types/event.types.ts. SSE frames use `event:
// <type>` so the client needs each name to attach a listener.
export const EVENT_TYPES = [
  "task_created",
  "task_provisioning_started",
  "task_running",
  "task_completed",
  "task_failed",
  "task_cancelled",
  "task_result_ready",
  "sandbox_created",
  "sandbox_provisioning_started",
  "sandbox_ready",
  "sandbox_failed",
  "sandbox_stopping",
  "sandbox_stopped",
  "fixture_repo_copy_started",
  "fixture_repo_copied",
  "command_started",
  "command_output",
  "command_completed",
  "command_failed",
  "command_timed_out",
  "command_cancelled",
  "git_diff_requested",
  "git_diff_completed",
  "agent_tool_call",
  "agent_tool_result",
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
