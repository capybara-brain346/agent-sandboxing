import { describe, expect, it, vi } from "vitest";
import type { Prisma, PrismaClient } from "@prisma/client";
import { EventStore } from "../src/services/events/event-store";

const eventRow = (data: Record<string, unknown>) => ({
  ...data,
  createdAt: new Date("2026-01-01T00:00:00Z"),
});

const transaction = (nextSequence = 1) => {
  const tx = {
    $queryRaw: vi.fn(async () => [{ next_event_sequence: nextSequence }]),
    event: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) =>
        eventRow(data),
      ),
    },
    chatSession: { update: vi.fn(async () => ({})) },
  } as unknown as Prisma.TransactionClient;
  return tx;
};

describe("EventStore", () => {
  it("allocates session sequences in the transaction", async () => {
    const tx = transaction(4);
    const prisma = {
      $transaction: vi.fn(
        async (
          callback: (value: Prisma.TransactionClient) => Promise<unknown>,
        ) => callback(tx),
      ),
    } as unknown as PrismaClient;
    const store = new EventStore(prisma);

    const event = await store.append({
      sessionId: "chat_1",
      messageId: "msg_1",
      type: "message_processing_started",
      producerService: "chat",
      producerId: "msg_1",
      payload: {},
    });

    expect(event).toMatchObject({
      streamScope: "session",
      streamId: "chat_1",
      sessionId: "chat_1",
      messageId: "msg_1",
      sequence: 4,
    });
    expect(tx.chatSession.update).toHaveBeenCalledWith({
      where: { id: "chat_1" },
      data: { nextEventSequence: { increment: 1 } },
    });
  });

  it("lists session events strictly after the cursor", async () => {
    const findMany = vi.fn(async () => [
      eventRow({
        id: "evt_2",
        streamId: "chat_1",
        streamScope: "session",
        domain: "chat",
        sequence: 2,
        type: "message_processing_completed",
        producerService: "chat",
        producerId: "msg_1",
        sessionId: "chat_1",
        messageId: "msg_1",
        artifactId: null,
        sandboxId: null,
        commandId: null,
        correlationId: null,
        payload: {},
      }),
    ]);
    const store = new EventStore({
      event: { findMany },
    } as unknown as PrismaClient);

    await expect(store.listSessionEvents("chat_1", 1)).resolves.toMatchObject([
      { id: "evt_2", sequence: 2, streamId: "chat_1", streamScope: "session" },
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        streamScope: "session",
        streamId: "chat_1",
        sequence: { gt: 1 },
      },
      orderBy: { sequence: "asc" },
    });
  });

  it("does not expose an event when the append transaction fails", async () => {
    const tx = transaction();
    (tx.chatSession.update as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("rollback"),
    );
    const prisma = {
      $transaction: vi.fn(
        async (
          callback: (value: Prisma.TransactionClient) => Promise<unknown>,
        ) => callback(tx),
      ),
    } as unknown as PrismaClient;
    const store = new EventStore(prisma);

    await expect(
      store.append({
        sessionId: "chat_1",
        type: "message_created",
        producerService: "chat",
        producerId: "msg_1",
        payload: {},
      }),
    ).rejects.toThrow("rollback");
  });

  it("rejects non-session rows during replay", async () => {
    const findMany = vi.fn(async () => [
      eventRow({
        id: "evt_legacy",
        streamId: "chat_1",
        streamScope: "legacy",
        domain: "message",
        sequence: 1,
        type: "message_created",
        producerService: "chat",
        producerId: "msg_1",
        sessionId: "chat_1",
        messageId: "msg_1",
        artifactId: null,
        sandboxId: null,
        commandId: null,
        correlationId: null,
        payload: {},
      }),
    ]);
    const store = new EventStore({
      event: { findMany },
    } as unknown as PrismaClient);

    await expect(store.listSessionEvents("chat_1", 0)).rejects.toThrow(
      "Event is not session-scoped",
    );
  });
});
