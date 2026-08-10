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
export type Actor = "api" | "provisioner" | "runtime" | "cleanup";
export type PersistedEvent = {
  id: string;
  sandboxId: string;
  commandId: string | null;
  sequence: number;
  type: EventType;
  actor: Actor;
  correlationId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};
export const transitions: Record<SandboxStatus, readonly SandboxStatus[]> = {
  creating: ["ready", "failed", "stopping"],
  ready: ["stopping", "failed"],
  stopping: ["stopped", "failed"],
  stopped: ["deleted"],
  failed: ["deleted"],
  deleted: [],
};
export function canTransition(from: SandboxStatus, to: SandboxStatus): boolean {
  return transitions[from].includes(to);
}

export const workspaceRoot = "/workspace/repo";

export function isWorkspacePath(value: string): boolean {
  return value === workspaceRoot || value.startsWith(`${workspaceRoot}/`);
}

export function splitOutput(text: string, maxBytes = 16_384): string[] {
  const out: string[] = [];
  let current = "";
  let currentBytes = 0;

  for (const char of text) {
    const bytes = Buffer.byteLength(char);
    if (current && currentBytes + bytes > maxBytes) {
      out.push(current);
      current = "";
      currentBytes = 0;
    }
    current += char;
    currentBytes += bytes;
  }

  if (current) out.push(current);
  return out;
}

export function takeUtf8Prefix(text: string, maxBytes: number): string {
  let result = "";
  let bytesUsed = 0;

  for (const char of text) {
    const bytes = Buffer.byteLength(char);
    if (bytesUsed + bytes > maxBytes) break;
    result += char;
    bytesUsed += bytes;
  }

  return result;
}
