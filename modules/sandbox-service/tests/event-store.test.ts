import { describe, expect, it, vi } from "vitest";
import type { Prisma, PrismaClient } from "@prisma/client";
import { EventStore } from "../src/event-store";

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
