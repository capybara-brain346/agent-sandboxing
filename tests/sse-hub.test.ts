import { describe, expect, it } from "vitest";
import type { Response } from "express";
import { SseHub } from "../src/services/events/sse-hub";
import type { PublicEvent } from "../src/types/event.types";

const event = (
  sequence: number,
  streamId = "chat_1",
  type: PublicEvent["type"] = "sandbox_ready",
): PublicEvent => ({
  id: `evt_${sequence}`,
  streamId,
  streamScope: "session",
  domain: "sandbox",
  sessionId: streamId,
  messageId: "msg_1",
  sandboxId: "sbox_1",
  commandId: null,
  artifactId: null,
  sequence,
  type,
  producerService: "sandbox",
  producerId: "sbox_1",
  correlationId: null,
  payload: {},
  createdAt: new Date().toISOString(),
});

const responseWith = (writes: string[]): Response => {
  const response = {
    writableEnded: false,
    destroyed: false,
    write: (data: string) => {
      writes.push(data);
      return true;
    },
    on: () => response,
    end: () => undefined,
  } as unknown as Response;
  return response;
};

describe("SseHub", () => {
  it("fans out session events", () => {
    const writes: string[] = [];
    const hub = new SseHub();
    const client = hub.subscribe("chat_1", responseWith(writes), 0);

    hub.publish(event(1));
    hub.finishReplay("chat_1", client, 0);

    expect(writes[0]).toContain("id: 1");
    expect(writes[0]).toContain("event: sandbox_ready");
    expect(writes[0]).toContain('"sessionId":"chat_1"');
  });

  it("keeps session events ordered across replay and live delivery", () => {
    const writes: string[] = [];
    const hub = new SseHub();
    const client = hub.subscribe("chat_1", responseWith(writes), 2);

    hub.publish(event(4));
    hub.publish(event(3));
    hub.finishReplay("chat_1", client, 2);
    hub.publish(event(5));

    expect(writes.map((write) => write.match(/^id: (\d+)/m)?.[1])).toEqual([
      "3",
      "4",
      "5",
    ]);
  });

  it("does not deliver events across sessions", () => {
    const firstWrites: string[] = [];
    const secondWrites: string[] = [];
    const hub = new SseHub();
    const first = hub.subscribe("chat_1", responseWith(firstWrites), 0);
    const second = hub.subscribe("chat_2", responseWith(secondWrites), 0);

    hub.finishReplay("chat_1", first, 0);
    hub.finishReplay("chat_2", second, 0);
    hub.publish(event(1, "chat_1"));
    hub.publish(event(1, "chat_2"));

    expect(firstWrites).toHaveLength(1);
    expect(secondWrites).toHaveLength(1);
    expect(firstWrites[0]).toContain('"sessionId":"chat_1"');
    expect(secondWrites[0]).toContain('"sessionId":"chat_2"');
  });

  it("ignores events whose envelope does not belong to the session stream", () => {
    const writes: string[] = [];
    const hub = new SseHub();
    const client = hub.subscribe("chat_1", responseWith(writes), 0);
    hub.finishReplay("chat_1", client, 0);

    hub.publish({ ...event(1), sessionId: "chat_2" });

    expect(writes).toHaveLength(0);
  });
});
