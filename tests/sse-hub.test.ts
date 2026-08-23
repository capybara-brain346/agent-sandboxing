import { describe, expect, it } from "vitest";
import type { Response } from "express";
import { SseHub } from "../src/services/events/sse-hub";
import type { PublicEvent } from "../src/types/event.types";

const event = (
  sequence: number,
  type: PublicEvent["type"] = "sandbox_ready",
): PublicEvent => ({
  id: `evt_${sequence}`,
  streamId: "task_1",
  taskId: "task_1",
  sandboxId: "sbox_1",
  commandId: null,
  sequence,
  type,
  producerService: type.startsWith("command") ? "command" : "sandbox",
  producerId: "sbox_1",
  correlationId: null,
  payload: {},
  createdAt: new Date().toISOString(),
});

const scopedEvent = (
  streamScope: "session" | "run",
  streamId: string,
): PublicEvent => ({
  ...event(1),
  streamScope,
  streamId,
  sessionId: "session_1",
  runId: streamScope === "run" ? streamId : null,
  taskId: null,
});

const responseWith = (writes: string[]): Response => {
  const response = {
    write: (data: string) => {
      writes.push(data);
      return true;
    },
    on: () => response,
  } as unknown as Response;
  return response;
};

describe("SseHub", () => {
  it("fans out task-stream events", () => {
    const writes: string[] = [];
    const response = responseWith(writes);
    const hub = new SseHub();
    const client = hub.subscribe("task_1", response, 0);

    hub.publish(event(1));
    hub.finishReplay("task_1", client, 0);

    expect(writes[0]).toContain("id: 1");
    expect(writes[0]).toContain("event: sandbox_ready");
    expect(writes[0]).toContain('"taskId":"task_1"');
  });

  it("keeps task events ordered across replay and live delivery", () => {
    const writes: string[] = [];
    const response = responseWith(writes);
    const hub = new SseHub();
    const client = hub.subscribe("task_1", response, 2);

    hub.publish(event(4));
    hub.publish(event(3));
    hub.finishReplay("task_1", client, 2);
    hub.publish(event(5));

    expect(writes.map((write) => write.match(/^id: (\d+)/m)?.[1])).toEqual([
      "3",
      "4",
      "5",
    ]);
  });

  it("buffers live events during replay and drops already-replayed sequences", () => {
    const writes: string[] = [];
    const response = responseWith(writes);
    const hub = new SseHub();
    const client = hub.subscribe("task_1", response, 2);

    hub.publish(event(3));
    hub.finishReplay("task_1", client, 3);
    expect(writes).toHaveLength(0);

    hub.publish(event(4));
    expect(writes[0]).toContain("id: 4");
  });

  it("does not deliver events across stream scopes", () => {
    const sessionWrites: string[] = [];
    const runWrites: string[] = [];
    const hub = new SseHub();
    const sessionClient = hub.subscribe(
      "session",
      "same-id",
      responseWith(sessionWrites),
      0,
    );
    const runClient = hub.subscribe(
      "run",
      "same-id",
      responseWith(runWrites),
      0,
    );

    hub.finishReplay("session", "same-id", sessionClient, 0);
    hub.finishReplay("run", "same-id", runClient, 0);
    hub.publish(scopedEvent("session", "same-id"));
    hub.publish(scopedEvent("run", "same-id"));

    expect(sessionWrites).toHaveLength(1);
    expect(runWrites).toHaveLength(1);
    expect(sessionWrites[0]).toContain('"streamScope":"session"');
    expect(runWrites[0]).toContain('"streamScope":"run"');
  });
});
