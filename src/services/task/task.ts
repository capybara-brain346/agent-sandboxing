import { loadConfig } from "../../config";
import { prisma } from "../../db/prisma";
import { EventStore } from "../events/event-store";
import { sseHub } from "../events/sse-hub";
import { sandboxService } from "../sandbox/sandbox";
import type { TaskStatus } from "../../types/task.types";
import type { PublicEvent } from "../../types/event.types";
import { AgentRunner } from "../agent/agent-runner";
import { resolveAgentModel } from "../agent/model";
import { ArtifactStore } from "../artifacts/artifact-store";
import { PlaceholderTaskRunner, type TaskRunner } from "./task-runner";

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
export const taskServiceRunner: TaskRunner =
  taskServiceConfig.NODE_ENV === "test"
    ? new PlaceholderTaskRunner()
    : new AgentRunner({
        config: taskServiceConfig,
        sandbox: sandboxService,
        events: taskServiceEvents,
        model: resolveAgentModel(taskServiceConfig),
        publish: publishTaskEvent,
        artifacts: taskServiceArtifacts,
      });
