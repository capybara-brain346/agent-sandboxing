import { z } from "zod";

export { EVENT_TYPES } from "./event.types";
export type { EventType } from "./event.types";

export type SandboxStatus =
  "creating" | "ready" | "stopping" | "stopped" | "failed" | "deleted";

export type CommandStatus =
  "running" | "succeeded" | "failed" | "timed_out" | "cancelled";

export type SandboxProvisioningSource =
  | { source: "fixture"; fixtureRepoPath: string }
  | {
      source: "github";
      owner: string;
      name: string;
      installationId: string;
      cloneUrl: string;
      baseBranch: string;
      token: string;
    };

export type TaskSandboxInput = {
  source: SandboxProvisioningSource;
  image?: string | undefined;
};

export const commandRequestSchema = z
  .object({
    command: z.string(),
    cwd: z.string().optional(),
    env: z.record(z.string(), z.string()).optional(),
    timeoutMs: z.number().int().positive().optional(),
  })
  .strict();
export type CommandRequest = z.infer<typeof commandRequestSchema>;

export type CommandStartResult = {
  commandId: string;
  taskId: string;
  status: CommandStatus;
};

export type CommandStatusResult = {
  commandId: string;
  taskId: string;
  status: CommandStatus;
  exitCode: number | null;
  outputBytes: number;
  outputTruncated: boolean;
  startedAt: string;
  completedAt: string | null;
};

export type SandboxDiffResult = {
  sandboxId: string;
  diff: string;
  generatedAt: string;
};

export type RuntimeOutput = { stream: "stdout" | "stderr"; chunk: string };

export type RuntimeResult = {
  exitCode: number | null;
  timedOut: boolean;
  outputBytes: number;
  outputTruncated: boolean;
};

export type SimpleExecOptions = {
  timeoutMs?: number;
  env?: Record<string, string>;
  stdin?: string;
  signal?: AbortSignal;
};

export type SimpleExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  truncated: boolean;
};

export type NormalizedCommandRequest = {
  command: string;
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
};

export type LimitedOutputEvent = {
  payload: {
    stream: "stdout" | "stderr";
    chunk: string;
    chunk_index: number;
    truncated: boolean;
  };
};
