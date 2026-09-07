import { tool } from "ai";
import { z } from "zod";
import type { AgentResult } from "../../../types/harness.types";
import { boundUtf8 } from "../../../shared/utf8";
import { throwIfAborted } from "./helpers";

export const SUBAGENT_REPORT_MAX_CHARACTERS = 20_000;
const truncationMarker = "\n[truncated]";

export type SubagentToolInput = {
  task: string;
  maxSteps?: number;
};

export type SubagentToolRunner = (
  input: SubagentToolInput,
) => Promise<AgentResult>;

export const boundSubagentReport = (report: string): string => {
  const bounded = boundUtf8(
    report,
    SUBAGENT_REPORT_MAX_CHARACTERS - Buffer.byteLength(truncationMarker),
  );
  return bounded.truncated
    ? `${bounded.value.trimEnd()}${truncationMarker}`
    : report;
};

export const createSubagentTool = (
  run: SubagentToolRunner,
  signal: AbortSignal,
) =>
  tool({
    description:
      "Investigate the repository with a read-only subagent and return its concise report.",
    inputSchema: z
      .object({
        task: z.string().trim().min(1),
        maxSteps: z.number().int().positive().optional(),
      })
      .strict(),
    execute: async ({ task, maxSteps }) => {
      throwIfAborted(signal);
      const result = await run(
        maxSteps === undefined ? { task } : { task, maxSteps },
      );
      throwIfAborted(signal);
      return boundSubagentReport(result.finalText);
    },
  });
