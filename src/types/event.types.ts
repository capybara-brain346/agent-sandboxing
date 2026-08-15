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

const legacyActorFor = (event: PublicEvent): SandboxEventActor => {
  if (event.producerService === "cleanup") return "cleanup";
  if (event.producerService === "runtime") return "runtime";
  if (event.producerService === "command")
    return event.type === "command_started" ? "api" : "runtime";
  if (event.producerService === "sandbox")
    return event.type === "sandbox_created" ||
      event.type === "sandbox_stopping" ||
      event.type === "git_diff_requested"
      ? "api"
      : "provisioner";
  return "api";
};

/** Convert a task-stream event to the legacy sandbox SSE shape when relevant. */
export const toLegacySandboxEvent = (
  event: StreamEvent,
  sandboxId: string,
): LegacyPublicEvent | undefined => {
  if ("actor" in event)
    return event.sandboxId === sandboxId ? event : undefined;
  if (event.sandboxId !== sandboxId) return undefined;

  return {
    id: event.id,
    sandboxId,
    commandId: event.commandId,
    sequence: event.sequence,
    type: event.type,
    actor: legacyActorFor(event),
    correlationId: event.correlationId,
    payload: event.payload,
    createdAt: event.createdAt,
  };
};
