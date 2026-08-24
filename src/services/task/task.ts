import { loadConfig } from "../../config";
import { prisma } from "../../db/prisma";
import { EventStore } from "../events/event-store";
import { sseHub } from "../events/sse-hub";
import { sandboxService } from "../sandbox/sandbox";
import type { TaskStatus } from "../../types/task.types";
import type { PublicEvent } from "../../types/event.types";
import { AgentRunner } from "../agent/agent-runner";
import type { CodeWorker } from "../agent/code-worker";
import { resolveAgentModel } from "../agent/model";
import { ArtifactStore } from "../artifacts/artifact-store";
import { CompositeTraceSink } from "../eval/composite-trace-sink";
import { EvalTraceRecorder } from "../eval/eval-trace-recorder";
import { LangfuseTraceSink } from "../eval/langfuse-trace-sink";
import { LocalTraceSink } from "../eval/local-trace-sink";
import type { EvalTraceSink } from "../../types/eval-trace.types";

const transitions: Record<TaskStatus, readonly TaskStatus[]> = {
  created: ["provisioning", "failed", "cancelled"],
  provisioning: ["running", "failed", "cancelled"],
  running: ["completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

export const canTransition = (from: TaskStatus, to: TaskStatus): boolean =>
  transitions[from].includes(to);

const taskServiceConfig = loadConfig();
const taskServiceEvents = new EventStore(prisma);
const publishTaskEvent = (event: PublicEvent): void => sseHub.publish(event);
export const taskServiceArtifacts = new ArtifactStore(prisma);
const taskServiceLangfuseSink = new LangfuseTraceSink(taskServiceConfig);
const taskServiceTraceSinks: EvalTraceSink[] = [
  taskServiceLangfuseSink,
  ...(taskServiceConfig.LOCAL_TRACE_EXPORT_ENABLED
    ? [new LocalTraceSink(taskServiceConfig.LOCAL_TRACE_EXPORT_PATH)]
    : []),
];
export const taskServiceTraceRecorder = new EvalTraceRecorder(
  new CompositeTraceSink(taskServiceTraceSinks),
  {
    includeContextSnapshot:
      taskServiceConfig.EVAL_TRACE_CONTEXT_SNAPSHOT_ENABLED,
    tags: [`environment:${taskServiceConfig.NODE_ENV}`, "source:chat-session"],
  },
);
export const shutdownTaskServiceTracing = (): Promise<void> =>
  taskServiceLangfuseSink.shutdown();
const placeholderWorker: CodeWorker = {
  run: async () => ({
    status: "completed",
    summary: "",
    changedFiles: [],
    testsRun: [],
    blockers: [],
    suggestedNextStep: "",
  }),
};

export const taskServiceWorker: CodeWorker =
  taskServiceConfig.NODE_ENV === "test"
    ? placeholderWorker
    : new AgentRunner({
        config: taskServiceConfig,
        sandbox: sandboxService,
        events: taskServiceEvents,
        model: resolveAgentModel(taskServiceConfig),
        publish: publishTaskEvent,
        artifacts: taskServiceArtifacts,
        traceRecorder: taskServiceTraceRecorder,
      });
