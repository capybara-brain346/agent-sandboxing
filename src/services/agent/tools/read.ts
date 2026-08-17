import { tool } from "ai";
import { z } from "zod";
import type { AgentToolConfig } from "./config";
import {
  boundUtf8,
  executeChecked,
  type AgentToolRuntime,
  shellQuote,
  throwIfAborted,
  validateWorkspacePath,
} from "./helpers";

export const createReadTool = (
  runtime: AgentToolRuntime,
  containerName: string,
  config: AgentToolConfig,
  signal: AbortSignal,
) =>
  tool({
    description: "Read a UTF-8 text file inside the task workspace.",
    inputSchema: z.object({
      path: z.string().describe("Absolute path under /workspace/repo"),
    }),
    execute: async ({ path: filePath }) => {
      throwIfAborted(signal);
      const safePath = validateWorkspacePath(filePath);
      const result = await executeChecked(
        runtime,
        containerName,
        `cat -- ${shellQuote(safePath)}`,
        signal,
        config.AGENT_TOOL_TIMEOUT_MS,
      );
      const bounded = boundUtf8(result.stdout, config.AGENT_READ_MAX_BYTES);
      return {
        content: bounded.value,
        truncated: result.truncated || bounded.truncated,
      };
    },
  });

export const readTool = createReadTool;
