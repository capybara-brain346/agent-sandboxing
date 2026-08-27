import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { EvalTrace, EvalTraceSink } from "../../types/eval-trace.types";

export class LocalTraceSink implements EvalTraceSink {
  constructor(private readonly path: string) {}

  startRun(): void {}

  recordOrchestratorContext(): void {}

  recordWorkerBrief(): void {}

  recordWorkerResult(): void {}

  recordOrchestratorReply(): void {}

  recordUsage(): void {}

  async finishRun(trace: EvalTrace): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(trace)}\n`, "utf8");
  }
}
