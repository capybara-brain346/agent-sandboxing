import { Router } from "express";
import { ServiceError } from "../shared/errors";
import { taskService } from "../services/task/task";
import { sseHub, type SseHub } from "../services/events/sse-hub";
import { createTaskSchema } from "../types/task.types";
import { parseSseCursor, startSseKeepalive, writeSseEvent } from "./sse";

export const taskRouter = Router();

taskRouter.use((_request, response, next) => {
  response.set({
    Deprecation: "true",
    Link: '</chat-sessions>; rel="successor-version"',
  });
  next();
});

taskRouter.post("/tasks", async (request, response, next) => {
  try {
    const parsed = createTaskSchema.safeParse(request.body ?? {});
    if (!parsed.success)
      throw new ServiceError(
        "invalid_request",
        "Request body is invalid",
        400,
        {
          issues: parsed.error.issues,
        },
      );
    const result = await taskService.create(parsed.data);
    response.status(202).json(result);
  } catch (error) {
    next(error);
  }
});

taskRouter.get("/tasks/:taskId", async (request, response, next) => {
  try {
    response.json(await taskService.get(request.params.taskId));
  } catch (error) {
    next(error);
  }
});

taskRouter.get("/tasks/:taskId/events", async (request, response, next) => {
  let client: ReturnType<SseHub["subscribe"]> | undefined;
  let keepalive: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const clearKeepalive = (): void => {
    if (keepalive !== undefined) clearInterval(keepalive);
  };

  const onClose = (): void => {
    closed = true;
    clearKeepalive();
    if (client !== undefined) sseHub.unsubscribe(request.params.taskId, client);
  };

  try {
    const taskId = request.params.taskId;
    const queryAfter = request.query.after;
    const rawAfter =
      queryAfter === undefined
        ? (request.header("Last-Event-ID") ?? undefined)
        : typeof queryAfter === "string"
          ? queryAfter
          : "invalid";
    const after = parseSseCursor(rawAfter);

    client = sseHub.subscribe(taskId, response, after);
    response.on("close", onClose);
    const events = await taskService.eventsAfter(taskId, after);

    if (closed || response.writableEnded || response.destroyed) {
      sseHub.unsubscribe(taskId, client);
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

    sseHub.finishReplay(taskId, client, events.at(-1)?.sequence ?? after);

    if (closed || response.writableEnded || response.destroyed) return;
    keepalive = startSseKeepalive(response);
  } catch (error) {
    onClose();
    if (!response.headersSent) next(error);
    else response.end();
  }
});

taskRouter.get("/tasks/:taskId/result", async (request, response, next) => {
  try {
    response.json(await taskService.result(request.params.taskId));
  } catch (error) {
    next(error);
  }
});

taskRouter.delete("/tasks/:taskId", async (request, response, next) => {
  try {
    const result = await taskService.cancel(request.params.taskId);
    response.status(result.status === "cancelling" ? 202 : 200).json(result);
  } catch (error) {
    next(error);
  }
});
