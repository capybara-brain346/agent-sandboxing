import type { OrchestratorContext } from "../../types/harness.types";

export const buildWorkerBrief = (
  context: Pick<OrchestratorContext, "summary" | "workspace">,
  brief: string,
  correction?: string,
): string =>
  [
    "You are the CodeWorker. Inspect and edit files under /workspace/repo to satisfy the brief below.",
    "Work only within that scope, run narrow checks where useful, and fix obvious failures within your attempt budget.",
    "If the brief explicitly asks for a pull request, use publish_pull_request after the requested workspace change; do not give manual git or gh instructions.",
    "",
    context.summary ? `Session summary:\n${context.summary}` : null,
    context.workspace.hasPriorRun
      ? `Last run status: ${context.workspace.lastRunStatus}. Previously touched files: ${
          context.workspace.changedFilesHint.join(", ") || "none"
        }.`
      : null,
    "",
    `Brief: ${brief}`,
    correction
      ? `Correction needed. Previous worker report: ${correction}`
      : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
