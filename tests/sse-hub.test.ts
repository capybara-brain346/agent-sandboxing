import { describe, expect, it } from "vitest";
import type { Response } from "express";
import { SseHub } from "../src/services/events/sse-hub";
import { toLegacySandboxEvent } from "../src/types/event.types";

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

  it("can filter and transform task-stream events for sandbox consumers", () => {
    const writes: string[] = [];
    const response = {
      write: (data: string) => {
        writes.push(data);
        return true;
      },
      on: () => response,
    } as unknown as Response;
    const hub = new SseHub();
    const client = hub.subscribe("task_1", response, 0, {
      transform: (event) => toLegacySandboxEvent(event, "sbox_1"),
    });

    hub.publish({
      id: "evt_1",
      streamId: "task_1",
      taskId: "task_1",
      sandboxId: null,
      commandId: null,
      sequence: 1,
      type: "task_created",
      producerService: "task",
      producerId: "task_1",
      correlationId: null,
      payload: {},
      createdAt: new Date().toISOString(),
    });
    hub.publish({
      id: "evt_2",
      streamId: "task_1",
      taskId: "task_1",
      sandboxId: "sbox_1",
      commandId: null,
      sequence: 2,
      type: "sandbox_ready",
      producerService: "sandbox",
      producerId: "sbox_1",
      correlationId: null,
      payload: {},
      createdAt: new Date().toISOString(),
    });
    hub.finishReplay("task_1", client, 0);

    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("event: sandbox_ready");
    expect(writes[0]).toContain('"actor":"provisioner"');
  });

  it("keeps task events ordered across replay and live delivery", () => {
    const writes: string[] = [];
    const response = {
      write: (data: string) => {
        writes.push(data);
        return true;
      },
      on: () => response,
    } as unknown as Response;
    const hub = new SseHub();
    const client = hub.subscribeTask("task_1", response, 2);

    const event = (sequence: number) => ({
      id: `evt_${sequence}`,
      streamId: "task_1",
      taskId: "task_1",
      sandboxId: "sbox_1",
      commandId: null,
      sequence,
      type: "sandbox_ready" as const,
      producerService: "sandbox" as const,
      producerId: "sbox_1",
      correlationId: null,
      payload: {},
      createdAt: new Date().toISOString(),
    });

    hub.publish(event(4));
    hub.publish(event(3));
    hub.finishTaskReplay("task_1", client, 2);
    hub.publish(event(5));

    expect(writes.map((write) => write.match(/^id: (\d+)/m)?.[1])).toEqual([
      "3",
      "4",
      "5",
    ]);
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
