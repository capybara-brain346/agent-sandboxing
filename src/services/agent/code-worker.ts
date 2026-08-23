import type { WorkerResult } from "../../types/harness.types";
import type { TaskRunContext } from "../task/task-runner";

export type CodeWorker = {
  run(context: TaskRunContext): Promise<WorkerResult>;
};
