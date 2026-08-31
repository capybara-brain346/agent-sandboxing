import { z } from "zod";
import type { SessionAgentResult } from "../../src/types/harness.types";
import type { MessageProcessingStatus } from "../../src/types/message-processing.types";

const stringList = z.array(z.string().trim().min(1));
export const workerResultSchema: z.ZodType<SessionAgentResult> = z
  .object({
    status: z.enum(["completed", "blocked", "failed"]),
    summary: z.string(),
  })
  .passthrough()
  .transform((result) => ({ status: result.status, summary: result.summary }));

const chatMessageSchema = z
  .object({
    role: z.enum(["user", "assistant", "system"]),
    content: z.string(),
  })
  .strict();

const workspaceSchema = z
  .object({
    hasPriorProcessing: z.boolean(),
    lastProcessingStatus: z.string().nullable(),
    lastProcessingSummary: z.string().nullable(),
    changedFilesHint: z.array(z.string()),
  })
  .strict();

export const datasetCaseSchema = z
  .object({
    id: z.string().min(1),
    suite: z.string().min(1),
    input: z
      .object({
        summary: z.string(),
        recentMessages: z.array(chatMessageSchema),
        recentToolActivity: z.array(z.string()),
        workspace: workspaceSchema,
        message: z.string(),
      })
      .strict(),
    expect: z
      .object({
        decision: z.enum([
          "direct",
          "clarify",
          "delegate",
          "blocked",
          "failed",
        ]),
        shouldDelegate: z.boolean(),
        minDelegations: z.number().int().nonnegative().optional(),
        maxDelegations: z.number().int().nonnegative(),
        briefMustContain: stringList.default([]),
        contextMustContain: stringList.default([]),
        responseMustNotContain: stringList.default([]),
      })
      .strict(),
    workerResults: z.array(workerResultSchema).default([]),
  })
  .strict();

export type DatasetCase = z.output<typeof datasetCaseSchema>;

export type DatasetObserved = {
  reply: string;
  delegations: SessionAgentResult[];
  briefs: string[];
  error?: string;
};

export const DATASET_SCORE_NAMES = [
  "routing_correct",
  "delegation_count_ok",
  "clarification_present",
  "brief_contains_task",
  "brief_uses_context",
  "brief_omits_raw_transcript",
  "response_grounded",
] as const;

export type DatasetScoreName = (typeof DATASET_SCORE_NAMES)[number];
export type DatasetScores = Record<DatasetScoreName, 0 | 1>;

export type DatasetEvalResult = {
  caseId: string;
  suite: string;
  status: "passed" | "failed";
  scores: DatasetScores;
  observed: DatasetObserved & {
    delegationCount: number;
    delegationStatuses: string[];
  };
  subjectiveJudge?: SubjectiveJudgeResult;
};

const subjectiveScore = z.number().int().min(1).max(5);

export const subjectiveJudgeOutputSchema = z
  .object({
    task_success_1_to_5: subjectiveScore,
    minimality_1_to_5: subjectiveScore,
    verification_quality_1_to_5: subjectiveScore,
    response_quality_1_to_5: subjectiveScore,
    blocker_honesty_1_to_5: subjectiveScore,
  })
  .strict();

export const SUBJECTIVE_SCORE_NAMES = [
  "task_success_1_to_5",
  "minimality_1_to_5",
  "verification_quality_1_to_5",
  "response_quality_1_to_5",
  "blocker_honesty_1_to_5",
] as const;

export type SubjectiveScoreName = (typeof SUBJECTIVE_SCORE_NAMES)[number];
export type SubjectiveScores = z.output<typeof subjectiveJudgeOutputSchema>;

export type SubjectiveJudgeInput = {
  caseId: string;
  suite: string;
  task: string;
  context: unknown;
  observed: unknown;
};

export type SubjectiveJudgeResult =
  | {
      status: "reported";
      scores: SubjectiveScores;
      latencyMs: number;
    }
  | {
      status: "error";
      error: string;
      latencyMs: number;
    };

const repoMessageSchema = z
  .object({
    role: z.literal("user"),
    content: z.string().min(1),
  })
  .strict();

export const repoCaseSchema = z
  .object({
    id: z.string().min(1),
    suite: z.string().min(1),
    fixture: z.string().min(1),
    messages: z.array(repoMessageSchema).min(1),
    expect: z
      .object({
        processingStatus: z.enum(["completed", "failed", "cancelled"]),
        workerStatus: z.enum(["completed", "blocked", "failed"]).optional(),
        shouldDelegate: z.boolean(),
        minDelegations: z.number().int().nonnegative().optional(),
        maxDelegations: z.number().int().nonnegative().default(1),
        changedFiles: stringList.default([]),
        changedFilesMode: z.enum(["exact", "allowlist"]).default("exact"),
        diffMustContain: stringList.default([]),
        diffMustNotContain: stringList.default([]),
        requiredTests: stringList.default([]),
        postProcessingCommands: z.array(z.string().trim().min(1)).default([]),
        responseMustContain: stringList.default([]),
        responseMustNotContain: stringList.default([]),
        responseMustMentionTests: z.boolean().default(false),
        responseMustMentionBlocker: z.boolean().default(false),
      })
      .strict(),
  })
  .strict();

export type RepoCase = z.output<typeof repoCaseSchema>;

export type RepoToolEvent = {
  type: "agent_tool_call" | "agent_tool_result";
  toolName: string;
  correlationId: string | null;
  exitCode?: number | null;
  truncated?: boolean;
  durationMs?: number;
  resultSnippet?: string;
  command?: string;
};

export type RepoPostProcessingCheck = {
  command: string;
  exitCode: number | null;
  timedOut: boolean;
  passed: boolean;
  stdout: string;
  stderr: string;
  truncated: boolean;
  durationMs: number;
  error: string | null;
};

export type RepoObserved = {
  processingStatus: MessageProcessingStatus | null;
  workerStatus: "completed" | "blocked" | "failed" | null;
  delegationCount: number;
  changedFiles: string[];
  diff: string;
  testsRun: string[];
  postProcessingChecks: RepoPostProcessingCheck[];
  workerReports: SessionAgentResult[];
  toolEvents: RepoToolEvent[];
  messageIds: string[];
  finalMessage: string;
  assistantMessages: string[];
  error?: string;
};

export const REPO_SCORE_NAMES = [
  "status_correct",
  "routing_correct",
  "changed_files_correct",
  "diff_contains_required",
  "diff_avoids_forbidden",
  "tests_run",
  "task_success",
  "minimality",
  "final_response_quality",
  "blocker_honesty",
] as const;

export type RepoScoreName = (typeof REPO_SCORE_NAMES)[number];
export type RepoScores = Record<RepoScoreName, 0 | 1>;

export type RepoEvalResult = {
  caseId: string;
  suite: string;
  status: "passed" | "failed";
  scores: RepoScores;
  observed: RepoObserved;
  subjectiveJudge?: SubjectiveJudgeResult;
};
