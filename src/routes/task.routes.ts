import { Router } from "express";
import { ServiceError } from "../shared/errors";
import { taskService } from "../services/task/task";
import {
  createTaskSchema,
  type PublicTaskEvent,
  type TaskServicePort,
} from "../types/task.types";

const parseCursor = (raw: string | undefined): number => {
  const cursor = Number(raw ?? "0");
  if (
    (raw !== undefined && raw.trim() === "") ||
    !Number.isSafeInteger(cursor) ||
    cursor < 0
  )
    throw new ServiceError(
      "invalid_cursor",
      "Event cursor must be a non-negative integer",
    );
  return cursor;
};

const taskIdFrom = (value: string | string[]): string =>
  Array.isArray(value) ? value[0] ?? "" : value;

const writeEvent = (response: {
  write(chunk: string): boolean;
}, event: PublicTaskEvent): void => {
  response.write(
    `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
  );
};

export const createTaskRouter = (
  service: TaskServicePort = taskService,
): Router => {
  const router = Router();

  router.post("/tasks", async (request, response, next) => {
    try {
      const parsed = createTaskSchema.safeParse(request.body ?? {});
      if (!parsed.success)
        throw new ServiceError("invalid_request", "Request body is invalid", 400, {
          issues: parsed.error.issues,
        });
      const result = await service.create(parsed.data);
      response.status(202).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/tasks/:taskId", async (request, response, next) => {
    try {
      response.json(await service.get(taskIdFrom(request.params.taskId)));
    } catch (error) {
      next(error);
    }
  });

  router.get("/tasks/:taskId/events", async (request, response, next) => {
    try {
      const taskId = taskIdFrom(request.params.taskId);
      const queryAfter = request.query.after;
      const rawAfter =
        queryAfter === undefined
          ? request.header("Last-Event-ID") ?? undefined
          : typeof queryAfter === "string"
            ? queryAfter
            : "invalid";
      const after = parseCursor(rawAfter);
      const events = await service.eventsAfter(taskId, after);

      response.status(200).set({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      response.flushHeaders();
      for (const event of events) writeEvent(response, event);
      response.end();
    } catch (error) {
      if (!response.headersSent) next(error);
      else response.end();
    }
  });

  router.get("/tasks/:taskId/result", async (request, response, next) => {
    try {
      response.json(await service.result(taskIdFrom(request.params.taskId)));
    } catch (error) {
      next(error);
    }
  });

  router.delete("/tasks/:taskId", async (request, response, next) => {
    try {
      const result = await service.cancel(taskIdFrom(request.params.taskId));
      response.status(result.status === "cancelling" ? 202 : 200).json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
};

export const taskRouter = createTaskRouter();
