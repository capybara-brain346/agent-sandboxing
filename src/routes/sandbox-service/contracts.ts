import { z } from "zod";
import { ServiceError } from "../../shared/errors";
import { isWorkspacePath } from "../../types/sandbox-service/domain";

const createSandboxSchema = z
  .object({
    fixtureRepoPath: z.string().min(1).optional(),
    image: z.string().min(1).optional(),
  })
  .strict();

const commandRequestSchema = z
  .object({
    command: z.string(),
    cwd: z.string().optional(),
    env: z.record(z.string(), z.string()).optional(),
    timeoutMs: z.number().int().positive().optional(),
  })
  .strict();

export type CreateSandboxRequest = {
  fixtureRepoPath?: string;
  image?: string;
};

export type CommandRequest = {
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
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

export const parseCreateSandboxRequest = (
  body: unknown,
): CreateSandboxRequest => {
  const parsed = createSandboxSchema.safeParse(body ?? {});
  if (!parsed.success) {
    const hasUnknownKey = parsed.error.issues.some(
      (issue) => issue.code === "unrecognized_keys",
    );
    throw new ServiceError(
      hasUnknownKey ? "unsupported_request" : "invalid_request",
      hasUnknownKey
        ? "Only local fixture provisioning fields are supported"
        : "Request body is invalid",
    );
  }

  const result: CreateSandboxRequest = {};
  if (parsed.data.fixtureRepoPath !== undefined)
    result.fixtureRepoPath = parsed.data.fixtureRepoPath;
  if (parsed.data.image !== undefined) result.image = parsed.data.image;
  return result;
};

export const parseCommandRequest = (body: unknown): CommandRequest => {
  const parsed = commandRequestSchema.safeParse(body);
  if (!parsed.success)
    throw new ServiceError("invalid_request", "Command request is invalid");

  const value = parsed.data;
  if (value.cwd !== undefined && !isWorkspacePath(value.cwd))
    throw new ServiceError(
      "unsafe_command_request",
      "cwd must be under /workspace/repo",
      422,
    );

  const result: CommandRequest = { command: value.command };
  if (value.cwd !== undefined) result.cwd = value.cwd;
  if (value.env !== undefined) result.env = value.env;
  if (value.timeoutMs !== undefined) result.timeoutMs = value.timeoutMs;
  return result;
};
