import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/db/prisma", () => ({
  prisma: { $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]) },
}));

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

  it("does not pretend task execution is implemented during the route phase", async () => {
    const response = await request(app).post("/tasks").send({
      repoRef: "./repo",
      instructions: "No-op",
    });

    expect(response.status).toBe(501);
    expect(response.body.error.code).toBe("task_service_unavailable");
  });
});
