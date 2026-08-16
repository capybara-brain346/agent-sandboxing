import { describe, expect, it, vi } from "vitest";
import type { Prisma, PrismaClient } from "@prisma/client";
import { EventStore } from "../src/services/events/event-store";

const eventRow = (data: Record<string, unknown>) => ({
  ...data,
  createdAt: new Date("2026-01-01T00:00:00Z"),
});

describe("EventStore", () => {
  it("allocates strictly increasing task-stream sequences in the transaction", async () => {
    let nextSequence = 1;
    const tx = {
      $queryRaw: vi.fn(async () => [{ next_event_sequence: nextSequence }]),
      event: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          nextSequence += 1;
          return eventRow(data);
        }),
      },
      task: {
        update: vi.fn(async () => ({})),
      },
    } as unknown as Prisma.TransactionClient;
    const prisma = {
      $transaction: vi.fn(
        async (callback: (value: Prisma.TransactionClient) => Promise<unknown>) =>
          callback(tx),
      ),
    } as unknown as PrismaClient;
    const store = new EventStore(prisma);

    const first = await store.append({
      taskId: "task_1",
      type: "task_created",
      producerService: "task",
      producerId: "task_1",
      payload: {},
    });
    const second = await store.append({
      taskId: "task_1",
      sandboxId: "sbox_1",
      type: "sandbox_ready",
      producerService: "sandbox",
      producerId: "sbox_1",
      payload: {},
    });

    expect(first).toMatchObject({ taskId: "task_1", sequence: 1 });
    expect(second).toMatchObject({
      taskId: "task_1",
      sandboxId: "sbox_1",
      sequence: 2,
    });
    expect(tx.task.update).toHaveBeenCalledTimes(2);
  });

  it("persists command observability on the owning task stream", async () => {
    const tx = {
      $queryRaw: vi.fn(async () => [{ next_event_sequence: 3 }]),
      event: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) =>
          eventRow(data),
        ),
      },
      task: { update: vi.fn(async () => ({})) },
    } as unknown as Prisma.TransactionClient;
    const store = new EventStore({} as PrismaClient);

    const event = await store.appendInTransaction(tx, {
      taskId: "task_1",
      sandboxId: "sbox_1",
      commandId: "cmd_1",
      type: "command_completed",
      producerService: "runtime",
      producerId: "cmd_1",
      payload: { exit_code: 0 },
    });

    expect(event).toMatchObject({
      taskId: "task_1",
      sandboxId: "sbox_1",
      commandId: "cmd_1",
      sequence: 3,
    });
  });

  it("lists task events strictly after the requested cursor", async () => {
    const findMany = vi.fn(async () => [
      eventRow({
        id: "evt_2",
        streamId: "task_1",
        sequence: 2,
        type: "task_running",
        producerService: "task",
        producerId: "task_1",
        taskId: "task_1",
        sandboxId: null,
        commandId: null,
        correlationId: null,
        payload: {},
      }),
    ]);
    const store = new EventStore({ event: { findMany } } as unknown as PrismaClient);

    await expect(store.listTaskEvents("task_1", 1)).resolves.toMatchObject([
      { id: "evt_2", sequence: 2, streamId: "task_1" },
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: { streamId: "task_1", sequence: { gt: 1 } },
      orderBy: { sequence: "asc" },
    });
  });

  it("verifies task existence while replaying an empty stream", async () => {
    const queryRaw = vi.fn(async () => []);
    const store = new EventStore({ $queryRaw: queryRaw } as unknown as PrismaClient);

    await expect(store.listTaskEventsAfter("missing", 0)).rejects.toMatchObject({
      code: "task_not_found",
    });
  });

  it("does not expose an event when the append transaction rolls back", async () => {
    const tx = {
      $queryRaw: vi.fn(async () => [{ next_event_sequence: 1 }]),
      event: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) =>
          eventRow(data),
        ),
      },
      task: {
        update: vi.fn(async () => {
          throw new Error("rollback");
        }),
      },
    } as unknown as Prisma.TransactionClient;
    const prisma = {
      $transaction: vi.fn(
        async (callback: (value: Prisma.TransactionClient) => Promise<unknown>) =>
          callback(tx),
      ),
    } as unknown as PrismaClient;
    const store = new EventStore(prisma);

    await expect(
      store.append({
        taskId: "task_1",
        type: "task_created",
        producerService: "task",
        producerId: "task_1",
        payload: {},
      }),
    ).rejects.toThrow("rollback");
  });
});
