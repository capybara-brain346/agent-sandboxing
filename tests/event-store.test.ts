import { describe, expect, it, vi } from "vitest";
import type { Prisma, PrismaClient } from "@prisma/client";
import { EventStore } from "../src/services/events/event-store";

describe("EventStore", () => {
  it("allocates strictly increasing per-sandbox sequences inside the transaction", async () => {
    let nextSequence = 1;
    const created: Array<{ sequence: number }> = [];
    const tx = {
      $queryRaw: vi.fn(async () => [{ next_event_sequence: nextSequence }]),
      sandboxEvent: {
        create: vi.fn(async ({ data }: { data: { sequence: number } }) => {
          created.push({ sequence: data.sequence });
          return {
            id: `e${data.sequence}`,
            sandboxId: "s1",
            commandId: null,
            sequence: data.sequence,
            type: "sandbox_created",
            actor: "api",
            correlationId: null,
            payload: {},
            createdAt: new Date("2026-01-01T00:00:00Z"),
          };
        }),
      },
      sandbox: { update: vi.fn(async () => { nextSequence += 1; return {}; }) },
    } as unknown as Prisma.TransactionClient;
    const prisma = {
      $transaction: vi.fn(
        async (callback: (value: Prisma.TransactionClient) => Promise<unknown>) =>
          callback(tx),
      ),
    } as unknown as PrismaClient;
    const store = new EventStore(prisma);

    const first = await store.append({
      sandboxId: "s1",
      type: "sandbox_created",
      actor: "api",
      payload: {},
    });
    const second = await store.append({
      sandboxId: "s1",
      type: "sandbox_ready",
      actor: "provisioner",
      payload: {},
    });

    expect([first.sequence, second.sequence]).toEqual([1, 2]);
    expect(created.map((event) => event.sequence)).toEqual([1, 2]);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it("allocates task stream sequences and persists producer metadata in Event", async () => {
    const created: Array<Record<string, unknown>> = [];
    const tx = {
      $queryRaw: vi.fn(async () => [{ next_event_sequence: 4 }]),
      event: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return {
            ...data,
            createdAt: new Date("2026-01-01T00:00:00Z"),
          };
        }),
      },
      task: { update: vi.fn(async () => ({})) },
    } as unknown as Prisma.TransactionClient;
    const store = new EventStore({} as PrismaClient);

    const event = await store.appendTaskEventInTransaction(tx, {
      taskId: "task_1",
      type: "sandbox_ready",
      producerService: "sandbox",
      producerId: "sbox_1",
      sandboxId: "sbox_1",
      payload: { ready: true },
    });

    expect(event).toMatchObject({
      id: expect.stringMatching(/^evt_/),
      streamId: "task_1",
      taskId: "task_1",
      sandboxId: "sbox_1",
      sequence: 4,
      producerService: "sandbox",
      producerId: "sbox_1",
    });
    expect(created[0]).toMatchObject({
      streamId: "task_1",
      sequence: 4,
      producerService: "sandbox",
      producerId: "sbox_1",
    });
    expect(tx.task.update).toHaveBeenCalledWith({
      where: { id: "task_1" },
      data: { nextEventSequence: { increment: 1 } },
    });
  });

  it("lists task events strictly after the requested cursor", async () => {
    const prisma = {
      event: {
        findMany: vi.fn(async () => [
          {
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
            createdAt: new Date("2026-01-01T00:00:00Z"),
          },
        ]),
      },
    } as unknown as PrismaClient;
    const store = new EventStore(prisma);

    await expect(store.listTaskEvents("task_1", 1)).resolves.toMatchObject([
      { id: "evt_2", sequence: 2, streamId: "task_1" },
    ]);
    expect(prisma.event.findMany).toHaveBeenCalledWith({
      where: { streamId: "task_1", sequence: { gt: 1 } },
      orderBy: { sequence: "asc" },
    });
  });

  it("promotes linked sandbox producers into the task stream", async () => {
    const tx = {
      sandbox: {
        findUnique: vi.fn(async () => ({ taskId: "task_1" })),
      },
      $queryRaw: vi.fn(async () => [{ next_event_sequence: 2 }]),
      event: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          ...data,
          createdAt: new Date("2026-01-01T00:00:00Z"),
        })),
      },
      task: { update: vi.fn(async () => ({})) },
    } as unknown as Prisma.TransactionClient;
    const store = new EventStore({} as PrismaClient);

    const event = await store.appendInTransaction(tx, {
      sandboxId: "sbox_1",
      type: "sandbox_ready",
      actor: "provisioner",
      payload: {},
    });

    expect(event).toMatchObject({
      streamId: "task_1",
      taskId: "task_1",
      sandboxId: "sbox_1",
      producerService: "sandbox",
      producerId: "sbox_1",
      sequence: 2,
    });
    expect(tx.event.create).toHaveBeenCalled();
  });

  it("does not expose an event when the append transaction rolls back", async () => {
    const tx = {
      $queryRaw: vi.fn(async () => [{ next_event_sequence: 1 }]),
      sandboxEvent: {
        create: vi.fn(async () => ({
          id: "e1",
          sandboxId: "s1",
          commandId: null,
          sequence: 1,
          type: "sandbox_created",
          actor: "api",
          correlationId: null,
          payload: {},
          createdAt: new Date("2026-01-01T00:00:00Z"),
        })),
      },
      sandbox: {
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
        sandboxId: "s1",
        type: "sandbox_created",
        actor: "api",
        payload: {},
      }),
    ).rejects.toThrow("rollback");
  });
});
