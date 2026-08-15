import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { taskRouter } from "../src/routes/task.routes";
import { sseHub } from "../src/services/events/sse-hub";
import { taskService } from "../src/services/task/task";
import { ServiceError } from "../src/shared/errors";
import type { PublicTaskEvent, TaskSnapshot } from "../src/types/task.types";

const snapshot: TaskSnapshot = {
  taskId: "task_1",
  status: "running",
  repoRef: "./repo",
  instructions: "No-op",
  eventsUrl: "/tasks/task_1/events",
  resultUrl: "/tasks/task_1/result",
  createdAt: "2026-01-01T00:00:00.000Z",
  provisioningAt: "2026-01-01T00:00:01.000Z",
  runningAt: "2026-01-01T00:00:02.000Z",
  completedAt: null,
  failure: null,
};

const event: PublicTaskEvent = {
  id: "evt_1",
  streamId: "task_1",
  taskId: "task_1",
  sandboxId: null,
  commandId: null,
  sequence: 1,
  type: "task_created",
  producerService: "task",
  producerId: "task_1",
  correlationId: null,
  payload: {},
  createdAt: "2026-01-01T00:00:00.000Z",
};

const makeApp = () => {
  const app = express();
  app.use(express.json());
  app.use(taskRouter);
  app.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      const serviceError = error instanceof ServiceError ? error : null;
      response.status(serviceError?.status ?? 500).json({
        error: { code: serviceError?.code ?? "internal_error" },
      });
    },
  );
  return app;
};

afterEach(() => {
  sseHub.closeAll();
  vi.restoreAllMocks();
});

describe("task routes", () => {
  it("strictly validates task creation and dispatches task fields", async () => {
    const create = vi.spyOn(taskService, "create").mockResolvedValue({
      taskId: "task_1",
      status: "created",
      eventsUrl: "/tasks/task_1/events",
    });
    const app = makeApp();

    const response = await request(app).post("/tasks").send({
      repoRef: "./repo",
      instructions: "No-op",
      image: "node:22",
    });

    expect(response.status).toBe(202);
    expect(response.body).toEqual({
      taskId: "task_1",
      status: "created",
      eventsUrl: "/tasks/task_1/events",
    });
    expect(create).toHaveBeenCalledWith({
      repoRef: "./repo",
      instructions: "No-op",
      image: "node:22",
    });
  });

  it("rejects unknown task creation fields before dispatch", async () => {
    const create = vi.spyOn(taskService, "create");
    const response = await request(makeApp()).post("/tasks").send({
      repoRef: "./repo",
      instructions: "No-op",
      sandboxId: "sbox_1",
    });

    expect(response.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("replays task events as SSE", async () => {
    const eventsAfter = vi
      .spyOn(taskService, "eventsAfter")
      .mockResolvedValue([event]);
    vi.spyOn(sseHub, "finishTaskReplay").mockImplementation(
      (taskId, client, replayLast) => {
        sseHub.finishReplay(taskId, client, replayLast);
        client.response.end();
      },
    );
    const response = await request(makeApp()).get(
      "/tasks/task_1/events?after=0",
    );

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.text).toContain("event: task_created");
    expect(eventsAfter).toHaveBeenCalledWith("task_1", 0);
  });

  it("dispatches task snapshots and asynchronous cancellation", async () => {
    const get = vi.spyOn(taskService, "get").mockResolvedValue(snapshot);
    const cancel = vi.spyOn(taskService, "cancel").mockResolvedValue({
      taskId: "task_1",
      status: "cancelling",
      eventsUrl: "/tasks/task_1/events",
    });
    const app = makeApp();

    await expect(request(app).get("/tasks/task_1")).resolves.toMatchObject({
      status: 200,
      body: snapshot,
    });
    const response = await request(app).delete("/tasks/task_1");
    expect(response.status).toBe(202);
    expect(get).toHaveBeenCalledWith("task_1");
    expect(cancel).toHaveBeenCalledWith("task_1");
  });
});
