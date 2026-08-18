import { generateText, Output, type LanguageModel } from "ai";
import { z } from "zod";
import {
  dedupe,
  MAX_BLOCKERS,
  MAX_FILES,
  parseSection,
  SUMMARY_BYTE_CAP,
  truncateBytes,
  truncateInline,
} from "./session-summary";
import type {
  OrchestratorChatMessage,
  WorkspaceSnapshot,
} from "../../types/harness.types";
import { getPromptText } from "../../prompts/load-prompt";

const compactedSummarySchema = z
  .object({
    objective: z.string(),
    state: z.string(),
    lastResult: z.string(),
    files: z.array(z.string()),
    blockers: z.array(z.string()),
  })
  .strict();
export type CompactedSummary = z.infer<typeof compactedSummarySchema>;

export type CompactionInput = {
  previousSummary: string;
  recentMessages: OrchestratorChatMessage[];
  recentToolActivity: string[];
  workspace: WorkspaceSnapshot;
};

export type SessionSummaryCompactor = {
  compact(input: CompactionInput): Promise<string>;
};

/**
 * Deterministic backstop applied after the model call: caps files/blockers/
 * lastResult and the whole document, never trusting the model to respect
 * those bounds on its own.
 */
export const formatAndCap = (summary: CompactedSummary): string => {
  const files = dedupe(summary.files).slice(-MAX_FILES);
  const blockers = summary.blockers.slice(0, MAX_BLOCKERS);
  const lastResult = truncateInline(summary.lastResult.trim(), 400);

  const lines = [
    `Objective: ${summary.objective.trim()}`,
    `State: ${summary.state.trim()}`,
    lastResult ? `LastResult: ${lastResult}` : null,
    `Files: ${files.length ? files.join(", ") : "none"}`,
    `Blockers: ${blockers.length ? blockers.join("; ") : "none"}`,
  ].filter((line): line is string => line !== null);

  let currentFiles = files;
  let text = lines.join("\n");
  while (
    currentFiles.length > 0 &&
    Buffer.byteLength(text, "utf8") > SUMMARY_BYTE_CAP
  ) {
    currentFiles = currentFiles.slice(1);
    lines[lines.length - 2] = `Files: ${
      currentFiles.length ? currentFiles.join(", ") : "none"
    }`;
    text = lines.join("\n");
  }

  return truncateBytes(text, SUMMARY_BYTE_CAP);
};

const SESSION_SUMMARY_COMPACTOR_SYSTEM_PROMPT = getPromptText(
  "session-summary-compactor",
);

export class ModelSessionSummaryCompactor implements SessionSummaryCompactor {
  constructor(private readonly model: LanguageModel) {}

  async compact(input: CompactionInput): Promise<string> {
    const result = await generateText({
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
      output: Output.object({ schema: compactedSummarySchema }),
    });
    return formatAndCap(result.output);
  }
}

/** Deterministic fallback compactor for test-mode: zero model calls. */
export class StaticSessionSummaryCompactor implements SessionSummaryCompactor {
  async compact(input: CompactionInput): Promise<string> {
    const objective =
      parseSection(input.previousSummary, "Objective") ??
      truncateInline((input.recentMessages[0]?.content ?? "").trim(), 200);
    const files = dedupe([
      ...(parseSection(input.previousSummary, "Files")
        ?.split(",")
        .map((file) => file.trim())
        .filter((file) => file && file !== "none") ?? []),
      ...input.workspace.changedFilesHint,
    ]);
    const blockers =
      input.workspace.lastRunStatus === "failed"
        ? ["last worker run failed"]
        : [];
    return Promise.resolve(
      formatAndCap({
        objective,
        state: "session summary compacted.",
        lastResult: input.workspace.lastRunSummary ?? "",
        files,
        blockers,
      }),
    );
  }
}
