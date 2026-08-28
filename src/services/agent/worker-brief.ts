import type { OrchestratorContext } from "../../types/harness.types";

export const buildWorkerBrief = (
  context: Pick<OrchestratorContext, "summary" | "workspace">,
  brief: string,
  correction?: string,
): string =>
  [
    "Inspect and edit files under /workspace/repo to satisfy the brief below.",
    "Work only within that scope, run narrow checks where useful, and fix obvious failures within your attempt budget.",
    "If the brief explicitly asks for a pull request, use publish_pull_request after the requested workspace change; do not give manual git or gh instructions.",
    "After any publish_pull_request call, report the observed outcome: published at the returned URL, not published because there was no workspace diff, or failed with the returned code and message. Never say a pull request was raised, opened, created, or published unless the tool returned success with a pull request URL.",
    "",
    context.summary ? `Prior context:\n${context.summary}` : null,
    context.workspace.hasPriorRun
      ? `Previous attempt: ${context.workspace.lastRunStatus}. Previously touched files: ${
          context.workspace.changedFilesHint.join(", ") || "none"
        }.`
      : null,
    "",
    `Brief: ${brief}`,
    correction
      ? `Correction needed. Previous attempt report: ${correction}`
      : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
