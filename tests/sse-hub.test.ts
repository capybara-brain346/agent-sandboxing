import { describe, expect, it } from "vitest";
import type { Response } from "express";
import { SseHub } from "../src/services/events/sse-hub";

describe("SseHub", () => {
  it("fans out task events on their task stream channel", () => {
    const writes: string[] = [];
    const response = {
      write: (data: string) => {
        writes.push(data);
        return true;
      },
      on: () => response,
    } as unknown as Response;
    const hub = new SseHub();
    const client = hub.subscribeTask("task_1", response, 0);

    hub.publish({
      id: "evt_1",
      streamId: "task_1",
      taskId: "task_1",
      sandboxId: "sbox_1",
      commandId: null,
      sequence: 1,
      type: "sandbox_ready",
      producerService: "sandbox",
      producerId: "sbox_1",
      correlationId: null,
      payload: {},
      createdAt: new Date().toISOString(),
    });
    hub.finishTaskReplay("task_1", client, 0);

    expect(writes[0]).toContain("id: 1");
    expect(writes[0]).toContain("event: sandbox_ready");
  });

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
