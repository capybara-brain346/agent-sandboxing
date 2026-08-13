import { z } from "zod";
import type { LegacyPublicEvent } from "./event.types";

export { EVENT_TYPES } from "./event.types";
export type { EventType } from "./event.types";

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

/** @deprecated Use the first-class event types from `event.types.ts`. */
export type PublicEvent = LegacyPublicEvent;

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
