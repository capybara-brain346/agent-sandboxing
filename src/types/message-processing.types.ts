import { z } from "zod";

export const MESSAGE_PROCESSING_STATUSES = [
  "queued",
  "working",
  "completed",
  "failed",
  "cancelled",
] as const;

export const messageProcessingStatusSchema = z.enum(
  MESSAGE_PROCESSING_STATUSES,
);
export type MessageProcessingStatus =
  (typeof MESSAGE_PROCESSING_STATUSES)[number];

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

export type MessageProcessingContext = {
  sessionId: string;
  messageId: string;
  sandboxId: string;
  instructions: string;
  signal: AbortSignal;
  maxSteps?: number;
};

export type MessageProcessingResult = {
  summary: string | null;
};

export type MessageProcessor = {
  process(context: MessageProcessingContext): Promise<MessageProcessingResult>;
};

export class PlaceholderMessageProcessor implements MessageProcessor {
  async process(
    _context: MessageProcessingContext,
  ): Promise<MessageProcessingResult> {
    return { summary: null };
  }
}
