import { randomUUID } from "node:crypto";
import type {
  CommandStatus,
  Prisma,
  PrismaClient,
  SandboxEventActor,
  SandboxStatus,
} from "@prisma/client";
import type { Config } from "../../config";
import type {
  CommandRequest,
  EventType,
  PublicEvent,
  StartCommandResponse,
} from "../../types/sandbox.types";
import { ServiceError, notFound } from "../../shared/errors";
import { isWorkspacePath, workspaceRoot } from "./workspace";
import type { EventStore } from "./event-store";
import type { RuntimeOutput, SandboxRuntime } from "./runtime";

const safeEnv = /^[A-Z_][A-Z0-9_]*$/;

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

const isUniqueConstraintError = (error: unknown, name: string): boolean => {
  if (!error || typeof error !== "object") return false;
  const maybe = error as {
    code?: unknown;
    meta?: { target?: unknown };
    message?: unknown;
  };

  return (
    (maybe.code === "P2002" &&
      (Array.isArray(maybe.meta?.target)
        ? maybe.meta.target.includes(name)
        : maybe.meta?.target === name)) ||
    (typeof maybe.message === "string" && maybe.message.includes(name))
  );
};

export type NormalizedCommandRequest = {
  command: string;
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
};

export const normalizeCommandRequest = (
  input: CommandRequest,
  maxTimeoutMs: number,
): NormalizedCommandRequest => {
  const command = input.command.trim();
  const cwd = input.cwd ?? workspaceRoot;
  const timeoutMs = input.timeoutMs ?? maxTimeoutMs;
  const env = input.env ?? {};

  if (!command)
    throw new ServiceError("invalid_request", "command must not be empty");
  if (!isWorkspacePath(cwd))
    throw new ServiceError(
      "unsafe_command_request",
      "cwd must be under /workspace/repo",
      422,
    );
  if (timeoutMs < 1 || timeoutMs > maxTimeoutMs)
    throw new ServiceError(
      "invalid_request",
      "timeoutMs exceeds the configured maximum",
    );
  if (
    Object.entries(env).some(
      ([key, value]) =>
        !safeEnv.test(key) || typeof value !== "string" || value.length > 4096,
    )
  )
    throw new ServiceError(
      "unsafe_command_request",
      "Environment keys or values are not allowed",
      422,
    );

  return { command, cwd, env, timeoutMs };
};

export type LimitedOutputEvent = {
  payload: {
    stream: "stdout" | "stderr";
    chunk: string;
    chunk_index: number;
    truncated: boolean;
  };
};

export class CommandOutputLimiter {
  private persistedBytes = 0;
  private outputTruncated = false;
  private readonly chunkIndexes: Record<"stdout" | "stderr", number> = {
    stdout: 0,
    stderr: 0,
  };

  constructor(private readonly maxBytes: number) {}

  get bytes(): number {
    return this.persistedBytes;
  }

  get truncated(): boolean {
    return this.outputTruncated;
  }

  limit(output: RuntimeOutput): LimitedOutputEvent[] {
    const events: LimitedOutputEvent[] = [];
    for (const chunk of splitOutput(output.chunk)) {
      const remaining = this.maxBytes - this.persistedBytes;
      if (remaining <= 0) {
        this.outputTruncated = true;
        break;
      }

      const bounded = takeUtf8Prefix(chunk, remaining);
      if (!bounded) {
        this.outputTruncated = true;
        break;
      }

      const truncated = Buffer.byteLength(bounded) < Buffer.byteLength(chunk);
      this.outputTruncated ||= truncated;
      this.persistedBytes += Buffer.byteLength(bounded);
      events.push({
        payload: {
          stream: output.stream,
          chunk: bounded,
          chunk_index: this.chunkIndexes[output.stream]++,
          truncated,
        },
      });
    }
    return events;
  }
}

export class CommandExecutionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly events: EventStore,
    private readonly runtime: SandboxRuntime,
    private readonly config: Config,
    private readonly publish: (event: PublicEvent) => void,
  ) {}

  async startCommand(
    sandboxId: string,
    input: CommandRequest,
  ): Promise<StartCommandResponse> {
    const normalized = normalizeCommandRequest(
      input,
      this.config.SANDBOX_COMMAND_TIMEOUT_MS,
    );
    const result = await this.prisma
      .$transaction(async (tx) => {
        const sandboxes = await tx.$queryRaw<
          Array<{
            id: string;
            status: SandboxStatus;
            container_name: string;
          }>
        >`SELECT id, status, container_name FROM sandboxes WHERE id = ${sandboxId} FOR UPDATE`;
        const sandbox = sandboxes[0];
        if (!sandbox)
          throw notFound("sandbox_not_found", "Sandbox was not found");
        if (sandbox.status !== "ready")
          throw new ServiceError(
            "sandbox_not_ready",
            "Sandbox is not ready",
            409,
          );

        const row = await tx.command.create({
          data: {
            sandboxId,
            status: "running",
            command: normalized.command,
            cwd: normalized.cwd,
            env: normalized.env as Prisma.InputJsonValue,
            timeoutMs: normalized.timeoutMs,
          },
        });
        const event = await this.events.appendInTransaction(tx, {
          sandboxId,
          commandId: row.id,
          type: "command_started",
          actor: "api",
          correlationId: randomUUID(),
          payload: {
            command_id: row.id,
            cwd: normalized.cwd,
            timeout_ms: normalized.timeoutMs,
          },
        });
        return { row, event, containerName: sandbox.container_name };
      })
      .catch((error: unknown) => {
        if (isUniqueConstraintError(error, "commands_one_running_per_sandbox"))
          throw new ServiceError(
            "command_already_running",
            "Another command is already running",
            409,
          );
        throw error;
      });

    this.publish(result.event);
    void this.executeCommand(
      sandboxId,
      result.row.id,
      result.containerName,
      normalized,
    );
    return {
      commandId: result.row.id,
      sandboxId,
      status: result.row.status,
    };
  }

  async getCommand(sandboxId: string, commandId: string): Promise<unknown> {
    const hasSandbox =
      (await this.prisma.sandbox.count({ where: { id: sandboxId } })) > 0;
    if (!hasSandbox)
      throw notFound("sandbox_not_found", "Sandbox was not found");

    const command = await this.prisma.command.findFirst({
      where: { id: commandId, sandboxId },
    });
    if (!command) throw notFound("command_not_found", "Command was not found");
    return {
      commandId: command.id,
      sandboxId,
      status: command.status,
      exitCode: command.exitCode,
      outputBytes: command.outputBytes,
      outputTruncated: command.outputTruncated,
      startedAt: command.startedAt.toISOString(),
      completedAt: command.completedAt?.toISOString() ?? null,
    };
  }

  private async executeCommand(
    sandboxId: string,
    commandId: string,
    containerName: string,
    command: NormalizedCommandRequest,
  ): Promise<void> {
    try {
      const output = new CommandOutputLimiter(
        this.config.COMMAND_OUTPUT_MAX_BYTES,
      );
      const result = await this.runtime.run(
        containerName,
        command.command,
        command.cwd,
        command.env,
        command.timeoutMs,
        async (runtimeOutput) => {
          for (const event of output.limit(runtimeOutput)) {
            await this.emit({
              sandboxId,
              commandId,
              type: "command_output",
              actor: "runtime",
              payload: event.payload,
            });
          }
        },
      );
      const status: CommandStatus = result.timedOut
        ? "timed_out"
        : result.exitCode === 0
          ? "succeeded"
          : "failed";
      const eventType: EventType = result.timedOut
        ? "command_timed_out"
        : "command_completed";
      const outputTruncated = result.outputTruncated || output.truncated;
      const data: Prisma.CommandUpdateInput = {
        status,
        exitCode: result.exitCode,
        outputBytes: output.bytes,
        outputTruncated,
        completedAt: new Date(),
      };
      if (result.timedOut) data.failureCode = "command_timeout";
      const event = await this.prisma.$transaction(async (tx) => {
        await tx.command.update({ where: { id: commandId }, data });
        return this.events.appendInTransaction(tx, {
          sandboxId,
          commandId,
          type: eventType,
          actor: "runtime",
          correlationId: randomUUID(),
          payload: {
            exit_code: result.exitCode,
            duration_ms: 0,
            timeout_ms: command.timeoutMs,
            output_bytes: output.bytes,
            output_truncated: outputTruncated,
          },
        });
      });
      this.publish(event);
    } catch (error) {
      const safe = this.safeError(error, "command");
      await this.prisma
        .$transaction(async (tx) => {
          await tx.command.update({
            where: { id: commandId },
            data: {
              status: "failed",
              completedAt: new Date(),
              failureCode: safe.code,
              failureMessage: safe.message,
            },
          });
          return this.events.appendInTransaction(tx, {
            sandboxId,
            commandId,
            type: "command_failed",
            actor: "runtime",
            correlationId: randomUUID(),
            payload: safe,
          });
        })
        .then((event) => this.publish(event))
        .catch(() => undefined);
    }
  }

  private async emit(input: {
    sandboxId: string;
    commandId?: string;
    type: EventType;
    actor: SandboxEventActor;
    payload: Record<string, unknown>;
  }): Promise<void> {
    this.publish(
      await this.events.append({ ...input, correlationId: randomUUID() }),
    );
  }

  private safeError(
    error: unknown,
    operation: string,
  ): { code: string; message: string; operation: string; retryable: boolean } {
    const message =
      error instanceof ServiceError
        ? error.message
        : "Sandbox runtime operation failed";
    const code = error instanceof ServiceError ? error.code : "unknown";
    return { code, message, operation, retryable: false };
  }
}
