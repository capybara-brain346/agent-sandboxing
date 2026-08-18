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

export class PlaceholderTaskRunner implements TaskRunner {
  async run(_context: TaskRunContext): Promise<TaskRunResult> {
    return { summary: null };
  }
}
