import { tool } from "ai";
import { z } from "zod";
import type { AgentToolConfig } from "./config";
import {
  byteLength,
  ensureInputSize,
  executeChecked,
  type AgentToolRuntime,
  shellQuote,
  throwIfAborted,
  validateWorkspacePath,
} from "./helpers";

export const createWriteTool = (
  runtime: AgentToolRuntime,
  containerName: string,
  config: AgentToolConfig,
  signal: AbortSignal,
) =>
  tool({
    description: "Write UTF-8 text to a file inside the task workspace.",
    inputSchema: z.object({
      path: z.string().describe("Absolute path under /workspace/repo"),
      content: z.string(),
    }),
    execute: async ({ path: filePath, content }) => {
      throwIfAborted(signal);
      const safePath = validateWorkspacePath(filePath);
      ensureInputSize(content, config.AGENT_WRITE_MAX_BYTES, "content");
      const encoded = Buffer.from(content, "utf8").toString("base64");
      const command = `printf '%s' ${shellQuote(encoded)} | base64 --decode > ${shellQuote(safePath)}`;
      await executeChecked(
        runtime,
        containerName,
        command,
        signal,
        config.AGENT_TOOL_TIMEOUT_MS,
      );
      return { bytesWritten: byteLength(content) };
    },
  });

export const writeTool = createWriteTool;
