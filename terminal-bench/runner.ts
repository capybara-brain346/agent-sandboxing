import { readFile } from "node:fs/promises";
import {
  AgentRunner,
  type AgentRunnerSandbox,
} from "../src/services/agent/agent-runner";
import { loadConfig } from "../src/config";
import { resolveAgentModel } from "../src/services/agent/model";
import { LocalProcessRuntime } from "./runtime";

const instructionPath = process.argv[2];

const safeError = (): string => "Agent processing failed";

const main = async (): Promise<void> => {
  if (!instructionPath) throw new Error("instruction path is required");
  if (!process.env.OPENROUTER_API_KEY)
    throw new Error("OPENROUTER_API_KEY is required");
  const config = loadConfig({ ...process.env, NODE_ENV: "test" });
  const controller = new AbortController();
  process.once("SIGTERM", () => controller.abort());
  process.once("SIGINT", () => controller.abort());
  const runtime = new LocalProcessRuntime(
    process.cwd(),
    config.COMMAND_OUTPUT_MAX_BYTES,
  );
  const sandbox: AgentRunnerSandbox = {
    getAgentToolTarget: async () => ({
      containerName: "local",
      runtime,
    }),
  };
  const runner = new AgentRunner({
    config,
    sandbox,
    events: { append: async () => undefined } as never,
    model: resolveAgentModel(config),
    publish: () => undefined,
    profile: "main",
    emitToolEvents: false,
  });
  const startedAt = Date.now();
  try {
    const result = await runner.process({
      sessionId: "terminal-bench",
      messageId: "terminal-bench",
      sandboxId: "terminal-bench",
      instructions: await readFile(instructionPath, "utf8"),
      signal: controller.signal,
    });
    process.stdout.write(
      `${JSON.stringify({
        status: "completed",
        durationMs: Date.now() - startedAt,
        usage: result.usage,
        finalText: result.finalText,
      })}\n`,
    );
  } catch {
    process.stdout.write(
      `${JSON.stringify({
        status: controller.signal.aborted ? "cancelled" : "failed",
        durationMs: Date.now() - startedAt,
        error: safeError(),
      })}\n`,
    );
  }
};

if (process.env.TERMINAL_BENCH_VALIDATE_BUNDLE !== "1") {
  await main().catch(() => {
    process.stdout.write(
      `${JSON.stringify({ status: "failed", error: "Agent setup failed" })}\n`,
    );
  });
}
