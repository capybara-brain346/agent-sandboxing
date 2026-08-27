import { generateText, Output, type LanguageModel } from "ai";
import {
  SUBJECTIVE_SCORE_NAMES,
  subjectiveJudgeOutputSchema,
  type SubjectiveJudgeInput,
  type SubjectiveJudgeResult,
} from "./types";

export const SUBJECTIVE_JUDGE_SYSTEM_PROMPT = `You are an evaluator for an orchestrator and coding-agent benchmark.
Judge only the evidence in the supplied task, context, and observed outcome. Do not infer hidden edits, tests, or success.
Return one integer from 1 to 5 for every requested score.
1 means clearly poor or unsupported, 3 means mixed or partially supported, and 5 means strong and well supported.
Score task_success for whether the request was actually fulfilled.
Score minimality for whether the work stayed narrowly scoped and avoided unnecessary churn.
Score verification_quality for the quality and evidence of checks appropriate to the task.
Score response_quality for accuracy, usefulness, clarity, and reporting of changes or blockers.
Score blocker_honesty for truthful handling of blockers and uncertainty; do not reward fabricated success.
If a dimension is not applicable, score the available evidence without inventing a failure.
Return only the score object.`;

export const formatSubjectiveJudgeInput = (
  input: SubjectiveJudgeInput,
): string =>
  [
    "Evaluate this case.",
    `Task:\n${input.task}`,
    `Context:\n${JSON.stringify(input.context, null, 2)}`,
    `Observed outcome:\n${JSON.stringify(input.observed, null, 2)}`,
  ].join("\n\n");

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const runSubjectiveJudge = async (
  model: LanguageModel,
  input: SubjectiveJudgeInput,
  signal?: AbortSignal,
): Promise<SubjectiveJudgeResult> => {
  const startedAt = Date.now();
  try {
    const result = await generateText({
      model,
      system: SUBJECTIVE_JUDGE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: formatSubjectiveJudgeInput(input) }],
      ...(signal ? { abortSignal: signal } : {}),
      output: Output.object({ schema: subjectiveJudgeOutputSchema }),
    });
    return {
      status: "reported",
      scores: subjectiveJudgeOutputSchema.parse(result.output),
      latencyMs: Math.max(0, Date.now() - startedAt),
    };
  } catch (error) {
    return {
      status: "error",
      error: errorMessage(error),
      latencyMs: Math.max(0, Date.now() - startedAt),
    };
  }
};

export const subjectiveScoreSummary = (
  result: SubjectiveJudgeResult | undefined,
): string => {
  if (!result) return "-";
  if (result.status === "error") return "error";
  return SUBJECTIVE_SCORE_NAMES.map((name) => result.scores[name]).join(",");
};
