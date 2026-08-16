import { describe, expect, it } from "vitest";
import {
  EVENT_PRODUCER_SERVICES,
  EVENT_TYPES,
  eventProducerServiceSchema,
} from "../src/types/event.types";
import {
  agentToolCallPayloadSchema,
  agentToolResultPayloadSchema,
} from "../src/types/agent.types";

describe("agent event contracts", () => {
  it("registers agent event types and producer service", () => {
    expect(EVENT_TYPES).toEqual(
      expect.arrayContaining(["agent_tool_call", "agent_tool_result"]),
    );
    expect(EVENT_PRODUCER_SERVICES).toContain("agent");
    expect(eventProducerServiceSchema.parse("agent")).toBe("agent");
  });

  it("validates a tool call payload with strict snake_case fields", () => {
    expect(
      agentToolCallPayloadSchema.parse({
        tool_name: "bash",
        args: { command: "pwd" },
      }),
    ).toEqual({ tool_name: "bash", args: { command: "pwd" } });
    expect(() =>
      agentToolCallPayloadSchema.parse({ args: { command: "pwd" } }),
    ).toThrow();
    expect(() =>
      agentToolCallPayloadSchema.parse({
        tool_name: "bash",
        args: {},
        correlation_id: "outside-the-envelope",
      }),
    ).toThrow();
  });

  it("validates bounded tool result payloads", () => {
    expect(
      agentToolResultPayloadSchema.parse({
        tool_name: "bash",
        result_snippet: "ok",
        truncated: false,
        exit_code: 0,
        duration_ms: 12,
      }),
    ).toMatchObject({ tool_name: "bash", exit_code: 0 });

    expect(
      agentToolResultPayloadSchema.parse({
        tool_name: "read",
        result_snippet: "",
        truncated: true,
        exit_code: null,
        duration_ms: 0,
      }),
    ).toMatchObject({ truncated: true, exit_code: null });
  });

  it("rejects malformed, oversized, and unknown result fields", () => {
    const valid = {
      tool_name: "bash",
      result_snippet: "ok",
      truncated: false,
      exit_code: 0,
      duration_ms: 1,
    };

    expect(() =>
      agentToolResultPayloadSchema.parse({
        ...valid,
        result_snippet: "x".repeat(501),
      }),
    ).toThrow();
    expect(() =>
      agentToolResultPayloadSchema.parse({ ...valid, duration_ms: -1 }),
    ).toThrow();
    expect(() =>
      agentToolResultPayloadSchema.parse({ ...valid, exit_code: "0" }),
    ).toThrow();
    expect(() =>
      agentToolResultPayloadSchema.parse({ ...valid, extra: true }),
    ).toThrow();
    expect(() =>
      agentToolResultPayloadSchema.parse({
        tool_name: "bash",
        result_snippet: "ok",
        truncated: false,
        exit_code: 0,
      }),
    ).toThrow();
  });
});
