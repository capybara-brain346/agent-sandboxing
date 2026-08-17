import { tool } from "ai";
import { z } from "zod";
import type { AgentToolConfig } from "./config";
import {
  boundUtf8,
  executeChecked,
  TOOL_RESPONSE_MAX_BYTES,
  type AgentToolRuntime,
  shellQuote,
  throwIfAborted,
  validateToolText,
  validateWorkspacePath,
} from "./helpers";
import { workspaceRoot } from "../../sandbox/workspace";

export const createGrepTool = (
  runtime: AgentToolRuntime,
  containerName: string,
  config: AgentToolConfig,
  signal: AbortSignal,
) =>
  tool({
    description:
      "Recursively search workspace files and return numbered matches.",
    inputSchema: z.object({
      pattern: z.string().min(1),
      path: z.string().optional(),
    }),
    execute: async ({ pattern, path: searchPath }) => {
      throwIfAborted(signal);
      const safePattern = validateToolText(pattern, "pattern");
      const safePath = validateWorkspacePath(searchPath ?? workspaceRoot);
      const result = await executeChecked(
        runtime,
        containerName,
        `grep -RIn -- ${shellQuote(safePattern)} ${shellQuote(safePath)}`,
        signal,
        config.AGENT_TOOL_TIMEOUT_MS,
        [0, 1],
      );
      const bounded = boundUtf8(result.stdout, TOOL_RESPONSE_MAX_BYTES);
      return {
        matches: bounded.value,
        truncated: result.truncated || bounded.truncated,
      };
    },
  });

export const grepTool = createGrepTool;
