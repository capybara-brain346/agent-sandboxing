import {
  workerResultSchema,
  type WorkerResult,
} from "../../types/harness.types";
import type { TaskRunContext, TaskRunner } from "../task/task-runner";

const JSON_FENCE = /```json\s*([\s\S]*?)```/g;

const tryParse = (candidate: string): WorkerResult | null => {
  try {
    const parsed: unknown = JSON.parse(candidate);
    const result = workerResultSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
};

/**
 * Best-effort structured extraction of the worker's free text into a
 * schema-validated WorkerResult. A worker that skips the JSON fence still
 * produces a usable "completed" result from its free text rather than
 * failing the run outright — only a worker that explicitly reports
 * blocked/failed status via valid JSON changes the run outcome.
 */
export const parseWorkerResult = (text: string): WorkerResult => {
  const trimmed = text.trim();
  const fallback: WorkerResult = {
    status: "completed",
    summary: trimmed,
    changedFiles: [],
    testsRun: [],
    blockers: [],
    suggestedNextStep: "",
  };
  if (!trimmed) return fallback;

  const fenced = [...trimmed.matchAll(JSON_FENCE)].at(-1)?.[1]?.trim();
  const candidates = fenced
    ? [fenced]
    : trimmed.startsWith("{")
      ? [trimmed]
      : [];

  for (const candidate of candidates) {
    const parsed = tryParse(candidate);
    if (parsed) return parsed;
  }
  return fallback;
};

/**
 * Wraps a TaskRunner (the agent tool loop) so its free-text result is
 * parsed into a schema-validated WorkerResult for the orchestrator.
 */
export class CodeWorkerRunner {
  constructor(private readonly runner: TaskRunner) {}

  async run(context: TaskRunContext): Promise<WorkerResult> {
    const result = await this.runner.run(context);
    return parseWorkerResult(result.summary ?? "");
  }
}
