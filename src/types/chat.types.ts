import { z } from "zod";
import {
  EVENT_TYPES,
  eventProducerServiceSchema,
  type PublicEvent,
} from "./event.types";
import {
  MESSAGE_EXIT_REASONS,
  MESSAGE_PROCESSING_STATUSES,
  messageProcessingStatusSchema,
  type MessageExitReason,
  type MessageProcessingFailure,
  type MessageProcessingStatus,
} from "./message-processing.types";
import type { ArtifactPointer } from "./artifact.types";
import type { PullRequestMetadata } from "./github.types";

export type { ArtifactPointer } from "./artifact.types";
export type {
  MessageExitReason,
  MessageProcessingFailure,
  MessageProcessingStatus,
} from "./message-processing.types";

export const CHAT_SESSION_STATUSES = ["active", "working"] as const;
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
    baseBranch: z.string().trim().min(1).nullable().optional(),
    baseSha: z.string().trim().min(1).nullable().optional(),
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
  baseBranch: string | null;
  baseSha: string | null;
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
  | { messageId: string; status: "cancelling"; eventsUrl: string }
  | { messageId: string; status: "cancelled" };

export type ChatSession = {
  chatSessionId: string;
  title: string | null;
  repo: RepoScope;
  status: ChatSessionStatus;
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

export type CreateSessionResponse = ChatSession;

export type CreateMessageResponse = {
  message: ChatMessage;
  sessionUrl: string;
  messagesUrl: string;
  eventsUrl: string;
};

export type PublicChatEvent = PublicEvent & {
  streamScope: "session";
  domain: string;
  sessionId: string;
  messageId: string | null;
  artifactId: string | null;
};

export const publicChatEventSchema = z
  .object({
    id: z.string(),
    streamId: z.string(),
    streamScope: z.literal("session"),
    domain: z.string(),
    sessionId: z.string(),
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

export const messageProcessingStatusSchemaForApi =
  messageProcessingStatusSchema;
export const messageProcessingStatuses = MESSAGE_PROCESSING_STATUSES;
export const messageExitReasons = MESSAGE_EXIT_REASONS;
