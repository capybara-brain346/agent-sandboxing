import { randomUUID } from "node:crypto";
import type {
  Prisma,
  PrismaClient,
  SandboxEventActor,
} from "@prisma/client";
import { runQuery } from "../../shared/query-logging";
import type {
  EventProducerService,
  EventType,
  LegacyPublicEvent,
  PublicEvent,
  StreamEvent,
} from "../../types/event.types";

export type AppendEventInput = {
  /** Defaults to taskId for task-owned events. */
  streamId?: string;
  type: EventType;
  producerService: EventProducerService;
  producerId: string;
  taskId?: string | null;
  sandboxId?: string | null;
  commandId?: string | null;
  correlationId?: string | null;
  payload: Record<string, unknown>;
};

export type TaskEventInput = Omit<AppendEventInput, "streamId" | "taskId"> & {
  taskId: string;
};

export type SandboxEventInput = Omit<
  AppendEventInput,
  "streamId" | "sandboxId" | "taskId"
> & {
  sandboxId: string;
  taskId?: string | null;
};

export type CommandEventInput = Omit<
  AppendEventInput,
  "streamId" | "sandboxId" | "commandId" | "taskId"
> & {
  sandboxId: string;
  commandId: string;
  taskId?: string | null;
};

/**
 * Compatibility input for the internal sandbox service. When the sandbox is
 * linked to a task it is promoted to an Event row; an unlinked sandbox still
 * uses the transitional sandbox_events table until it is removed.
 */
type LegacyAppendInput = {
  sandboxId: string;
  type: EventType;
  actor: SandboxEventActor;
  payload: Record<string, unknown>;
  commandId?: string;
  correlationId?: string;
};

type AppendInput = AppendEventInput | LegacyAppendInput;

type EventRow = {
  id: string;
  streamId: string;
  sequence: number;
  type: string;
  producerService: string;
  producerId: string;
  taskId: string | null;
  sandboxId: string | null;
  commandId: string | null;
  correlationId: string | null;
  payload: Prisma.JsonValue;
  createdAt: Date;
};

type LegacyEventRow = {
  id: string;
  sandboxId: string;
  commandId: string | null;
  sequence: number;
  type: string;
  actor: SandboxEventActor;
  correlationId: string | null;
  payload: Prisma.JsonValue;
  createdAt: Date;
};

const eventId = (): string =>
  `evt_${randomUUID().replaceAll("-", "").slice(0, 20)}`;

const toPublic = (event: EventRow): PublicEvent => ({
  id: event.id,
  streamId: event.streamId,
  taskId: event.taskId ?? null,
  sandboxId: event.sandboxId ?? null,
  commandId: event.commandId ?? null,
  sequence: event.sequence,
  type: event.type as EventType,
  producerService: event.producerService as EventProducerService,
  producerId: event.producerId,
  correlationId: event.correlationId ?? null,
  payload: event.payload as Record<string, unknown>,
  createdAt: event.createdAt.toISOString(),
});

const toLegacyPublic = (event: LegacyEventRow): LegacyPublicEvent => ({
  ...event,
  type: event.type as EventType,
  payload: event.payload as Record<string, unknown>,
  createdAt: event.createdAt.toISOString(),
});

const isLegacyInput = (input: AppendInput): input is LegacyAppendInput =>
  "actor" in input;

const producerForLegacy = (
  input: LegacyAppendInput,
): { service: EventProducerService; id: string } => {
  if (input.commandId) {
    return {
      service: input.actor === "runtime" ? "runtime" : "command",
      id: input.commandId,
    };
  }

  return {
    service:
      input.actor === "cleanup"
        ? "cleanup"
        : input.actor === "runtime"
          ? "runtime"
          : "sandbox",
    id: input.sandboxId,
  };
};

export class EventStore {
  constructor(private readonly prisma: PrismaClient) {}

  async append(input: AppendEventInput): Promise<PublicEvent>;
  async append(input: LegacyAppendInput): Promise<StreamEvent>;
  async append(input: AppendInput): Promise<StreamEvent> {
    return runQuery(
      "append_event",
      {
        streamId: isLegacyInput(input)
          ? input.sandboxId
          : (input.streamId ?? input.taskId ?? "unknown"),
      },
      () =>
        this.prisma.$transaction((tx) =>
          this.appendAnyInTransaction(tx, input),
        ),
    );
  }

  async appendTaskEvent(input: TaskEventInput): Promise<PublicEvent> {
    return runQuery(
      "append_task_event",
      { taskId: input.taskId },
      () =>
        this.prisma.$transaction((tx) =>
          this.appendTaskEventInTransaction(tx, input),
        ),
    );
  }

  async appendSandboxEvent(input: SandboxEventInput): Promise<PublicEvent> {
    return runQuery(
      "append_sandbox_event",
      { sandboxId: input.sandboxId },
      () =>
        this.prisma.$transaction((tx) =>
          this.appendSandboxEventInTransaction(tx, input),
        ),
    );
  }

  async appendInTransaction(
    tx: Prisma.TransactionClient,
    input: AppendEventInput,
  ): Promise<PublicEvent>;
  async appendInTransaction(
    tx: Prisma.TransactionClient,
    input: LegacyAppendInput,
  ): Promise<StreamEvent>;
  async appendInTransaction(
    tx: Prisma.TransactionClient,
    input: AppendInput,
  ): Promise<StreamEvent> {
    return this.appendAnyInTransaction(tx, input);
  }

  private async appendAnyInTransaction(
    tx: Prisma.TransactionClient,
    input: AppendInput,
  ): Promise<StreamEvent> {
    if (!isLegacyInput(input)) return this.appendStreamInTransaction(tx, input);

    const taskId = await this.findSandboxTaskId(tx, input.sandboxId);
    if (taskId) {
      const producer = producerForLegacy(input);
      return this.appendStreamInTransaction(tx, {
        streamId: taskId,
        taskId,
        sandboxId: input.sandboxId,
        commandId: input.commandId ?? null,
        type: input.type,
        producerService: producer.service,
        producerId: producer.id,
        correlationId: input.correlationId ?? null,
        payload: input.payload,
      });
    }

    return this.appendLegacySandboxInTransaction(tx, input);
  }

  async appendTaskEventInTransaction(
    tx: Prisma.TransactionClient,
    input: TaskEventInput,
  ): Promise<PublicEvent> {
    return this.appendStreamInTransaction(tx, {
      ...input,
      streamId: input.taskId,
      taskId: input.taskId,
    });
  }

  async appendSandboxEventInTransaction(
    tx: Prisma.TransactionClient,
    input: SandboxEventInput,
  ): Promise<PublicEvent> {
    const taskId = input.taskId ?? (await this.findSandboxTaskId(tx, input.sandboxId));
    if (!taskId)
      throw new Error("Cannot append a sandbox event without a task stream");

    return this.appendStreamInTransaction(tx, {
      ...input,
      streamId: taskId,
      taskId,
      sandboxId: input.sandboxId,
    });
  }

  async appendCommandEventInTransaction(
    tx: Prisma.TransactionClient,
    input: CommandEventInput,
  ): Promise<PublicEvent> {
    const taskId = input.taskId ?? (await this.findSandboxTaskId(tx, input.sandboxId));
    if (!taskId)
      throw new Error("Cannot append a command event without a task stream");

    return this.appendStreamInTransaction(tx, {
      ...input,
      streamId: taskId,
      taskId,
      sandboxId: input.sandboxId,
      commandId: input.commandId,
    });
  }

  async listAfter(streamId: string, after: number): Promise<PublicEvent[]> {
    return this.listTaskEvents(streamId, after);
  }

  async listTaskEvents(taskId: string, after: number): Promise<PublicEvent[]> {
    const events = await runQuery(
      "list_task_events",
      { taskId, after },
      () =>
        this.prisma.event.findMany({
          where: { streamId: taskId, sequence: { gt: after } },
          orderBy: { sequence: "asc" },
        }),
    );
    return events.map(toPublic);
  }

  /** List the task stream for a sandbox, or legacy sandbox events if unlinked. */
  async listSandboxAfter(
    sandboxId: string,
    after: number,
  ): Promise<StreamEvent[]> {
    const sandboxDelegate = this.prisma.sandbox as unknown as {
      findUnique?: (args: unknown) => Promise<{ taskId: string | null } | null>;
    };
    const sandbox = await sandboxDelegate.findUnique?.({
      where: { id: sandboxId },
      select: { taskId: true },
    });
    if (sandbox?.taskId) return this.listTaskEvents(sandbox.taskId, after);
    return this.listLegacySandboxAfter(sandboxId, after);
  }

  private async appendStreamInTransaction(
    tx: Prisma.TransactionClient,
    input: AppendEventInput,
  ): Promise<PublicEvent> {
    const streamId = input.streamId ?? input.taskId;
    if (!streamId)
      throw new Error("Task stream ID is required to append an event");

    const rows = await tx.$queryRaw<
      Array<{ next_event_sequence: number }>
    >`SELECT next_event_sequence FROM tasks WHERE id = ${streamId} FOR UPDATE`;
    const row = rows[0];
    if (!row) throw new Error("Task disappeared while appending event");

    const event = await tx.event.create({
      data: {
        id: eventId(),
        streamId,
        sequence: row.next_event_sequence,
        type: input.type,
        producerService: input.producerService,
        producerId: input.producerId,
        taskId: input.taskId ?? streamId,
        sandboxId: input.sandboxId ?? null,
        commandId: input.commandId ?? null,
        correlationId: input.correlationId ?? null,
        payload: input.payload as Prisma.InputJsonValue,
      },
    });
    await tx.task.update({
      where: { id: streamId },
      data: { nextEventSequence: { increment: 1 } },
    });
    return toPublic(event);
  }

  private async appendLegacySandboxInTransaction(
    tx: Prisma.TransactionClient,
    input: LegacyAppendInput,
  ): Promise<LegacyPublicEvent> {
    const rows = await tx.$queryRaw<
      Array<{ next_event_sequence: number }>
    >`SELECT next_event_sequence FROM sandboxes WHERE id = ${input.sandboxId} FOR UPDATE`;
    const row = rows[0];
    if (!row) throw new Error("Sandbox disappeared while appending event");

    const event = await tx.sandboxEvent.create({
      data: {
        sandboxId: input.sandboxId,
        commandId: input.commandId ?? null,
        sequence: row.next_event_sequence,
        type: input.type,
        actor: input.actor,
        correlationId: input.correlationId ?? null,
        payload: input.payload as Prisma.InputJsonValue,
      },
    });
    await tx.sandbox.update({
      where: { id: input.sandboxId },
      data: { nextEventSequence: { increment: 1 } },
    });
    return toLegacyPublic(event);
  }

  private async findSandboxTaskId(
    tx: Prisma.TransactionClient,
    sandboxId: string,
  ): Promise<string | null> {
    const sandboxDelegate = tx.sandbox as unknown as {
      findUnique?: (args: unknown) => Promise<{ taskId: string | null } | null>;
    };
    if (!sandboxDelegate.findUnique) return null;
    const sandbox = await sandboxDelegate.findUnique({
      where: { id: sandboxId },
      select: { taskId: true },
    });
    return sandbox?.taskId ?? null;
  }

  private async listLegacySandboxAfter(
    sandboxId: string,
    after: number,
  ): Promise<LegacyPublicEvent[]> {
    const events = await runQuery(
      "list_sandbox_events",
      { sandboxId, after },
      () =>
        this.prisma.sandboxEvent.findMany({
          where: { sandboxId, sequence: { gt: after } },
          orderBy: { sequence: "asc" },
        }),
    );
    return events.map(toLegacyPublic);
  }
}
