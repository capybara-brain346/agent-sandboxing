import type { SandboxEventActor } from "@prisma/client";
import { z } from "zod";

export const EVENT_TYPES = [
  "sandbox_created",
  "sandbox_provisioning_started",
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

export const EVENT_PRODUCER_SERVICES = [
  "task",
  "sandbox",
  "command",
  "runtime",
  "cleanup",
] as const;

export const eventProducerServiceSchema = z.enum(EVENT_PRODUCER_SERVICES);
export type EventProducerService = (typeof EVENT_PRODUCER_SERVICES)[number];

/** The durable, product-facing representation of an event. */
export type PublicEvent = {
  id: string;
  streamId: string;
  taskId: string | null;
  sandboxId: string | null;
  commandId: string | null;
  sequence: number;
  type: EventType;
  producerService: EventProducerService;
  producerId: string;
  correlationId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};

/**
 * Shape used by the pre-task sandbox service while the old HTTP surface is
 * retired. It is accepted by the fanout hub so existing internal producers
 * can be migrated without changing the delivery mechanism.
 */
export type LegacyPublicEvent = {
  id: string;
  sandboxId: string;
  commandId: string | null;
  sequence: number;
  type: EventType;
  actor: SandboxEventActor;
  correlationId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type StreamEvent = PublicEvent | LegacyPublicEvent;
