import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chatSessionRouter } from "../src/routes/chat-session.routes";
import { sseHub } from "../src/services/events/sse-hub";
import { chatSessionService } from "../src/services/chat/chat-session";
import { ServiceError } from "../src/shared/errors";
import type {
  ChatMessage,
  ChatSession,
  CreateMessageResponse,
  RunSnapshot,
} from "../src/types/chat.types";
import type { PublicEvent } from "../src/types/event.types";

const session: ChatSession = {
  chatSessionId: "chat_1",
  title: "Fix tests",
  repo: {
    source: "fixture",
    ref: "./repo",
    provider: null,
    owner: null,
    name: null,
    repoId: null,
    defaultBranch: null,
    installationId: null,
  },
  status: "active",
  sandboxId: null,
  eventsUrl: "/chat-sessions/chat_1/events",
  messagesUrl: "/chat-sessions/chat_1/messages",
  latestRun: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const run: RunSnapshot = {
  taskRunId: "run_1",
  chatSessionId: "chat_1",
  triggerMessageId: "msg_1",
  status: "created",
  sandboxId: null,
  resultUrl: "/chat-sessions/chat_1/runs/run_1/result",
  eventsUrl: "/chat-sessions/chat_1/runs/run_1/events",
  createdAt: "2026-01-01T00:00:00.000Z",
  provisioningAt: null,
  runningAt: null,
  completedAt: null,
  failure: null,
};

const message: ChatMessage = {
  messageId: "msg_1",
  chatSessionId: "chat_1",
  role: "user",
  content: "Fix the tests",
  taskRunId: "run_1",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const event: PublicEvent = {
  id: "evt_1",
  streamId: "chat_1",
  streamScope: "session",
  domain: "session",
  sessionId: "chat_1",
  runId: null,
  taskId: null,
  messageId: null,
  artifactId: null,
  sandboxId: null,
  commandId: null,
  sequence: 1,
  type: "session_created",
  producerService: "task",
  producerId: "chat_1",
  correlationId: null,
  payload: {},
  createdAt: "2026-01-01T00:00:00.000Z",
};

const makeApp = () => {
  const app = express();
  app.use(express.json());
  app.use(chatSessionRouter);
  app.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      const serviceError = error instanceof ServiceError ? error : null;
      response.status(serviceError?.status ?? 500).json({
        error: {
          code: serviceError?.code ?? "internal_error",
          details: serviceError?.details ?? {},
        },
      });
    },
  );
  return app;
};

afterEach(() => {
  sseHub.closeAll();
  vi.restoreAllMocks();
});

describe("chat session routes", () => {
  it("strictly validates session creation and dispatches repo scope", async () => {
    const create = vi
      .spyOn(chatSessionService, "createSession")
      .mockResolvedValue(session);
    const response = await request(makeApp())
      .post("/chat-sessions")
      .send({
        repo: { source: "fixture", ref: "./repo" },
        title: "Fix tests",
        extra: true,
      });

    expect(response.status).toBe(400);
    expect(create).not.toHaveBeenCalled();

    const valid = await request(makeApp())
      .post("/chat-sessions")
      .send({
        repo: { source: "fixture", ref: "./repo" },
        title: "Fix tests",
      });
    expect(valid.status).toBe(201);
    expect(create).toHaveBeenCalledWith({
      repo: {
        source: "fixture",
        ref: "./repo",
      },
      title: "Fix tests",
    });
  });

  it("returns the temporary GitHub integration-unavailable response", async () => {
    const create = vi
      .spyOn(chatSessionService, "createSession")
      .mockRejectedValue(
        new ServiceError(
          "repo_source_not_supported",
          "GitHub repositories are not supported yet",
          501,
        ),
      );

    const response = await request(makeApp())
      .post("/chat-sessions")
      .send({
        repo: {
          source: "github",
          ref: "github:octo/repo",
          provider: "github",
          owner: "octo",
          name: "repo",
          repoId: "1",
          defaultBranch: "main",
          installationId: "2",
        },
      });

    expect(response.status).toBe(501);
    expect(response.body.error).toMatchObject({
      code: "repo_source_not_supported",
    });
    expect(create).toHaveBeenCalledWith({
      repo: {
        source: "github",
        ref: "github:octo/repo",
        provider: "github",
        owner: "octo",
        name: "repo",
        repoId: "1",
        defaultBranch: "main",
        installationId: "2",
      },
    });
  });

  it("lists sessions and messages with validated pagination", async () => {
    const listSessions = vi
      .spyOn(chatSessionService, "listSessions")
      .mockResolvedValue({ items: [], nextCursor: null });
    const listMessages = vi
      .spyOn(chatSessionService, "listMessages")
      .mockResolvedValue({ items: [message], nextCursor: null });

    await expect(
      request(makeApp()).get(
        "/chat-sessions?limit=25&repoSource=fixture&repoRef=./repo",
      ),
    ).resolves.toMatchObject({ status: 200, body: { items: [] } });
    await expect(
      request(makeApp()).get("/chat-sessions/chat_1/messages?limit=10"),
    ).resolves.toMatchObject({ status: 200, body: { items: [message] } });

    expect(listSessions).toHaveBeenCalledWith({
      limit: 25,
      repoSource: "fixture",
      repoRef: "./repo",
    });
    expect(listMessages).toHaveBeenCalledWith("chat_1", { limit: 10 });
  });

  it("creates a message and run by default, or a message only when requested", async () => {
    const append = vi
      .spyOn(chatSessionService, "appendMessage")
      .mockResolvedValue({
        message,
        run,
        eventsUrl: session.eventsUrl,
      });

    const response = await request(makeApp())
      .post("/chat-sessions/chat_1/messages")
      .send({ content: "Fix the tests" });
    expect(response.status).toBe(202);
    expect(response.body).toEqual({
      message,
      run,
      eventsUrl: session.eventsUrl,
    });

    append.mockResolvedValueOnce({
      message: { ...message, taskRunId: null },
      run: null,
      eventsUrl: session.eventsUrl,
    } satisfies CreateMessageResponse);
    const messageOnly = await request(makeApp())
      .post("/chat-sessions/chat_1/messages")
      .send({ content: "Keep this for later", startRun: false });
    expect(messageOnly.status).toBe(201);
    expect(append).toHaveBeenLastCalledWith("chat_1", {
      content: "Keep this for later",
      startRun: false,
    });
  });

  it("returns the active-run conflict without persisting a second run", async () => {
    vi.spyOn(chatSessionService, "appendMessage").mockRejectedValue(
      new ServiceError(
        "session_run_in_progress",
        "A run is already active for this chat session",
        409,
        {
          taskRunId: "run_1",
          eventsUrl: run.eventsUrl,
        },
      ),
    );
    const response = await request(makeApp())
      .post("/chat-sessions/chat_1/messages")
      .send({ content: "Another request" });

    expect(response.status).toBe(409);
    expect(response.body.error).toMatchObject({
      code: "session_run_in_progress",
      details: { taskRunId: "run_1" },
    });
  });

  it("replays session SSE and run SSE through scoped streams", async () => {
    const runEvent = {
      ...event,
      streamId: "run_1",
      streamScope: "run",
      runId: "run_1",
    };
    vi.spyOn(chatSessionService, "sessionEventsAfter").mockResolvedValue([
      event,
    ]);
    vi.spyOn(chatSessionService, "runEventsAfter").mockResolvedValue([
      runEvent,
    ]);
    vi.spyOn(sseHub, "finishReplay").mockImplementation(
      (_scope, _streamId, client, _last) => client.response.end(),
    );

    const sessionResponse = await request(makeApp()).get(
      "/chat-sessions/chat_1/events?after=0",
    );
    const runResponse = await request(makeApp()).get(
      "/chat-sessions/chat_1/runs/run_1/events?after=0",
    );

    expect(sessionResponse.status).toBe(200);
    expect(sessionResponse.headers["content-type"]).toContain(
      "text/event-stream",
    );
    expect(sessionResponse.text).toContain("event: session_created");
    expect(runResponse.status).toBe(200);
    expect(runResponse.text).toContain('"streamScope":"run"');
  });

  it("hides cross-session runs and gates non-terminal results", async () => {
    vi.spyOn(chatSessionService, "getRun").mockRejectedValue(
      new ServiceError("run_not_found", "Run was not found", 404),
    );
    const missing = await request(makeApp()).get(
      "/chat-sessions/chat_2/runs/run_1",
    );
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("run_not_found");

    vi.spyOn(chatSessionService, "result").mockRejectedValue(
      new ServiceError(
        "run_not_terminal",
        "Run result is not available until the run is terminal",
        409,
      ),
    );
    const active = await request(makeApp()).get(
      "/chat-sessions/chat_1/runs/run_1/result",
    );
    expect(active.status).toBe(409);
    expect(active.body.error.code).toBe("run_not_terminal");
  });

  it("cancels an active run asynchronously", async () => {
    const cancel = vi.spyOn(chatSessionService, "cancelRun").mockResolvedValue({
      taskRunId: "run_1",
      status: "cancelling",
      eventsUrl: run.eventsUrl,
    });
    const response = await request(makeApp()).delete(
      "/chat-sessions/chat_1/runs/run_1",
    );

    expect(response.status).toBe(202);
    expect(response.body).toEqual({
      taskRunId: "run_1",
      status: "cancelling",
      eventsUrl: run.eventsUrl,
    });
    expect(cancel).toHaveBeenCalledWith("chat_1", "run_1");
  });

  it("fetches full artifact content on demand, scoped to the session", async () => {
    const getArtifact = vi
      .spyOn(chatSessionService, "getArtifact")
      .mockResolvedValue({
        artifactId: "art_1",
        sessionId: "chat_1",
        runId: "run_1",
        kind: "diff",
        contentType: "text/x-diff",
        content: "diff --git a/x b/x",
        byteSize: 19,
        truncated: false,
        redacted: false,
        createdAt: "2026-01-01T00:00:00.000Z",
      });

    const response = await request(makeApp()).get(
      "/chat-sessions/chat_1/artifacts/art_1",
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      artifactId: "art_1",
      content: "diff --git a/x b/x",
    });
    expect(getArtifact).toHaveBeenCalledWith("chat_1", "art_1");
  });

  it("returns not_found when the artifact does not belong to the session", async () => {
    vi.spyOn(chatSessionService, "getArtifact").mockRejectedValue(
      new ServiceError("artifact_not_found", "Artifact was not found", 404),
    );

    const response = await request(makeApp()).get(
      "/chat-sessions/chat_2/artifacts/art_1",
    );

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("artifact_not_found");
  });
});
