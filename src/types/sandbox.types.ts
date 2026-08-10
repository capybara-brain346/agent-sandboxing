import type { SandboxEventActor } from "@prisma/client";
import { z } from "zod";

export const EVENT_TYPES = [
  "sandbox_created",
  "sandbox_provisioning_started",
  "fixture_repo_copy_started",
  "fixture_repo_copied",
  "sandbox_ready",
  "sandbox_failed",
  "sandbox_stopping",
  "sandbox_stopped",
  "command_started",
  "command_output",
  "command_completed",
  "command_failed",
  "command_timed_out",
  "command_cancelled",
  "git_diff_requested",
  "git_diff_completed",
  "cleanup_started",
  "cleanup_completed",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export type SandboxStatus =
  | "creating"
  | "ready"
  | "stopping"
  | "stopped"
  | "failed"
  | "deleted";

export type CommandStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "cancelled";

export type PublicEvent = {
  id: string;
  sandboxId: string;
  commandId: string | null;
  sequence: number;
  type: EventType;
  actor: SandboxEventActor;
  correlationId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};

export const createSandboxSchema = z
  .object({
    fixtureRepoPath: z.string().min(1).optional(),
    image: z.string().min(1).optional(),
  })
  .strict();
export type CreateSandboxRequest = z.infer<typeof createSandboxSchema>;

export const commandRequestSchema = z
  .object({
    command: z.string(),
    cwd: z.string().optional(),
    env: z.record(z.string(), z.string()).optional(),
    timeoutMs: z.number().int().positive().optional(),
  })
  .strict();
export type CommandRequest = z.infer<typeof commandRequestSchema>;

export type CreateSandboxResponse = {
  sandboxId: string;
  status: string;
  workspacePath: string;
  eventsUrl: string;
};

export type StartCommandResponse = {
  commandId: string;
  sandboxId: string;
  status: string;
};

export type DiffResponse = {
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
