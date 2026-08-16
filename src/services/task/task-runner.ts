export type TaskRunContext = {
  taskId: string;
  sandboxId: string;
  instructions: string;
  signal: AbortSignal;
};

export type TaskRunResult = {
  summary: string | null;
};

export type TaskRunner = {
  run(context: TaskRunContext): Promise<TaskRunResult>;
};

/**
 * The phase 6 runner seam. It intentionally performs no agent work; the
 * Agent Service can replace this collaborator without changing task
 * orchestration or result capture.
 */
export class PlaceholderTaskRunner implements TaskRunner {
  async run(_context: TaskRunContext): Promise<TaskRunResult> {
    return { summary: null };
  }
}
