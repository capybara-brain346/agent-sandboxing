import type { SessionAgentResult } from "../../types/harness.types";
import type {
  EvalTrace,
  EvalTraceContextSummary,
  EvalTraceContextSnapshot,
  EvalTraceSink,
  EvalTraceStage,
  ModelUsage,
} from "../../types/eval-trace.types";

export class CompositeTraceSink implements EvalTraceSink {
  constructor(private readonly sinks: EvalTraceSink[]) {}

  startProcessing(input: {
    sessionId: string;
    messageId: string;
    userPrompt: string;
  }): void | Promise<void> {
    return this.call((sink) => sink.startProcessing(input));
  }

  recordOrchestratorContext(input: {
    messageId: string;
    contextSummary: EvalTraceContextSummary;
    contextSnapshot?: EvalTraceContextSnapshot;
  }): void | Promise<void> {
    return this.call((sink) => sink.recordOrchestratorContext(input));
  }

  recordWorkerBrief(input: {
    messageId: string;
    brief: string;
  }): void | Promise<void> {
    return this.call((sink) => sink.recordWorkerBrief(input));
  }

  recordWorkerResult(input: {
    messageId: string;
    result: SessionAgentResult;
  }): void | Promise<void> {
    return this.call((sink) => sink.recordWorkerResult(input));
  }

  recordOrchestratorReply(input: {
    messageId: string;
    reply: string;
    delegated: boolean;
  }): void | Promise<void> {
    return this.call((sink) => sink.recordOrchestratorReply(input));
  }

  recordUsage(input: {
    messageId: string;
    stage: EvalTraceStage;
    usage: ModelUsage;
  }): void | Promise<void> {
    return this.call((sink) => sink.recordUsage(input));
  }

  finishProcessing(trace: EvalTrace): Promise<void> {
    return Promise.all(
      this.sinks.map(async (sink) => {
        try {
          await sink.finishProcessing(trace);
        } catch {
          return;
        }
      }),
    ).then(() => undefined);
  }

  private call(
    operation: (sink: EvalTraceSink) => void | Promise<void>,
  ): void | Promise<void> {
    const results = this.sinks.map(operation);
    const pending = results.filter(
      (result): result is Promise<void> => result instanceof Promise,
    );
    if (!pending.length) return;
    return Promise.allSettled(pending).then(() => undefined);
  }
}
