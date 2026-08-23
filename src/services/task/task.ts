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
      });
