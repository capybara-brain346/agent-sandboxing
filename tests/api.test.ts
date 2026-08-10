import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { ServiceError } from "../src/shared/errors";

vi.mock("../src/services/sandbox/sandbox-service", () => ({
  sandboxService: {
    create: vi.fn(),
    get: vi.fn(),
    has: vi.fn(),
    eventsAfter: vi.fn(),
    startCommand: vi.fn(),
    getCommand: vi.fn(),
    diff: vi.fn(),
    stop: vi.fn(),
  },
}));

vi.mock("../src/services/sandbox/sse-hub", () => ({
  sseHub: { subscribe: vi.fn(), finishReplay: vi.fn(), publish: vi.fn() },
}));

vi.mock("../src/db/prisma", () => ({
  prisma: { $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]) },
}));

const { createApp } = await import("../src/server");
const { sandboxService } = await import("../src/services/sandbox/sandbox-service");

describe("HTTP wiring", () => {
  const app = createApp();

  beforeEach(() => vi.clearAllMocks());

  it("reports health and returns async create", async () => {
    expect((await request(app).get("/health")).status).toBe(200);
    vi.mocked(sandboxService.create).mockResolvedValue({
      sandboxId: "s1",
      status: "creating",
      workspacePath: "/workspace/repo",
      eventsUrl: "/sandboxes/s1/events",
    });
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
    expect(sandboxService.create).not.toHaveBeenCalled();
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
    expect(sandboxService.startCommand).not.toHaveBeenCalled();
  });

  it("maps a missing fixture provisioning failure to a safe API error", async () => {
    vi.mocked(sandboxService.create).mockRejectedValue(
      new ServiceError(
        "fixture_missing",
        "Local fixture repo was not found",
        500,
      ),
    );
    const response = await request(app)
      .post("/sandboxes")
      .send({ fixtureRepoPath: "./missing" });
    expect(response.status).toBe(500);
    expect(response.body.error).toEqual(
      expect.objectContaining({ code: "fixture_missing" }),
    );
  });
});
