import { z } from "zod";

export const WORKER_STATUSES = ["completed", "blocked", "failed"] as const;
export type WorkerStatus = (typeof WORKER_STATUSES)[number];

export const workerTestRunSchema = z
  .object({
    command: z.string(),
    status: z.enum(["passed", "failed"]),
    outputSummary: z.string(),
  })
  .strict();
export type WorkerTestRun = z.infer<typeof workerTestRunSchema>;

export const workerResultSchema = z
  .object({
    status: z.enum(WORKER_STATUSES),
    summary: z.string(),
    changedFiles: z.array(z.string()).default([]),
    testsRun: z.array(workerTestRunSchema).default([]),
    blockers: z.array(z.string()).default([]),
    suggestedNextStep: z.string().default(""),
  })
  .strict();
export type WorkerResult = z.infer<typeof workerResultSchema>;

export type MessageIntent = "clarification" | "code";

export type WorkspaceSnapshot = {
  hasPriorRun: boolean;
  lastRunStatus: string | null;
  lastRunSummary: string | null;
  changedFilesHint: string[];
};

export type OrchestratorChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type OrchestratorContext = {
  sessionId: string;
  repoRef: string;
  summary: string;
  recentMessages: OrchestratorChatMessage[];
  workspace: WorkspaceSnapshot;
};
