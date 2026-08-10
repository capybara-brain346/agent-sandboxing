import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import type { SandboxService } from "../src/services/sandbox-service/sandbox-service";
import type { EventStore } from "../src/services/sandbox-service/event-store";
import type { SseHub } from "../src/services/sandbox-service/sse-hub";
import { ServiceError } from "../src/shared/errors";

describe("HTTP wiring", () => {
  const service = {
    create: vi.fn().mockResolvedValue({
      sandboxId: "s1",
      status: "creating",
      workspacePath: "/workspace/repo",
      eventsUrl: "/sandboxes/s1/events",
    }),
    get: vi.fn().mockResolvedValue({ sandboxId: "s1", status: "ready" }),
    has: vi.fn().mockResolvedValue(true),
    startCommand: vi.fn((id: string, input: { cwd?: string }) => {
      if (input.cwd === "/tmp")
        return Promise.reject(
          new ServiceError("unsafe_command_request", "unsafe", 422),
        );
      return Promise.resolve({ commandId: "c1", sandboxId: id, status: "running" });
    }),
  } as unknown as SandboxService;
  const events = { listAfter: vi.fn().mockResolvedValue([]) } as unknown as EventStore;
  const hub = { subscribe: vi.fn(), finishReplay: vi.fn() } as unknown as SseHub;
  const app = createApp(service, hub);

  beforeEach(() => vi.clearAllMocks());

  it("reports health and returns async create", async () => {
    expect((await request(app).get("/health")).status).toBe(200);
    const response = await request(app)
      .post("/sandboxes")
      .send({ fixtureRepoPath: "./repo" });
    expect(response.status).toBe(202);
    expect(response.body.status).toBe("creating");
  });

  it("rejects fields outside the local fixture API", async () => {
    const response = await request(app)
      .post("/sandboxes")
      .send({ unexpectedField: "value" });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("unsupported_request");
  });

  it("rejects invalid local fixture provisioning fields before service dispatch", async () => {
    const response = await request(app)
      .post("/sandboxes")
      .send({ image: 42 });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("invalid_request");
    expect(service.create).not.toHaveBeenCalled();
  });

  it("validates unsafe command cwd", async () => {
    const response = await request(app)
      .post("/sandboxes/s1/commands")
      .send({ command: "pwd", cwd: "/tmp" });
    expect(response.status).toBe(422);
  });

  it("rejects non-string command environment values before service dispatch", async () => {
    const response = await request(app)
      .post("/sandboxes/s1/commands")
      .send({ command: "env", env: { BAD: 1 } });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("invalid_request");
    expect(service.startCommand).not.toHaveBeenCalled();
  });

  it("maps a missing fixture provisioning failure to a safe API error", async () => {
    const failingService = {
      create: vi
        .fn()
        .mockRejectedValue(
          new ServiceError(
            "fixture_missing",
            "Local fixture repo was not found",
            500,
          ),
        ),
    } as unknown as SandboxService;
    const response = await request(createApp(failingService, hub))
      .post("/sandboxes")
      .send({ fixtureRepoPath: "./missing" });
    expect(response.status).toBe(500);
    expect(response.body.error).toEqual(
      expect.objectContaining({ code: "fixture_missing" }),
    );
  });
});
