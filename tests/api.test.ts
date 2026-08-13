import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/db/prisma", () => {
  const prisma = {
    $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => {
      let nextSequence = 1;
      const task = {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          if ("nextEventSequence" in data) nextSequence += 1;
          return data;
        }),
      };
      const tx = {
        $queryRaw: vi.fn(async () => [{ next_event_sequence: nextSequence }]),
        task,
        sandbox: {
          create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
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

  it("does not expose sandbox routes through the product API", async () => {
    const response = await request(app).post("/sandboxes").send({});

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("not_found");
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
