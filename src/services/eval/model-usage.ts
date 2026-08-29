import type { LanguageModel } from "ai";
import type { EvalTraceRecorderLike } from "./eval-trace-recorder";
import type { EvalTraceStage, ModelUsage } from "../../types/eval-trace.types";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const numberValue = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const modelId = (model: LanguageModel): string | undefined => {
  const value = (model as unknown as { modelId?: unknown }).modelId;
  return typeof value === "string" ? value : undefined;
};

export const recordModelUsage = (input: {
  recorder: EvalTraceRecorderLike | undefined;
  messageId: string | undefined;
  stage: EvalTraceStage;
  model: LanguageModel;
  startedAt: number;
  result: unknown;
}): void => {
  if (!input.recorder || !input.messageId) return;
  const usageRecord =
    isRecord(input.result) && isRecord(input.result.usage)
      ? input.result.usage
      : {};
  const inputTokens = numberValue(
    usageRecord.inputTokens ?? usageRecord.promptTokens,
  );
  const outputTokens = numberValue(
    usageRecord.outputTokens ?? usageRecord.completionTokens,
  );
  const totalTokens = numberValue(usageRecord.totalTokens);
  const cost = isRecord(input.result)
    ? numberValue(
        input.result.cost ??
          input.result.totalCost ??
          input.result.estimatedUsd,
      )
    : undefined;
  const modelName = modelId(input.model);
  const usage: ModelUsage = {
    ...(modelName ? { model: modelName } : {}),
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined
      ? { totalTokens }
      : inputTokens !== undefined && outputTokens !== undefined
        ? { totalTokens: inputTokens + outputTokens }
        : {}),
    ...(cost !== undefined ? { estimatedUsd: cost } : {}),
    latencyMs: Math.max(0, Date.now() - input.startedAt),
  };
  input.recorder.recordUsage({
    messageId: input.messageId,
    stage: input.stage,
    usage,
  });
};
