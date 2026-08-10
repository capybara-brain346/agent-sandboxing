import express, { type NextFunction, type Request, type Response } from "express";
import type { SandboxService } from "./services/sandbox-service/sandbox-service";
import type { SseHub } from "./services/sandbox-service/sse-hub";
import { registerSandboxRoutes } from "./routes/sandbox-service/routes";
import { ServiceError } from "./shared/errors";

export const createApp = (
  service: SandboxService,
  hub: SseHub,
): express.Express => {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));
  app.get("/health", (_request, response) => response.json({ status: "ok" }));
  registerSandboxRoutes(app, service, hub);
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
