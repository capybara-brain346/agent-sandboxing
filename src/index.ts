import { createServer } from "./server";

const { app, config, prisma } = createServer();

const server = app.listen(config.PORT, () =>
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
