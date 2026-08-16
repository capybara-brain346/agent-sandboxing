import { tool } from "ai";
import { z } from "zod";
import type { Config } from "../../../config";
import {
  boundUtf8,
  executeChecked,
  TOOL_RESPONSE_MAX_BYTES,
  type AgentToolRuntime,
  shellQuote,
  throwIfAborted,
  validateWorkspacePath,
} from "./helpers";
import { workspaceRoot } from "../../sandbox/workspace";

export const createLsTool = (
  runtime: AgentToolRuntime,
  containerName: string,
  config: Config,
  signal: AbortSignal,
) =>
  tool({
    description: "List a workspace directory with detailed file metadata.",
    inputSchema: z.object({ path: z.string().optional() }),
    execute: async ({ path: directoryPath }) => {
      throwIfAborted(signal);
      const safePath = validateWorkspacePath(directoryPath ?? workspaceRoot);
      const result = await executeChecked(
        runtime,
        containerName,
        `ls -la -- ${shellQuote(safePath)}`,
        signal,
        config.AGENT_TOOL_TIMEOUT_MS,
      );
      const bounded = boundUtf8(result.stdout, TOOL_RESPONSE_MAX_BYTES);
      return {
        listing: bounded.value,
        truncated: result.truncated || bounded.truncated,
      };
    },
  });

export const lsTool = createLsTool;
