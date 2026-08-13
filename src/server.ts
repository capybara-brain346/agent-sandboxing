import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { logger } from "./logger";
import { ServiceError } from "./shared/errors";
import { prisma } from "./db/prisma";
import { sandboxRouter } from "./routes/sandbox.routes";
import { taskRouter } from "./routes/task.routes";

const pkgVersion: string = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../package.json", import.meta.url)),
    "utf-8",
  ),
).version;

const requestContext = (
  request: Request,
  response: Response,
  next: NextFunction,
): void => {
  request.id = request.header("X-Request-Id") ?? randomUUID();
  response.set("X-Request-Id", request.id);
  const start = process.hrtime.bigint();
  response.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    logger.info("request_completed", {
      requestId: request.id,
      method: request.method,
      path: request.path,
      status: response.statusCode,
      durationMs: Math.round(durationMs),
    });
  });
  next();
};

const securityHeaders = (
  _request: Request,
  response: Response,
  next: NextFunction,
): void => {
  response.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
  });
  next();
};

const describeError = (error: unknown): Record<string, unknown> =>
  error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : { value: error };

const notFoundHandler = (
  _request: Request,
  _response: Response,
  next: NextFunction,
): void => next(new ServiceError("not_found", "Route was not found", 404));

const errorHandler = (
  error: unknown,
  request: Request,
  response: Response,
  _next: NextFunction,
): void => {
  const serviceError = error instanceof ServiceError ? error : null;
  if (!serviceError)
    logger.error("unhandled_request_error", {
      requestId: request.id,
      method: request.method,
      path: request.path,
      error: describeError(error),
    });

  const status = serviceError?.status ?? 500;
  response.status(status).json({
    error: {
      code: serviceError?.code ?? "internal_error",
      message: serviceError?.message ?? "Internal server error",
      details: serviceError?.details ?? {},
    },
  });
};

export const createApp = (): express.Express => {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(requestContext);
  app.use(securityHeaders);
  app.use(express.json({ limit: "32kb" }));

  app.get("/health", async (_request, response) => {
    const dbStart = process.hrtime.bigint();
    try {
      await prisma.$queryRaw`SELECT 1`;
      const dbLatencyMs =
        Number(process.hrtime.bigint() - dbStart) / 1e6;
      response.json({
        status: "ok",
        version: pkgVersion,
        uptimeSeconds: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
        checks: { database: { status: "ok", latencyMs: Math.round(dbLatencyMs) } },
      });
    } catch (error) {
      logger.error("health_check_failed", { error: describeError(error) });
      response.status(503).json({
        status: "unavailable",
        version: pkgVersion,
        uptimeSeconds: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
        checks: { database: { status: "unavailable" } },
      });
    }
  });

  app.use(sandboxRouter);
  app.use(taskRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
