import { z } from "zod";

export {
  EVENT_PRODUCER_SERVICES,
  EVENT_STREAM_SCOPES,
  EVENT_TYPES,
  LEGACY_EVENT_STREAM_SCOPE,
  eventProducerServiceSchema,
} from "./event.types";
export type {
  EventProducerService,
  EventStreamScope,
  EventType,
  PublicEvent,
  PublicEventV2,
} from "./event.types";

export const TASK_STATUSES = [
  "created",
  "provisioning",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;
export const taskStatusSchema = z.enum(TASK_STATUSES);
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_EXIT_REASONS = [
  "completed",
  "failed",
  "cancelled",
  "timed_out",
] as const;

export type TaskFailure = {
  code: string;
  message: string;
};
