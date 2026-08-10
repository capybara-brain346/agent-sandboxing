import { PrismaClient } from "@prisma/client";
import { createApp } from "./app";
import { CommandExecutionService } from "./command-execution-service";
import { loadConfig } from "./config";
import { EventStore } from "./event-store";
import { DockerSandboxRuntime } from "./runtime";
import { SandboxLifecycleService } from "./sandbox-lifecycle-service";
import { SandboxService } from "./sandbox-service";
import { SseHub } from "./sse-hub";

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
const server = createApp(service, hub).listen(config.PORT, () =>
  console.log(JSON.stringify({ event: "server_started", port: config.PORT })),
);
const shutdown = async (signal: string): Promise<void> => {
  console.log(JSON.stringify({ event: "server_stopping", signal }));
  server.close();
  await prisma.$disconnect();
};
process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.once("SIGINT", () => {
  void shutdown("SIGINT");
});
