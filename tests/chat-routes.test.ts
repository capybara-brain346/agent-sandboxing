import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chatSessionRouter } from "../src/routes/chat-session.routes";
import { sseHub } from "../src/services/events/sse-hub";
import { chatSessionService } from "../src/services/chat/chat-session";
import { ServiceError } from "../src/shared/errors";
import { loadConfig } from "../src/config";
import { AUTH_COOKIE_NAME, signSessionToken } from "../src/services/auth/auth";
import type { ChatMessage, ChatSession } from "../src/types/chat.types";
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
    baseBranch: null,
    baseSha: null,
  },
  status: "active",
  activeMessageId: null,
  sandboxId: null,
  eventsUrl: "/chat-sessions/chat_1/events",
  messagesUrl: "/chat-sessions/chat_1/messages",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const message: ChatMessage = {
  messageId: "msg_1",
  chatSessionId: "chat_1",
  role: "user",
  content: "Fix the tests",
  processingStatus: "queued",
  processingStartedAt: null,
  processingCompletedAt: null,
  failure: null,
  agentSummary: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const event: PublicEvent = {
  id: "evt_1",
  streamId: "chat_1",
  streamScope: "session",
  domain: "message",
  sessionId: "chat_1",
  messageId: "msg_1",
  artifactId: null,
  sandboxId: null,
  commandId: null,
  sequence: 1,
  type: "message_processing_started",
  producerService: "chat",
  producerId: "msg_1",
  correlationId: null,
  payload: {},
  createdAt: "2026-01-01T00:00:00.000Z",
};

const config = loadConfig();
const authCookie = `${AUTH_COOKIE_NAME}=${await signSessionToken(
  {
    sub: "user_1",
    login: "octo",
    avatarUrl: "https://github.com/octo.png",
    email: null,
  },
  config.AUTH_COOKIE_SECRET,
)}`;

const makeApp = () => {
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    request.headers.cookie = authCookie;
    request.headers.origin = config.APP_BASE_URL;
    next();
  });
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
  it("validates session creation and dispatches the repository scope", async () => {
    const create = vi
      .spyOn(chatSessionService, "createSession")
      .mockResolvedValue(session);

    const invalid = await request(makeApp())
      .post("/chat-sessions")
      .send({
        repo: { source: "fixture", ref: "./repo" },
        extra: true,
      });
    expect(invalid.status).toBe(400);
    expect(create).not.toHaveBeenCalled();

    const valid = await request(makeApp())
      .post("/chat-sessions")
      .send({
        repo: { source: "fixture", ref: "./repo" },
        title: "Fix tests",
      });
    expect(valid.status).toBe(201);
    expect(create).toHaveBeenCalledWith("user_1", {
      repo: { source: "fixture", ref: "./repo" },
      title: "Fix tests",
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

    expect(listSessions).toHaveBeenCalledWith("user_1", {
      limit: 25,
      repoSource: "fixture",
      repoRef: "./repo",
    });
    expect(listMessages).toHaveBeenCalledWith("user_1", "chat_1", {
      limit: 10,
    });
  });

  it("appends a message and returns session-first URLs", async () => {
    const append = vi
      .spyOn(chatSessionService, "appendMessage")
      .mockResolvedValue({
        message,
        sessionUrl: "/chat-sessions/chat_1",
        messagesUrl: session.messagesUrl,
        eventsUrl: session.eventsUrl,
      });

    const response = await request(makeApp())
      .post("/chat-sessions/chat_1/messages")
      .send({ content: "Fix the tests" });

    expect(response.status).toBe(202);
    expect(response.body).toEqual({
      message,
      sessionUrl: "/chat-sessions/chat_1",
      messagesUrl: session.messagesUrl,
      eventsUrl: session.eventsUrl,
    });
    expect(append).toHaveBeenCalledWith("user_1", "chat_1", {
      content: "Fix the tests",
    });
  });

  it("returns the active-message conflict", async () => {
    vi.spyOn(chatSessionService, "appendMessage").mockRejectedValue(
      new ServiceError(
        "session_message_in_progress",
        "A message is already active",
        409,
        { activeMessageId: "msg_1", eventsUrl: session.eventsUrl },
      ),
    );

    const response = await request(makeApp())
      .post("/chat-sessions/chat_1/messages")
      .send({ content: "Another request" });

    expect(response.status).toBe(409);
    expect(response.body.error).toMatchObject({
      code: "session_message_in_progress",
      details: { activeMessageId: "msg_1" },
    });
  });

  it("replays session events", async () => {
    vi.spyOn(chatSessionService, "sessionEventsAfter").mockResolvedValue([
      event,
    ]);
    vi.spyOn(sseHub, "finishReplay").mockImplementation((_streamId, client) =>
      client.response.end(),
    );

    const response = await request(makeApp()).get(
      "/chat-sessions/chat_1/events?after=0",
    );

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.text).toContain("event: message_processing_started");
  });

  it("returns the latest session result", async () => {
    const result = {
      messageId: "msg_1",
      chatSessionId: "chat_1",
      status: "completed" as const,
      diff: "",
      artifacts: [],
      agentSummary: "done",
      exitReason: "completed" as const,
      failure: null,
      pullRequest: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:01.000Z",
    };
    vi.spyOn(chatSessionService, "sessionResult").mockResolvedValue(result);

    const response = await request(makeApp()).get(
      "/chat-sessions/chat_1/result",
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual(result);
  });

  it("returns the current pull request", async () => {
    const currentPullRequest = vi
      .spyOn(chatSessionService, "currentPullRequest")
      .mockResolvedValue({
        provider: "github",
        url: "https://github.com/octo/repo/pull/7",
        number: 7,
        branch: "agent/chat_1",
        baseBranch: "main",
        title: "Fix it",
        status: "open",
        draft: false,
        failure: null,
      });

    const response = await request(makeApp()).get(
      "/chat-sessions/chat_1/pull-request",
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      branch: "agent/chat_1",
      status: "open",
    });
    expect(currentPullRequest).toHaveBeenCalledWith("user_1", "chat_1");
  });

  it("cancels the active message", async () => {
    const cancel = vi
      .spyOn(chatSessionService, "cancelCurrentMessage")
      .mockResolvedValue({
        messageId: "msg_1",
        status: "cancelling",
        eventsUrl: session.eventsUrl,
      });

    const response = await request(makeApp()).post(
      "/chat-sessions/chat_1/cancel",
    );

    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({
      messageId: "msg_1",
      status: "cancelling",
    });
    expect(cancel).toHaveBeenCalledWith("user_1", "chat_1");
  });

  it("fetches full artifact content scoped to the session", async () => {
    const getArtifact = vi
      .spyOn(chatSessionService, "getArtifact")
      .mockResolvedValue({
        artifactId: "art_1",
        sessionId: "chat_1",
        messageId: "msg_1",
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
    expect(response.body.content).toBe("diff --git a/x b/x");
    expect(getArtifact).toHaveBeenCalledWith("user_1", "chat_1", "art_1");
  });
});
