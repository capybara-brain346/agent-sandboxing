import { generateText, Output, type LanguageModel } from "ai";
import { z } from "zod";
import type { SessionChatMessage } from "../../types/harness.types";
import { getPromptText } from "../../prompts/load-prompt";
import type { TraceRecorderLike } from "../tracing/trace-recorder";
import { recordModelUsage } from "../tracing/model-usage";
import { logger } from "../../logger";

const compactedSummarySchema = z
  .object({
    objective: z.string(),
    state: z.string(),
    lastResult: z.string(),
    files: z.array(z.string()),
    blockers: z.array(z.string()),
  })
  .strict();
export type CompactionInput = {
  messageId?: string;
  previousSummary: string;
  recentMessages: SessionChatMessage[];
  recentToolActivity: string[];
  signal: AbortSignal;
};

export type SessionSummaryCompactor = {
  compact(input: CompactionInput): Promise<string>;
};

const SESSION_SUMMARY_COMPACTOR_SYSTEM_PROMPT = getPromptText(
  "session-summary-compactor",
);

const SUMMARY_BYTE_CAP = 4000;
const MAX_FILES = 15;
const MAX_BLOCKERS = 5;

export class ModelSessionSummaryCompactor implements SessionSummaryCompactor {
  constructor(
    private readonly model: LanguageModel,
    private readonly recorder?: TraceRecorderLike,
  ) {}

  async compact(input: CompactionInput): Promise<string> {
    const startedAt = Date.now();
    let result;
    try {
      result = await generateText({
        model: this.model,
        system: SESSION_SUMMARY_COMPACTOR_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: input.previousSummary
              ? `Previous summary:\n${input.previousSummary}`
              : "Previous summary: none yet.",
          },
          ...input.recentMessages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
          {
            role: "user",
            content: `Recent tool activity:\n${
              input.recentToolActivity.join("\n") || "none"
            }`,
          },
        ],
        abortSignal: input.signal,
        output: Output.object({ schema: compactedSummarySchema }),
      });
    } catch (error) {
      logger.debug("session_summary_compaction_failed", {
        messageId: input.messageId ?? null,
        durationMs: Date.now() - startedAt,
        outcome: input.signal.aborted ? "cancelled" : "failed",
      });
      recordModelUsage({
        recorder: this.recorder,
        messageId: input.messageId,
        stage: "summaryCompaction",
        model: this.model,
        startedAt,
        result: {},
      });
      throw error;
    }
    recordModelUsage({
      recorder: this.recorder,
      messageId: input.messageId,
      stage: "summaryCompaction",
      model: this.model,
      startedAt,
      result,
    });
    const files = [...new Set(result.output.files)].slice(-MAX_FILES);
    const blockers = result.output.blockers.slice(0, MAX_BLOCKERS);
    const lastResult = result.output.lastResult.trim();
    const lines = [
      `Objective: ${result.output.objective.trim()}`,
      `State: ${result.output.state.trim()}`,
      lastResult
        ? `LastResult: ${
            lastResult.length > 400
              ? `${lastResult.slice(0, 400).trimEnd()}…`
              : lastResult
          }`
        : null,
      `Files: ${files.length ? files.join(", ") : "none"}`,
      `Blockers: ${blockers.length ? blockers.join("; ") : "none"}`,
    ].filter((line): line is string => line !== null);
    let currentFiles = files;
    let summary = lines.join("\n");
    while (
      currentFiles.length > 0 &&
      Buffer.byteLength(summary, "utf8") > SUMMARY_BYTE_CAP
    ) {
      currentFiles = currentFiles.slice(1);
      lines[lines.length - 2] = `Files: ${
        currentFiles.length ? currentFiles.join(", ") : "none"
      }`;
      summary = lines.join("\n");
    }
    let truncated = false;
    while (
      Buffer.byteLength(summary, "utf8") >
      SUMMARY_BYTE_CAP - Buffer.byteLength("…", "utf8")
    ) {
      truncated = true;
      summary = summary.slice(0, -1);
    }
    if (truncated) {
      summary = `${summary.trimEnd()}…`;
    }
    logger.debug("session_summary_compaction_completed", {
      messageId: input.messageId ?? null,
      durationMs: Date.now() - startedAt,
      summaryBytes: Buffer.byteLength(summary),
      fileCount: currentFiles.length,
      blockerCount: blockers.length,
      truncated,
    });
    return summary;
  }
}
