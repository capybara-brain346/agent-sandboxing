import { Router } from "express";
import { z } from "zod";
import { ServiceError } from "../shared/errors";
import { isWorkspacePath } from "../services/sandbox/workspace";
import { sandboxService } from "../services/sandbox/sandbox-service";
import { sseHub } from "../services/sandbox/sse-hub";

const createSandboxSchema = z
  .object({
    fixtureRepoPath: z.string().min(1).optional(),
    image: z.string().min(1).optional(),
  })
  .strict();

const commandRequestSchema = z
  .object({
    command: z.string(),
    cwd: z.string().optional(),
    env: z.record(z.string(), z.string()).optional(),
    timeoutMs: z.number().int().positive().optional(),
  })
  .strict();

export const sandboxRouter = Router();

sandboxRouter.post("/sandboxes", async (request, response, next) => {
  try {
    const parsed = createSandboxSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      const hasUnknownKey = parsed.error.issues.some(
        (issue) => issue.code === "unrecognized_keys",
      );
      throw new ServiceError(
        hasUnknownKey ? "unsupported_request" : "invalid_request",
        hasUnknownKey
          ? "Only local fixture provisioning fields are supported"
          : "Request body is invalid",
      );
    }
    const result = await sandboxService.create(parsed.data);
    response.status(202).json(result);
  } catch (error) {
    next(error);
  }
});

sandboxRouter.get("/sandboxes/:id", async (request, response, next) => {
  try {
    const sandbox = await sandboxService.get(request.params.id as string);
    response.json(sandbox);
  } catch (error) {
    next(error);
  }
});

sandboxRouter.get("/sandboxes/:id/events", async (request, response, next) => {
  try {
    const sandboxId = request.params.id as string;
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
    if (!(await sandboxService.has(sandboxId)))
      throw new ServiceError("sandbox_not_found", "Sandbox was not found", 404);

    response.status(200).set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.flushHeaders();

    const client = sseHub.subscribe(sandboxId, response, after);
    const events = await sandboxService.eventsAfter(sandboxId, after);
    for (const event of events)
      response.write(
        `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
      );
    sseHub.finishReplay(sandboxId, client, events.at(-1)?.sequence ?? after);

    const timer = setInterval(() => {
      if (!response.writableEnded) response.write(": keepalive\n\n");
    }, 15000);
    response.on("close", () => clearInterval(timer));
  } catch (error) {
    if (!response.headersSent) next(error);
    else response.end();
  }
});

sandboxRouter.post(
  "/sandboxes/:id/commands",
  async (request, response, next) => {
    try {
      const parsed = commandRequestSchema.safeParse(request.body);
      if (!parsed.success)
        throw new ServiceError("invalid_request", "Command request is invalid");
      if (parsed.data.cwd !== undefined && !isWorkspacePath(parsed.data.cwd))
        throw new ServiceError(
          "unsafe_command_request",
          "cwd must be under /workspace/repo",
          422,
        );
      const result = await sandboxService.startCommand(
        request.params.id as string,
        parsed.data,
      );
      response.status(202).json(result);
    } catch (error) {
      next(error);
    }
  },
);

sandboxRouter.get(
  "/sandboxes/:id/commands/:commandId",
  async (request, response, next) => {
    try {
      const command = await sandboxService.getCommand(
        request.params.id as string,
        request.params.commandId as string,
      );
      response.json(command);
    } catch (error) {
      next(error);
    }
  },
);

sandboxRouter.get("/sandboxes/:id/diff", async (request, response, next) => {
  try {
    const diff = await sandboxService.diff(request.params.id as string);
    response.json(diff);
  } catch (error) {
    next(error);
  }
});

sandboxRouter.delete("/sandboxes/:id", async (request, response, next) => {
  try {
    const result = await sandboxService.stop(request.params.id as string);
    response.json(result);
  } catch (error) {
    next(error);
  }
});
