import { Router, type Request, type Response } from "express";
import { ServiceError } from "../shared/errors";
import { logger } from "../logger";
import { chatSessionService } from "../services/chat/chat-session";
import { sseHub, type SseHub } from "../services/events/sse-hub";
import {
  createChatSessionSchema,
  createMessageSchema,
  listSessionQuerySchema,
  messagePageQuerySchema,
  pageQuerySchema,
  updateChatSessionSchema,
} from "../types/chat.types";
import { parseSseCursor, startSseKeepalive, writeSseEvent } from "./sse";

export const chatSessionRouter = Router();

const invalidRequest = (error: { issues: unknown[] }): ServiceError =>
  new ServiceError("invalid_request", "Request is invalid", 400, {
    issues: error.issues,
  });

const sse = async (
  request: Request,
  response: Response,
  scope: "session" | "run",
  streamId: string,
  eventsAfter: (
    after: number,
  ) => Promise<
    Awaited<ReturnType<typeof chatSessionService.sessionEventsAfter>>
  >,
): Promise<void> => {
  const startedAt = process.hrtime.bigint();
  let client: ReturnType<SseHub["subscribe"]> | undefined;
  let keepalive: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  let subscribed = false;
  let replayCompleted = false;
  let replayEventCount = 0;
  let after = 0;
  let lastSequence = 0;
  const clearKeepalive = (): void => {
    if (keepalive !== undefined) clearInterval(keepalive);
  };
  const onClose = (): void => {
    if (closed || !subscribed) return;
    closed = true;
    clearKeepalive();
    if (client !== undefined) sseHub.unsubscribe(scope, streamId, client);
    logger.debug("sse_connection_closed", {
      requestId: request.id,
      scope,
      streamId,
      after,
      replayCompleted,
      replayEventCount,
      lastSequence: Math.max(lastSequence, client?.lastSent ?? after),
      durationMs: Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6),
    });
  };

  try {
    const queryAfter = request.query.after;
    const rawAfter =
      queryAfter === undefined
        ? (request.header("Last-Event-ID") ?? undefined)
        : typeof queryAfter === "string"
          ? queryAfter
          : "invalid";
    after = parseSseCursor(rawAfter);
    lastSequence = after;
    client = sseHub.subscribe(scope, streamId, response, after);
    subscribed = true;
    logger.debug("sse_subscribed", {
      requestId: request.id,
      scope,
      streamId,
      after,
    });
    response.on("close", onClose);
    const events = await eventsAfter(after);
    replayEventCount = events.length;
    lastSequence = events.at(-1)?.sequence ?? after;
    if (closed || response.writableEnded || response.destroyed) {
      sseHub.unsubscribe(scope, streamId, client);
      return;
    }
    response.status(200).set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.flushHeaders();
    for (const event of events) writeSseEvent(response, event);
    sseHub.finishReplay(
      scope,
      streamId,
      client,
      events.at(-1)?.sequence ?? after,
    );
    replayCompleted = true;
    logger.debug("sse_replay_completed", {
      requestId: request.id,
      scope,
      streamId,
      after,
      eventCount: events.length,
      lastSequence,
      durationMs: Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6),
    });
    if (closed || response.writableEnded || response.destroyed) return;
    keepalive = startSseKeepalive(response);
  } catch (error) {
    onClose();
    if (!response.headersSent) throw error;
    response.end();
  }
};

chatSessionRouter.post("/chat-sessions", async (request, response, next) => {
  try {
    const parsed = createChatSessionSchema.safeParse(request.body ?? {});
    if (!parsed.success) throw invalidRequest(parsed.error);
    response
      .status(201)
      .json(await chatSessionService.createSession(parsed.data));
  } catch (error) {
    next(error);
  }
});

chatSessionRouter.get("/chat-sessions", async (request, response, next) => {
  try {
    const parsed = listSessionQuerySchema.safeParse(request.query);
    if (!parsed.success) throw invalidRequest(parsed.error);
    response.json(await chatSessionService.listSessions(parsed.data));
  } catch (error) {
    next(error);
  }
});

chatSessionRouter.get(
  "/chat-sessions/:sessionId",
  async (request, response, next) => {
    try {
      response.json(
        await chatSessionService.getSession(request.params.sessionId),
      );
    } catch (error) {
      next(error);
    }
  },
);

chatSessionRouter.patch(
  "/chat-sessions/:sessionId",
  async (request, response, next) => {
    try {
      const parsed = updateChatSessionSchema.safeParse(request.body ?? {});
      if (!parsed.success) throw invalidRequest(parsed.error);
      response.json(
        await chatSessionService.updateSession(
          request.params.sessionId,
          parsed.data,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

chatSessionRouter.get(
  "/chat-sessions/:sessionId/messages",
  async (request, response, next) => {
    try {
      const parsed = messagePageQuerySchema.safeParse(request.query);
      if (!parsed.success) throw invalidRequest(parsed.error);
      response.json(
        await chatSessionService.listMessages(
          request.params.sessionId,
          parsed.data,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

chatSessionRouter.post(
  "/chat-sessions/:sessionId/messages",
  async (request, response, next) => {
    try {
      const parsed = createMessageSchema.safeParse(request.body ?? {});
      if (!parsed.success) throw invalidRequest(parsed.error);
      const result = await chatSessionService.appendMessage(
        request.params.sessionId,
        parsed.data,
      );
      response.status(result.run ? 202 : 201).json(result);
    } catch (error) {
      next(error);
    }
  },
);

chatSessionRouter.get(
  "/chat-sessions/:sessionId/runs",
  async (request, response, next) => {
    try {
      const parsed = pageQuerySchema.safeParse(request.query);
      if (!parsed.success) throw invalidRequest(parsed.error);
      response.json(
        await chatSessionService.listRuns(
          request.params.sessionId,
          parsed.data,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

chatSessionRouter.get(
  "/chat-sessions/:sessionId/runs/:runId",
  async (request, response, next) => {
    try {
      response.json(
        await chatSessionService.getRun(
          request.params.sessionId,
          request.params.runId,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

chatSessionRouter.get(
  "/chat-sessions/:sessionId/runs/:runId/result",
  async (request, response, next) => {
    try {
      response.json(
        await chatSessionService.result(
          request.params.sessionId,
          request.params.runId,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

chatSessionRouter.delete(
  "/chat-sessions/:sessionId/runs/:runId",
  async (request, response, next) => {
    try {
      const result = await chatSessionService.cancelRun(
        request.params.sessionId,
        request.params.runId,
      );
      response.status(result.status === "cancelling" ? 202 : 200).json(result);
    } catch (error) {
      next(error);
    }
  },
);

chatSessionRouter.get(
  "/chat-sessions/:sessionId/events",
  async (request, response, next) => {
    try {
      await sse(
        request,
        response,
        "session",
        request.params.sessionId,
        (after) =>
          chatSessionService.sessionEventsAfter(
            request.params.sessionId,
            after,
          ),
      );
    } catch (error) {
      next(error);
    }
  },
);

chatSessionRouter.get(
  "/chat-sessions/:sessionId/artifacts/:artifactId",
  async (request, response, next) => {
    try {
      response.json(
        await chatSessionService.getArtifact(
          request.params.sessionId,
          request.params.artifactId,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

chatSessionRouter.get(
  "/chat-sessions/:sessionId/runs/:runId/events",
  async (request, response, next) => {
    try {
      await sse(request, response, "run", request.params.runId, (after) =>
        chatSessionService.runEventsAfter(
          request.params.sessionId,
          request.params.runId,
          after,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);
