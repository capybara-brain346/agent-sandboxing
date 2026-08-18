import { z } from "zod";
import {
  EVENT_TYPES,
  eventProducerServiceSchema,
  type PublicEvent,
} from "./event.types";
import {
  TASK_EXIT_REASONS,
  TASK_STATUSES,
  type TaskFailure,
  type TaskStatus,
} from "./task.types";

export const CHAT_SESSION_STATUSES = ["active"] as const;
export type ChatSessionStatus = (typeof CHAT_SESSION_STATUSES)[number];

export const repoSourceSchema = z.enum(["fixture", "github"]);
export type RepoSource = z.infer<typeof repoSourceSchema>;

export const repoScopeSchema = z
  .object({
    source: repoSourceSchema,
    ref: z.string().trim().min(1),
    provider: z.string().trim().min(1).nullable().optional(),
    owner: z.string().trim().min(1).nullable().optional(),
    name: z.string().trim().min(1).nullable().optional(),
    repoId: z.string().trim().min(1).nullable().optional(),
    defaultBranch: z.string().trim().min(1).nullable().optional(),
    installationId: z.string().trim().min(1).nullable().optional(),
  })
  .strict();
export type RepoScope = {
  source: RepoSource;
  ref: string;
  provider: string | null;
  owner: string | null;
  name: string | null;
  repoId: string | null;
  defaultBranch: string | null;
  installationId: string | null;
};

export const createChatSessionSchema = z
  .object({
    repo: repoScopeSchema,
    title: z.string().trim().min(1).max(200).optional(),
    image: z.string().trim().min(1).optional(),
  })
  .strict();
export type CreateChatSessionRequest = z.output<typeof createChatSessionSchema>;

export const updateChatSessionSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
  })
  .strict();
export type UpdateChatSessionRequest = z.output<typeof updateChatSessionSchema>;

export const createMessageSchema = z
  .object({
    content: z.string().trim().min(1).max(32_000),
    startRun: z.boolean().default(true),
  })
  .strict();
export type CreateMessageRequest = z.output<typeof createMessageSchema>;

export const pageQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().trim().min(1).optional(),
  })
  .strict();

export const listSessionQuerySchema = pageQuerySchema.extend({
  repoSource: repoSourceSchema.optional(),
  repoRef: z.string().trim().min(1).optional(),
});

export const messagePageQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    before: z.string().trim().min(1).optional(),
  })
  .strict();

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
  exitReason: (typeof TASK_EXIT_REASONS)[number];
  failure: TaskFailure | null;
  createdAt: string;
  completedAt: string;
};

export type ArtifactPointer = {
  artifactId: string;
  kind: string;
  contentType: string;
  byteSize: number;
  truncated: boolean;
  redacted: boolean;
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

export type CreateSessionResponse = ChatSession;

export type CreateMessageResponse = {
  message: ChatMessage;
  run: RunSnapshot | null;
  eventsUrl: string;
};

export type PublicChatEvent = PublicEvent & {
  streamScope: "session" | "run";
  domain: string;
  sessionId: string;
  runId: string | null;
  messageId: string | null;
  artifactId: string | null;
};

export const publicChatEventSchema = z
  .object({
    id: z.string(),
    streamId: z.string(),
    streamScope: z.enum(["session", "run"]),
    domain: z.string(),
    sessionId: z.string(),
    runId: z.string().nullable(),
    taskId: z.string().nullable(),
    messageId: z.string().nullable(),
    artifactId: z.string().nullable(),
    sandboxId: z.string().nullable(),
    commandId: z.string().nullable(),
    sequence: z.number().int().positive(),
    type: z.enum(EVENT_TYPES),
    producerService: eventProducerServiceSchema,
    producerId: z.string(),
    correlationId: z.string().nullable(),
    payload: z.record(z.string(), z.unknown()),
    createdAt: z.string(),
  })
  .strict();

export const taskRunStatusSchema = z.enum(TASK_STATUSES);
