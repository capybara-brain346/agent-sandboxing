export type TaskRunContext = {
  taskId: string;
  sandboxId: string;
  instructions: string;
  signal: AbortSignal;
  sessionId?: string;
  messageId?: string;
};

export type TaskRunResult = {
  summary: string | null;
  /** Raw, unparsed worker report (e.g. the CodeWorker's structured JSON result) for artifact storage. */
  workerReport?: string | null;
};

export type TaskRunner = {
  run(context: TaskRunContext): Promise<TaskRunResult>;
};

export class PlaceholderTaskRunner implements TaskRunner {
  async run(_context: TaskRunContext): Promise<TaskRunResult> {
    return { summary: null };
  }
}
