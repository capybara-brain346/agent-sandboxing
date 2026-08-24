import { loadConfig } from "./config";
import { logger } from "./logger";
import { createApp } from "./server";
import { prisma } from "./db/prisma";
import { sseHub } from "./services/events/sse-hub";
import { shutdownTaskServiceTracing } from "./services/task/task";

const config = loadConfig();
const app = createApp();

const server = app.listen(config.PORT, () => {
  logger.info("server_started", { port: config.PORT, env: config.NODE_ENV });
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    logger.error("port_in_use", { port: config.PORT });
  } else {
    logger.error("server_error", {
      message: error.message,
      stack: error.stack,
    });
  }
  process.exit(1);
});

let shuttingDown = false;

const shutdown = async (signal: string): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info("server_stopping", { signal });
  const forceExit = setTimeout(() => {
    logger.error("shutdown_timed_out", {
      timeoutMs: config.SHUTDOWN_TIMEOUT_MS,
    });
    process.exit(1);
  }, config.SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  try {
    sseHub.closeAll();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await shutdownTaskServiceTracing();
    await prisma.$disconnect();
    clearTimeout(forceExit);
    logger.info("server_stopped", { signal });
    process.exit(0);
  } catch (error) {
    clearTimeout(forceExit);
    logger.error("shutdown_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
};

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

process.on("uncaughtException", (error) => {
  logger.error("uncaught_exception", {
    message: error.message,
    stack: error.stack,
  });
  void shutdown("uncaughtException");
});

process.on("unhandledRejection", (reason) => {
  logger.error("unhandled_rejection", {
    reason: reason instanceof Error ? reason.message : String(reason),
  });
  void shutdown("unhandledRejection");
});
