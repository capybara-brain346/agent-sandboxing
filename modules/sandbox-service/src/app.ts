import express, { type NextFunction, type Request, type Response } from "express";
import {
  parseCommandRequest,
  parseCreateSandboxRequest,
} from "./contracts";
import type { SandboxService } from "./sandbox-service";
import type { SseHub } from "./sse-hub";
import { ServiceError } from "./errors";

const id = (request: Request): string => request.params.id as string;

export const createApp = (
  service: SandboxService,
  hub: SseHub,
): express.Express => {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));
  app.get("/health", (_request, response) => response.json({ status: "ok" }));
  app.post("/sandboxes", async (request, response, next) => {
    try {
      const result = await service.create(
        parseCreateSandboxRequest(request.body),
      );
      response.status(202).json(result);
    } catch (error) {
      next(error);
    }
  });
  app.get("/sandboxes/:id", async (request, response, next) => {
    try {
      response.json(await service.get(id(request)));
    } catch (error) {
      next(error);
    }
  });
  app.get("/sandboxes/:id/events", async (request, response, next) => {
    try {
      const raw =
        typeof request.query.after === "string"
          ? request.query.after
          : (request.header("Last-Event-ID") ?? "0");
      const after = Number(raw);
      if (!Number.isSafeInteger(after) || after < 0)
        throw new ServiceError(
          "invalid_cursor",
          "Event cursor must be a non-negative integer",
        );
      const sandboxId = id(request);
      if (!(await service.has(sandboxId)))
        throw new ServiceError(
          "sandbox_not_found",
          "Sandbox was not found",
          404,
        );
      response.status(200).set({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      response.flushHeaders();
      const client = hub.subscribe(sandboxId, response, after);
      const events = await service.eventsAfter(sandboxId, after);
      for (const event of events)
        response.write(
          `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
        );
      hub.finishReplay(sandboxId, client, events.at(-1)?.sequence ?? after);
      const timer = setInterval(() => {
        if (!response.writableEnded) response.write(": keepalive\n\n");
      }, 15000);
      response.on("close", () => clearInterval(timer));
    } catch (error) {
      if (!response.headersSent) next(error);
      else response.end();
    }
  });
  app.post("/sandboxes/:id/commands", async (request, response, next) => {
    try {
      response
        .status(202)
        .json(
          await service.startCommand(
            id(request),
            parseCommandRequest(request.body),
          ),
        );
    } catch (error) {
      next(error);
    }
  });
  app.get(
    "/sandboxes/:id/commands/:commandId",
    async (request, response, next) => {
      try {
        response.json(
          await service.getCommand(
            id(request),
            request.params.commandId as string,
          ),
        );
      } catch (error) {
        next(error);
      }
    },
  );
  app.get("/sandboxes/:id/diff", async (request, response, next) => {
    try {
      response.json(await service.diff(id(request)));
    } catch (error) {
      next(error);
    }
  });
  app.delete("/sandboxes/:id", async (request, response, next) => {
    try {
      response.json(await service.stop(id(request)));
    } catch (error) {
      next(error);
    }
  });
  app.use((_request, _response, next) =>
    next(new ServiceError("not_found", "Route was not found", 404)),
  );
  app.use(
    (
      error: unknown,
      _request: Request,
      response: Response,
      _next: NextFunction,
    ) => {
      const serviceError =
        error instanceof ServiceError
          ? error
          : new ServiceError("internal_error", "Internal server error", 500);
      response.status(serviceError.status).json({
        error: {
          code: serviceError.code,
          message: serviceError.message,
          details: serviceError.details,
        },
      });
    },
  );
  return app;
};
