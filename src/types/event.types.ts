import { z } from "zod";

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

export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_STREAM_SCOPES = ["session", "run"] as const;
export const LEGACY_EVENT_STREAM_SCOPE = "task" as const;
export type EventStreamScope =
  (typeof EVENT_STREAM_SCOPES)[number] | typeof LEGACY_EVENT_STREAM_SCOPE;

export const EVENT_PRODUCER_SERVICES = [
  "task",
  "sandbox",
  "command",
  "runtime",
  "cleanup",
  "agent",
] as const;

export const eventProducerServiceSchema = z.enum(EVENT_PRODUCER_SERVICES);
export type EventProducerService = (typeof EVENT_PRODUCER_SERVICES)[number];

export type PublicEvent = {
  id: string;
  streamId: string;
  streamScope?: EventStreamScope;
  domain?: string;
  sessionId?: string | null;
  runId?: string | null;
  taskId: string | null;
  sandboxId: string | null;
  commandId: string | null;
  messageId?: string | null;
  artifactId?: string | null;
  sequence: number;
  type: EventType;
  producerService: EventProducerService;
  producerId: string;
  correlationId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type PublicEventV2 = PublicEvent & {
  streamScope: (typeof EVENT_STREAM_SCOPES)[number];
  domain: string;
  sessionId: string;
  runId: string | null;
  messageId: string | null;
  artifactId: string | null;
};
