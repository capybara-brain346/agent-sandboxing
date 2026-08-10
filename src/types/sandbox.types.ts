import type { SandboxEventActor } from "@prisma/client";

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

export type CreateSandboxRequest = {
  fixtureRepoPath?: string | undefined;
  image?: string | undefined;
};

export type CommandRequest = {
  command: string;
  cwd?: string | undefined;
  env?: Record<string, string> | undefined;
  timeoutMs?: number | undefined;
};

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
