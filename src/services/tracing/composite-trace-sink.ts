import type { Trace, TraceSink } from "../../types/trace.types";
import { logger } from "../../logger";

export class CompositeTraceSink implements TraceSink {
  constructor(private readonly sinks: TraceSink[]) {}

  async finishTrace(trace: Trace): Promise<void> {
    await Promise.all(
      this.sinks.map(async (sink) => {
        try {
          await sink.finishTrace(trace);
        } catch (error) {
          logger.warn("trace_export_failed", {
            messageId: trace.identity.messageId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }),
    );
  }
}
