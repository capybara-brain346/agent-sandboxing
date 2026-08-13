import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicEvent } from "../src/types/event.types";

vi.mock("../src/db/prisma", () => {
  const prisma = {
    $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
    sandbox: {
      findUnique: vi.fn(async () => ({ status: "ready" })),
    },
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => {
      let nextSequence = 1;
      const task = {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          if ("nextEventSequence" in data) nextSequence += 1;
          return data;
        }),
        findUnique: vi.fn(async () => ({ status: "created" })),
      };
      const tx = {
        $queryRaw: vi.fn(async () => [{ next_event_sequence: nextSequence }]),
        task,
        sandbox: {
          create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
          findUnique: vi.fn(async () => ({ status: "ready" })),
        },
        event: {
          create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
            ...data,
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
          })),
        },
      };
      return callback(tx);
    }),
  };
  return { prisma };
});

const { createApp } = await import("../src/server");

describe("HTTP wiring", () => {
  const app = createApp();

  beforeEach(() => vi.clearAllMocks());

  it("reports health", async () => {
    const response = await request(app).get("/health");
    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
  });

  it("exposes task routes and validates task creation strictly", async () => {
    const response = await request(app).post("/tasks").send({
      repoRef: "./repo",
      instructions: "No-op",
      sandboxId: "sbox_1",
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("invalid_request");
  });

  it("mounts sandbox routes alongside task routes", async () => {
    const response = await request(app).post("/sandboxes").send({
      unexpected: true,
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("invalid_request");
  });

  it("subscribes sandbox SSE to the linked task stream", async () => {
    const { sandboxService } = await import("../src/services/sandbox/sandbox");
    const { SseHub, sseHub } = await import(
      "../src/services/events/sse-hub"
    );
    const sandboxEvent: PublicEvent = {
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
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const streamId = vi
      .spyOn(sandboxService, "eventStreamId")
      .mockResolvedValue("task_1");
    const eventsAfter = vi
      .spyOn(sandboxService, "eventsAfter")
      .mockResolvedValue([sandboxEvent]);
    const finishReplay = vi
      .spyOn(sseHub, "finishReplay")
      .mockImplementation((channel, client, replayLast) => {
        SseHub.prototype.finishReplay.call(
          sseHub,
          channel,
          client,
          replayLast,
        );
        client.response.end();
      });

    try {
      const response = await request(app).get(
        "/sandboxes/sbox_1/events?after=0",
      );

      expect(response.status).toBe(200);
      expect(response.text).toContain("event: sandbox_ready");
      expect(streamId).toHaveBeenCalledWith("sbox_1");
      expect(eventsAfter).toHaveBeenCalledWith("sbox_1", 0);
      expect(finishReplay).toHaveBeenCalledWith(
        "task_1",
        expect.any(Object),
        1,
      );
    } finally {
      streamId.mockRestore();
      eventsAfter.mockRestore();
      finishReplay.mockRestore();
    }
  });

  it("creates a task without exposing sandbox internals", async () => {
    const response = await request(app).post("/tasks").send({
      repoRef: "./repo",
      instructions: "No-op",
    });

    expect(response.status).toBe(202);
    expect(response.body.taskId).toMatch(/^task_/);
    expect(response.body.status).toBe("created");
    expect(response.body.eventsUrl).toBe(
      `/tasks/${response.body.taskId}/events`,
    );
    expect(response.body).not.toHaveProperty("sandboxId");
  });
});
