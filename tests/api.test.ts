import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/db/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  },
}));

const { createApp } = await import("../src/server");
const { taskService } = await import("../src/services/task/task");

describe("HTTP wiring", () => {
  const app = createApp();

  beforeEach(() => vi.restoreAllMocks());

  it("reports health", async () => {
    const response = await request(app).get("/health");
    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
  });

  it("keeps task routes strict", async () => {
    const response = await request(app).post("/tasks").send({
      repoRef: "./repo",
      instructions: "No-op",
      sandboxId: "sbox_1",
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("invalid_request");
  });

  it.each([
    ["post", "/sandboxes"],
    ["get", "/sandboxes/sbox_1"],
    ["get", "/sandboxes/sbox_1/events"],
    ["post", "/sandboxes/sbox_1/commands"],
    ["get", "/sandboxes/sbox_1/commands/cmd_1"],
    ["get", "/sandboxes/sbox_1/diff"],
    ["delete", "/sandboxes/sbox_1"],
  ] as const)("returns 404 for retired sandbox route %s %s", async (method, path) => {
    const response = await request(app)[method](path);
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("not_found");
  });

  it("keeps task creation as the product boundary", async () => {
    vi.spyOn(taskService, "create").mockResolvedValue({
      taskId: "task_1",
      status: "created",
      eventsUrl: "/tasks/task_1/events",
    });

    const response = await request(app).post("/tasks").send({
      repoRef: "./repo",
      instructions: "No-op",
    });

    expect(response.status).toBe(202);
    expect(response.body).toEqual({
      taskId: "task_1",
      status: "created",
      eventsUrl: "/tasks/task_1/events",
    });
  });
});
