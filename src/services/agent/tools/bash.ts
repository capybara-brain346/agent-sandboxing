import { tool } from "ai";
import { z } from "zod";
import type { Config } from "../../../config";
import {
  boundUtf8,
  executeChecked,
  type AgentToolRuntime,
  throwIfAborted,
} from "./helpers";
import { validateBashCommand } from "./bash-policy";

export const createBashTool = (
  runtime: AgentToolRuntime,
  containerName: string,
  config: Config,
  signal: AbortSignal,
) =>
  tool({
    description: "Run an allowlisted shell command in /workspace/repo.",
    inputSchema: z.object({ command: z.string().min(1) }),
    execute: async ({ command }) => {
      throwIfAborted(signal);
      const safeCommand = validateBashCommand(command);
      const result = await executeChecked(
        runtime,
        containerName,
        safeCommand,
        signal,
        config.AGENT_BASH_TIMEOUT_MS,
      );
      const stdout = boundUtf8(
        result.stdout,
        config.AGENT_BASH_OUTPUT_MAX_BYTES,
      );
      const stderrBudget = Math.max(
        0,
        config.AGENT_BASH_OUTPUT_MAX_BYTES -
          Buffer.byteLength(stdout.value, "utf8"),
      );
      const stderr = boundUtf8(result.stderr, stderrBudget);
      return {
        stdout: stdout.value,
        stderr: stderr.value,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        truncated: result.truncated || stdout.truncated || stderr.truncated,
      };
    },
  });

export const bashTool = createBashTool;
