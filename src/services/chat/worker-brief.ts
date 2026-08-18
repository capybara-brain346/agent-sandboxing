import type { OrchestratorContext } from "../../types/harness.types";

export type WorkerCorrection = {
  blockers: string[];
  suggestedNextStep: string;
};

/**
 * Builds the focused brief the CodeWorker receives. Deliberately excludes
 * chat history: only the durable session summary and a workspace hint are
 * carried over, plus the current delegation brief and any narrow correction.
 */
export const buildWorkerBrief = (
  context: Pick<OrchestratorContext, "repoRef" | "summary" | "workspace">,
  brief: string,
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
    `Brief: ${brief}`,
    correction
      ? `Correction needed. The previous attempt was blocked by: ${
          correction.blockers.join("; ") || "unspecified issues"
        }. Suggested next step: ${
          correction.suggestedNextStep || "re-attempt with a narrower scope"
        }.`
      : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
