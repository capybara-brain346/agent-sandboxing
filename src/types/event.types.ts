import { z } from "zod";

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

export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_STREAM_SCOPES = ["session"] as const;
export type EventStreamScope = (typeof EVENT_STREAM_SCOPES)[number];

export const EVENT_PRODUCER_SERVICES = [
  "chat",
  "sandbox",
  "command",
  "runtime",
  "cleanup",
  "agent",
  "github",
] as const;

export const eventProducerServiceSchema = z.enum(EVENT_PRODUCER_SERVICES);
export type EventProducerService = (typeof EVENT_PRODUCER_SERVICES)[number];

export type PublicEvent = {
  id: string;
  streamId: string;
  streamScope: EventStreamScope;
  domain: string;
  sessionId: string;
  sandboxId: string | null;
  commandId: string | null;
  messageId: string | null;
  artifactId: string | null;
  sequence: number;
  type: EventType;
  producerService: EventProducerService;
  producerId: string;
  correlationId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};
