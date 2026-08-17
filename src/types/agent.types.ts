import { z } from "zod";

export const agentToolCallPayloadSchema = z
  .object({
    tool_name: z.string(),
    args: z.record(z.string(), z.unknown()),
  })
  .strict();

export type AgentToolCallPayload = z.infer<typeof agentToolCallPayloadSchema>;

export const agentToolResultPayloadSchema = z
  .object({
    tool_name: z.string(),
    result_snippet: z.string().max(500),
    truncated: z.boolean(),
    exit_code: z.number().int().nullable(),
    duration_ms: z.number().int().nonnegative(),
  })
  .strict();

export type AgentToolResultPayload = z.infer<
  typeof agentToolResultPayloadSchema
>;
