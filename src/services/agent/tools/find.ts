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

const hasGlobSyntax = (value: string): boolean => /[*?[{]/.test(value);

export const createFindTool = (
  runtime: AgentToolRuntime,
  containerName: string,
  config: AgentToolConfig,
  signal: AbortSignal,
) =>
  tool({
    description: "Find files by name under the task workspace.",
    inputSchema: z.object({
      pattern: z.string().min(1),
      path: z.string().optional(),
    }),
    execute: async ({ pattern, path: searchPath }) => {
      throwIfAborted(signal);
      const safePattern = validateToolText(pattern, "pattern");
      const namePattern = hasGlobSyntax(safePattern)
        ? safePattern
        : `*${safePattern}*`;
      const safePath = validateWorkspacePath(searchPath ?? workspaceRoot);
      const result = await executeChecked(
        runtime,
        containerName,
        `find ${shellQuote(safePath)} -type f -iname ${shellQuote(namePattern)} -print`,
        signal,
        config.AGENT_TOOL_TIMEOUT_MS,
      );
      const bounded = boundUtf8(result.stdout, TOOL_RESPONSE_MAX_BYTES);
      return {
        paths: bounded.value,
        truncated: result.truncated || bounded.truncated,
      };
    },
  });

export const findTool = createFindTool;
