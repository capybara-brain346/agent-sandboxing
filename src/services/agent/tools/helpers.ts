import path from "node:path";
import { ServiceError } from "../../../shared/errors";
import type { SimpleExecResult } from "../../../types/sandbox.types";
import type { SandboxRuntime } from "../../sandbox/runtime";
import { workspaceRoot } from "../../sandbox/workspace";

export type AgentToolRuntime = Pick<SandboxRuntime, "simpleExec">;

export const TOOL_RESPONSE_MAX_BYTES = 50 * 1024;
export const EDIT_RESPONSE_MAX_BYTES = 1024;

const shellSyntax = /[;&|<>`$(){}\n\r]/;
export const hasControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || code === 0x7f;
  });

export const createAbortError = (): Error => {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
};

export const isAbortError = (error: unknown): boolean =>
  Boolean(
    error &&
    typeof error === "object" &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError",
  );

export const throwIfAborted = (signal: AbortSignal): void => {
  if (signal.aborted) throw createAbortError();
};

const invalidPath = (message = "Path must be under /workspace/repo"): never => {
  throw new ServiceError("unsafe_path", message, 422);
};

export const validateWorkspacePath = (value: string): string => {
  if (typeof value !== "string" || value.length === 0)
    return invalidPath("Path must not be empty");
  if (!path.posix.isAbsolute(value))
    return invalidPath("Path must be absolute");
  if (hasControlCharacter(value) || shellSyntax.test(value))
    return invalidPath("Path contains disallowed control or shell characters");

  const segments = value.split("/");
  if (segments.includes(".") || segments.includes(".."))
    return invalidPath("Path traversal is not allowed");

  const normalized = path.posix.normalize(value);
  if (
    normalized !== workspaceRoot &&
    !normalized.startsWith(`${workspaceRoot}/`)
  )
    return invalidPath();

  return value;
};

export const validateToolText = (value: string, name: string): string => {
  if (typeof value !== "string" || hasControlCharacter(value))
    throw new ServiceError(
      "invalid_tool_input",
      `${name} contains control characters`,
    );
  return value;
};

export const shellQuote = (value: string): string =>
  `'${value.replaceAll("'", "'\\''")}'`;

export type Utf8Bounded = { value: string; truncated: boolean };

export const takeUtf8Prefix = (value: string, maxBytes: number): string => {
  if (maxBytes <= 0) return "";
  let bytesUsed = 0;
  let result = "";
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (bytesUsed + characterBytes > maxBytes) break;
    result += character;
    bytesUsed += characterBytes;
  }
  return result;
};

export const boundUtf8 = (value: string, maxBytes: number): Utf8Bounded => {
  const bounded = takeUtf8Prefix(value, maxBytes);
  return { value: bounded, truncated: bounded.length < value.length };
};

export const byteLength = (value: string): number =>
  Buffer.byteLength(value, "utf8");

const runtimeFailure = (): ServiceError =>
  new ServiceError(
    "tool_runtime_failure",
    "Sandbox tool execution failed",
    500,
  );

export const executeChecked = async (
  runtime: AgentToolRuntime,
  containerName: string,
  command: string,
  signal: AbortSignal,
  timeoutMs: number,
  acceptedExitCodes: readonly number[] = [0],
): Promise<SimpleExecResult> => {
  throwIfAborted(signal);

  let result: SimpleExecResult;
  try {
    result = await runtime.simpleExec(containerName, command, workspaceRoot, {
      timeoutMs,
      signal,
    });
  } catch (error) {
    if (isAbortError(error) || signal.aborted) throw createAbortError();
    throw runtimeFailure();
  }
  throwIfAborted(signal);

  if (result.timedOut)
    throw new ServiceError(
      "tool_timeout",
      "Sandbox tool execution timed out",
      504,
    );
  if (result.exitCode === null || !acceptedExitCodes.includes(result.exitCode))
    throw new ServiceError(
      "tool_command_failed",
      "Sandbox tool command failed",
      422,
    );

  return result;
};

export const ensureInputSize = (
  value: string,
  maxBytes: number,
  name: string,
): void => {
  if (byteLength(value) > maxBytes)
    throw new ServiceError(
      "tool_input_too_large",
      `${name} exceeds the configured size limit`,
      413,
    );
};

export const workspacePathFromArgument = (value: string): string => {
  if (path.posix.isAbsolute(value)) return validateWorkspacePath(value);
  if (hasControlCharacter(value) || shellSyntax.test(value))
    return invalidPath("Path contains disallowed control or shell characters");
  if (value.split("/").includes(".."))
    return invalidPath("Path traversal is not allowed");
  return validateWorkspacePath(path.posix.join(workspaceRoot, value));
};
