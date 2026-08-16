import { z } from "zod";
import {
  EVENT_TYPES,
  eventProducerServiceSchema,
  type PublicEvent,
} from "./event.types";

export {
  EVENT_PRODUCER_SERVICES,
  EVENT_TYPES,
  eventProducerServiceSchema,
} from "./event.types";
export type {
  EventProducerService,
  EventType,
  PublicEvent,
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
export const taskExitReasonSchema = z.enum(TASK_EXIT_REASONS);
export type TaskExitReason = (typeof TASK_EXIT_REASONS)[number];

export const createTaskSchema = z
  .object({
    repoRef: z.string().trim().min(1),
    instructions: z.string().trim().min(1),
    image: z.string().trim().min(1).optional(),
  })
  .strict();
export type CreateTaskRequest = z.infer<typeof createTaskSchema>;

export const taskFailureSchema = z
  .object({
    code: z.string(),
    message: z.string(),
  })
  .strict();

export type CreateTaskResponse = {
  taskId: string;
  status: TaskStatus;
  eventsUrl: string;
};
export type TaskFailure = {
  code: string;
  message: string;
};

export const createTaskResponseSchema = z
  .object({
    taskId: z.string(),
    status: taskStatusSchema,
    eventsUrl: z.string(),
  })
  .strict();

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

export const taskSnapshotSchema = z
  .object({
    taskId: z.string(),
    status: taskStatusSchema,
    repoRef: z.string(),
    instructions: z.string(),
    eventsUrl: z.string(),
    resultUrl: z.string(),
    createdAt: z.string(),
    provisioningAt: z.string().nullable(),
    runningAt: z.string().nullable(),
    completedAt: z.string().nullable(),
    failure: taskFailureSchema.nullable(),
  })
  .strict();

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

export const taskResultSchema = z
  .object({
    taskId: z.string(),
    status: z.enum(["completed", "failed", "cancelled"]),
    diff: z.string(),
    agentSummary: z.string().nullable(),
    exitReason: taskExitReasonSchema,
    failure: taskFailureSchema.nullable(),
    createdAt: z.string(),
    completedAt: z.string(),
  })
  .strict();

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

export const taskCancellationResponseSchema = z.union([
  z
    .object({
      taskId: z.string(),
      status: z.literal("cancelling"),
      eventsUrl: z.string(),
    })
    .strict(),
  z
    .object({
      taskId: z.string(),
      status: z.literal("cancelled"),
    })
    .strict(),
]);

export type PublicTaskEvent = PublicEvent;

export const publicTaskEventSchema = z
  .object({
    id: z.string(),
    streamId: z.string(),
    taskId: z.string(),
    sandboxId: z.string().nullable(),
    commandId: z.string().nullable(),
    sequence: z.number().int().nonnegative(),
    type: z.enum(EVENT_TYPES),
    producerService: eventProducerServiceSchema,
    producerId: z.string(),
    correlationId: z.string().nullable(),
    payload: z.record(z.string(), z.unknown()),
    createdAt: z.string(),
  })
  .strict();

export type TaskServicePort = {
  create(input: CreateTaskRequest): Promise<CreateTaskResponse>;
  get(taskId: string): Promise<TaskSnapshot>;
  eventsAfter(taskId: string, after: number): Promise<PublicTaskEvent[]>;
  result(taskId: string): Promise<TaskResult>;
  cancel(taskId: string): Promise<TaskCancellationResponse>;
};
