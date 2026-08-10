import { describe, expect, it } from "vitest";
import type { Response } from "express";
import { SseHub } from "../src/services/sandbox/sse-hub";

describe("SseHub", () => {
  it("buffers live events during replay and flushes only newer sequences", () => {
    const writes: string[] = [];
    const response = {
      write: (data: string) => {
        writes.push(data);
        return true;
      },
      on: () => response,
    } as unknown as Response;
    const hub = new SseHub();
    const client = hub.subscribe("s1", response, 2);
    hub.publish({
      id: "e3",
      sandboxId: "s1",
      commandId: null,
      sequence: 3,
      type: "sandbox_created",
      actor: "api",
      correlationId: null,
      payload: {},
      createdAt: new Date().toISOString(),
    });
    expect(writes).toHaveLength(0);
    hub.finishReplay("s1", client, 3);
    expect(writes).toHaveLength(0);
    hub.publish({
      id: "e4",
      sandboxId: "s1",
      commandId: null,
      sequence: 4,
      type: "sandbox_ready",
      actor: "api",
      correlationId: null,
      payload: {},
      createdAt: new Date().toISOString(),
    });
    expect(writes[0]).toContain("id: 4");
  });
});
