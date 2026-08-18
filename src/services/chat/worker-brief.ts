import type { OrchestratorContext } from "../../types/harness.types";

export type WorkerCorrection = {
  blockers: string[];
  suggestedNextStep: string;
};

const WORKER_RESULT_SHAPE =
  '{"status":"completed|blocked|failed","summary":"...","changedFiles":["..."],' +
  '"testsRun":[{"command":"...","status":"passed|failed","outputSummary":"..."}],' +
  '"blockers":["..."],"suggestedNextStep":"..."}';

/**
 * Builds the focused brief the CodeWorker receives. Deliberately excludes
 * chat history: only the durable session summary and a workspace hint are
 * carried over, plus the current instruction and any narrow correction.
 */
export const buildWorkerBrief = (
  context: OrchestratorContext,
  userMessage: string,
  correction?: WorkerCorrection,
): string =>
  [
    "You are the CodeWorker. Inspect and edit files under /workspace/repo to satisfy the brief below.",
    "Work only within that scope, run narrow checks where useful, and fix obvious failures within your attempt budget.",
    "",
    `Repository: ${context.repoRef}`,
    context.summary ? `Session summary:\n${context.summary}` : null,
    context.workspace.hasPriorRun
      ? `Last run status: ${context.workspace.lastRunStatus}. Previously touched files: ${
          context.workspace.changedFilesHint.join(", ") || "none"
        }.`
      : null,
    "",
    `Brief: ${userMessage}`,
    correction
      ? `Correction needed. The previous attempt was blocked by: ${
          correction.blockers.join("; ") || "unspecified issues"
        }. Suggested next step: ${
          correction.suggestedNextStep || "re-attempt with a narrower scope"
        }.`
      : null,
    "",
    "When finished, end your reply with a fenced json code block matching exactly this shape:",
    "```json",
    WORKER_RESULT_SHAPE,
    "```",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
