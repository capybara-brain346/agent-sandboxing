import { PrismaClient } from "@prisma/client";
import { createApp } from "./app";
import { CommandExecutionService } from "./services/sandbox-service/command-execution-service";
import { loadConfig } from "./config";
import { EventStore } from "./services/sandbox-service/event-store";
import { DockerSandboxRuntime } from "./services/sandbox-service/runtime";
import { SandboxLifecycleService } from "./services/sandbox-service/sandbox-lifecycle-service";
import { SandboxService } from "./services/sandbox-service/sandbox-service";
import { SseHub } from "./services/sandbox-service/sse-hub";

export const createServer = () => {
  const config = loadConfig();
  const prisma = new PrismaClient();
  const hub = new SseHub();
  const events = new EventStore(prisma);
  const runtime = new DockerSandboxRuntime(config);
  const publish = (event: Parameters<SseHub["publish"]>[0]): void =>
    hub.publish(event);
  const lifecycle = new SandboxLifecycleService(
    prisma,
    events,
    runtime,
    config,
    publish,
  );
  const commands = new CommandExecutionService(
    prisma,
    events,
    runtime,
    config,
    publish,
  );
  const service = new SandboxService(lifecycle, commands);
  return { app: createApp(service, hub), config, prisma };
};
