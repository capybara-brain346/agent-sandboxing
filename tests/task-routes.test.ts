import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createTaskRouter } from "../src/routes/task.routes";
import { SseHub } from "../src/services/events/sse-hub";
import { ServiceError } from "../src/shared/errors";
import type {
  PublicTaskEvent,
  TaskServicePort,
  TaskSnapshot,
} from "../src/types/task.types";

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

const makeApp = (service: TaskServicePort, eventHub = new SseHub()) => {
  const app = express();
  app.use(express.json());
  app.use(createTaskRouter(service, eventHub));
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

describe("task routes", () => {
  it("strictly validates task creation and dispatches task fields", async () => {
    const service = {
      create: vi.fn().mockResolvedValue({
        taskId: "task_1",
        status: "created",
        eventsUrl: "/tasks/task_1/events",
      }),
    } as unknown as TaskServicePort;
    const app = makeApp(service);

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
    expect(service.create).toHaveBeenCalledWith({
      repoRef: "./repo",
      instructions: "No-op",
      image: "node:22",
    });
  });

  it("rejects unknown task creation fields before dispatch", async () => {
    const service = { create: vi.fn() } as unknown as TaskServicePort;
    const response = await request(makeApp(service)).post("/tasks").send({
      repoRef: "./repo",
      instructions: "No-op",
      sandboxId: "sbox_1",
    });

    expect(response.status).toBe(400);
    expect(service.create).not.toHaveBeenCalled();
  });

  it("replays task events as SSE", async () => {
    const service = {
      eventsAfter: vi.fn().mockResolvedValue([event]),
    } as unknown as TaskServicePort;
    const eventHub = new SseHub();
    vi.spyOn(eventHub, "finishTaskReplay").mockImplementation(
      (taskId, client, replayLast) => {
        SseHub.prototype.finishTaskReplay.call(
          eventHub,
          taskId,
          client,
          replayLast,
        );
        client.response.end();
      },
    );
    const response = await request(makeApp(service, eventHub)).get(
      "/tasks/task_1/events?after=0",
    );

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.text).toContain("event: task_created");
    expect(service.eventsAfter).toHaveBeenCalledWith("task_1", 0);
  });

  it("dispatches task snapshots and asynchronous cancellation", async () => {
    const service = {
      get: vi.fn().mockResolvedValue(snapshot),
      cancel: vi.fn().mockResolvedValue({
        taskId: "task_1",
        status: "cancelling",
        eventsUrl: "/tasks/task_1/events",
      }),
    } as unknown as TaskServicePort;
    const app = makeApp(service);

    await expect(request(app).get("/tasks/task_1")).resolves.toMatchObject({
      status: 200,
      body: snapshot,
    });
    const response = await request(app).delete("/tasks/task_1");
    expect(response.status).toBe(202);
    expect(service.cancel).toHaveBeenCalledWith("task_1");
  });
});
