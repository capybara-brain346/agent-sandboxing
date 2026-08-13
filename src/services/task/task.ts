import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { loadConfig, type Config } from "../../config";
import { prisma } from "../../db/prisma";
import { EventStore } from "../events/event-store";
import { sseHub } from "../events/sse-hub";
import { SandboxService, sandboxService } from "../sandbox/sandbox";
import { ServiceError } from "../../shared/errors";
import { runQuery } from "../../shared/query-logging";
import type {
  CreateTaskRequest,
  TaskCancellationResponse,
  CreateTaskResponse,
  TaskResult,
  TaskServicePort,
  TaskSnapshot,
  PublicTaskEvent,
} from "../../types/task.types";
import type { PublicEvent } from "../../types/event.types";

// The task service only needs this small part of SandboxService during the
// atomic creation phase. Keeping it structural also makes service tests use
// plain object collaborators rather than a Docker-backed singleton.
type TaskSandboxCreator = Pick<
  SandboxService,
  "createForTaskInTransaction"
>;
type PublishEvent = (event: PublicEvent) => void;

type TaskServiceConfigOrPublisher = Config | PublishEvent;

/**
 * Task lifecycle orchestration. Phase 4 implements only the atomic create
 * boundary; the remaining lifecycle methods are filled in by later phases.
 */
export class TaskService implements TaskServicePort {
  private readonly publish: PublishEvent;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly events: EventStore,
    private readonly sandbox: TaskSandboxCreator,
    configOrPublish: TaskServiceConfigOrPublisher,
    runnerOrPublish?: unknown | PublishEvent,
    publish?: PublishEvent,
  ) {
    // Accept the short four-argument form for focused unit tests and the
    // full constructor shape reserved for the later runner phases.
    this.publish =
      publish ??
      (typeof runnerOrPublish === "function"
        ? (runnerOrPublish as PublishEvent)
        : typeof configOrPublish === "function"
          ? (configOrPublish as PublishEvent)
          : () => undefined);
  }

  async create(input: CreateTaskRequest): Promise<CreateTaskResponse> {
    const taskId = `task_${randomUUID().replaceAll("-", "").slice(0, 20)}`;

    let result: { events: PublicEvent[] };
    try {
      result = await runQuery("create_task", { taskId }, () =>
        this.prisma.$transaction(async (tx) => {
          // The foreign keys between Task.sandboxId and Sandbox.taskId form a
          // cycle. Insert the task first, create the linked sandbox, then fill
          // in Task.sandboxId before any event is appended. The whole sequence
          // remains invisible until this transaction commits.
          await tx.task.create({
            data: {
              id: taskId,
              status: "created",
              repoRef: input.repoRef,
              instructions: input.instructions,
              image: input.image ?? null,
              nextEventSequence: 1,
            },
          });

          const sandboxInput = {
            fixtureRepoPath: input.repoRef,
            ...(input.image === undefined ? {} : { image: input.image }),
          };
          const sandbox = await this.sandbox.createForTaskInTransaction(
            tx,
            sandboxInput,
            { taskId },
          );

          await tx.task.update({
            where: { id: taskId },
            data: { sandboxId: sandbox.sandboxId },
          });

          // task_created deliberately precedes sandbox_created. Both rows and
          // the link exist by this point, so either event is truthful at commit.
          const taskCreated = await this.events.appendInTransaction(tx, {
            streamId: taskId,
            type: "task_created",
            producerService: "task",
            producerId: taskId,
            taskId,
            correlationId: randomUUID(),
            payload: {},
          });
          const sandboxCreated = await this.events.appendInTransaction(tx, {
            streamId: taskId,
            type: "sandbox_created",
            producerService: "sandbox",
            producerId: sandbox.sandboxId,
            taskId,
            sandboxId: sandbox.sandboxId,
            correlationId: randomUUID(),
            payload: {
              container_name: sandbox.containerName,
              workspace_path: sandbox.workspacePath,
            },
          });

          return { events: [taskCreated, sandboxCreated] };
        }),
      );
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw new ServiceError(
        "create_task_failed",
        "Task could not be created",
        500,
      );
    }

    // Publishing is intentionally outside the transaction. Subscribers can
    // only observe events after the database has committed both rows.
    for (const event of result.events) this.publish(event);

    return {
      taskId,
      status: "created",
      eventsUrl: `/tasks/${taskId}/events`,
    };
  }

  async get(_taskId: string): Promise<TaskSnapshot> {
    return this.unavailable();
  }

  async eventsAfter(
    _taskId: string,
    _after: number,
  ): Promise<PublicTaskEvent[]> {
    return this.unavailable();
  }

  async result(_taskId: string): Promise<TaskResult> {
    return this.unavailable();
  }

  async cancel(_taskId: string): Promise<TaskCancellationResponse> {
    return this.unavailable();
  }

  private unavailable(): never {
    throw new ServiceError(
      "task_service_unavailable",
      "Task Service operation is not implemented",
      501,
    );
  }
}

export const taskService = new TaskService(
  prisma,
  new EventStore(prisma),
  sandboxService,
  loadConfig(),
  undefined,
  (event) => sseHub.publish(event),
);
