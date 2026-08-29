import type { WorkerResult } from "../../types/harness.types";
import type { MessageProcessingContext } from "../../types/message-processing.types";

export type CodeWorker = {
  process(context: MessageProcessingContext): Promise<WorkerResult>;
};
