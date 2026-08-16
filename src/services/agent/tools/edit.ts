import { tool } from "ai";
import { z } from "zod";
import type { Config } from "../../../config";
import { ServiceError } from "../../../shared/errors";
import {
  boundUtf8,
  byteLength,
  EDIT_RESPONSE_MAX_BYTES,
  ensureInputSize,
  executeChecked,
  type AgentToolRuntime,
  shellQuote,
  throwIfAborted,
  validateWorkspacePath,
} from "./helpers";

const countMatches = (value: string, target: string): number => {
  let count = 0;
  let offset = 0;
  while (offset <= value.length - target.length) {
    const index = value.indexOf(target, offset);
    if (index === -1) break;
    count += 1;
    offset = index + 1;
  }
  return count;
};

const replacementDiff = (
  filePath: string,
  oldContent: string,
  newContent: string,
): string => {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  let firstChanged = 0;
  while (
    firstChanged < oldLines.length &&
    firstChanged < newLines.length &&
    oldLines[firstChanged] === newLines[firstChanged]
  )
    firstChanged += 1;

  let oldEnd = oldLines.length - 1;
  let newEnd = newLines.length - 1;
  while (
    oldEnd >= firstChanged &&
    newEnd >= firstChanged &&
    oldLines[oldEnd] === newLines[newEnd]
  ) {
    oldEnd -= 1;
    newEnd -= 1;
  }

  const removed = oldLines
    .slice(firstChanged, oldEnd + 1)
    .map((line) => `-${line}`);
  const added = newLines
    .slice(firstChanged, newEnd + 1)
    .map((line) => `+${line}`);
  return [
    `--- ${filePath}`,
    `+++ ${filePath}`,
    `@@ ${firstChanged + 1} @@`,
    ...removed,
    ...added,
  ].join("\n");
};

export const createEditTool = (
  runtime: AgentToolRuntime,
  containerName: string,
  config: Config,
  signal: AbortSignal,
) =>
  tool({
    description: "Replace exactly one occurrence of text in a workspace file.",
    inputSchema: z.object({
      path: z.string().describe("Absolute path under /workspace/repo"),
      oldString: z.string().min(1),
      newString: z.string(),
    }),
    execute: async ({ path: filePath, oldString, newString }) => {
      throwIfAborted(signal);
      const safePath = validateWorkspacePath(filePath);
      ensureInputSize(oldString, config.AGENT_READ_MAX_BYTES, "oldString");
      ensureInputSize(newString, config.AGENT_WRITE_MAX_BYTES, "newString");

      const readResult = await executeChecked(
        runtime,
        containerName,
        `cat -- ${shellQuote(safePath)}`,
        signal,
        config.AGENT_TOOL_TIMEOUT_MS,
      );
      if (
        readResult.truncated ||
        byteLength(readResult.stdout) > config.AGENT_READ_MAX_BYTES
      )
        throw new ServiceError(
          "edit_file_too_large",
          "The file exceeds the edit size limit",
          413,
        );

      const matches = countMatches(readResult.stdout, oldString);
      if (matches === 0)
        throw new ServiceError(
          "edit_target_not_found",
          "The requested text was not found",
          422,
        );
      if (matches !== 1)
        throw new ServiceError(
          "edit_target_not_unique",
          "The requested text must match exactly once",
          422,
        );

      const updated = readResult.stdout.replace(oldString, newString);
      ensureInputSize(updated, config.AGENT_WRITE_MAX_BYTES, "edited file");
      const encoded = Buffer.from(updated, "utf8").toString("base64");
      await executeChecked(
        runtime,
        containerName,
        `printf '%s' ${shellQuote(encoded)} | base64 --decode > ${shellQuote(safePath)}`,
        signal,
        config.AGENT_TOOL_TIMEOUT_MS,
      );

      const diff = boundUtf8(
        replacementDiff(safePath, readResult.stdout, updated),
        EDIT_RESPONSE_MAX_BYTES,
      );
      return { diff: diff.value, truncated: diff.truncated };
    },
  });

export const editTool = createEditTool;
