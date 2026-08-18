import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { runQuery } from "../../shared/query-logging";
import { notFound } from "../../shared/errors";
import type {
  EventStreamScope,
  EventProducerService,
  EventType,
  PublicEvent,
} from "../../types/event.types";

export type AppendEventInput = {
  taskId: string;
  streamId?: string;
  type: EventType;
  producerService: EventProducerService;
  producerId: string;
  domain?: string;
  sessionId?: string | null;
  runId?: string | null;
  messageId?: string | null;
  artifactId?: string | null;
  sandboxId?: string | null;
  commandId?: string | null;
  correlationId?: string | null;
  payload: Record<string, unknown>;
};

export type TaskEventInput = Omit<AppendEventInput, "streamId" | "taskId"> & {
  taskId: string;
};

export type AppendScopedEventInput = {
  streamScope: Exclude<EventStreamScope, "task">;
  streamId: string;
  sessionId: string;
  runId?: string | null;
  taskId?: string | null;
  type: EventType;
  producerService: EventProducerService;
  producerId: string;
  domain?: string;
  messageId?: string | null;
  artifactId?: string | null;
  sandboxId?: string | null;
  commandId?: string | null;
  correlationId?: string | null;
  payload: Record<string, unknown>;
};

export type SessionEventInput = Omit<
  AppendScopedEventInput,
  "streamScope" | "streamId"
> & {
  sessionId: string;
  runId?: string | null;
};

export type RunEventInput = Omit<
  AppendScopedEventInput,
  "streamScope" | "streamId" | "runId"
> & {
  sessionId: string;
  runId: string;
};

type EventRow = {
  id: string;
  streamId: string;
  streamScope?: string | null;
  domain?: string | null;
  sequence: number;
  type: string;
  producerService: string;
  producerId: string;
  taskId?: string | null;
  sessionId?: string | null;
  runId?: string | null;
  messageId?: string | null;
  artifactId?: string | null;
  sandboxId?: string | null;
  commandId?: string | null;
  correlationId?: string | null;
  payload: Prisma.JsonValue;
  createdAt: Date;
};

type TaskEventQueryRow = {
  id: string | null;
  streamId: string | null;
  streamScope: string | null;
  domain: string | null;
  sequence: number | null;
  type: string | null;
  producerService: string | null;
  producerId: string | null;
  taskId: string | null;
  sessionId: string | null;
  runId: string | null;
  messageId: string | null;
  artifactId: string | null;
  sandboxId: string | null;
  commandId: string | null;
  correlationId: string | null;
  payload: Prisma.JsonValue | null;
  createdAt: Date | null;
};

const eventId = (): string =>
  `evt_${randomUUID().replaceAll("-", "").slice(0, 20)}`;

const toPublic = (event: EventRow): PublicEvent => {
  const streamScope = (event.streamScope ?? "task") as EventStreamScope;
  const publicEvent: PublicEvent = {
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
  };
  if (streamScope === "task") return publicEvent;
  return {
    ...publicEvent,
    streamScope,
    domain: event.domain ?? streamScope,
    sessionId: event.sessionId ?? null,
    runId: event.runId ?? null,
    messageId: event.messageId ?? null,
    artifactId: event.artifactId ?? null,
  };
};

export class EventStore {
  constructor(private readonly prisma: PrismaClient) {}

  async append(
    input: AppendEventInput | AppendScopedEventInput,
  ): Promise<PublicEvent> {
    if ("streamScope" in input)
      return runQuery(
        "append_scoped_event",
        { streamScope: input.streamScope, streamId: input.streamId },
        () =>
          this.prisma.$transaction((tx) =>
            this.appendScopedEventInTransaction(tx, input),
          ),
      );

    return runQuery("append_event", { taskId: input.taskId }, () =>
      this.prisma.$transaction((tx) => this.appendInTransaction(tx, input)),
    );
  }

  async appendTaskEvent(input: TaskEventInput): Promise<PublicEvent> {
    return this.append(input);
  }

  async appendScopedEvent(input: AppendScopedEventInput): Promise<PublicEvent> {
    return this.append(input);
  }

  async appendInTransaction(
    tx: Prisma.TransactionClient,
    input: AppendEventInput | AppendScopedEventInput,
  ): Promise<PublicEvent> {
    if ("streamScope" in input)
      return this.appendScopedEventInTransaction(tx, input);
    return this.appendStreamInTransaction(tx, input);
  }

  async appendTaskEventInTransaction(
    tx: Prisma.TransactionClient,
    input: TaskEventInput,
  ): Promise<PublicEvent> {
    return this.appendInTransaction(tx, input);
  }

  async appendSessionEvent(input: SessionEventInput): Promise<PublicEvent> {
    return runQuery(
      "append_session_event",
      { sessionId: input.sessionId },
      () =>
        this.prisma.$transaction((tx) =>
          this.appendSessionEventInTransaction(tx, input),
        ),
    );
  }

  async appendSessionEventInTransaction(
    tx: Prisma.TransactionClient,
    input: SessionEventInput,
  ): Promise<PublicEvent> {
    return this.appendScopedEventInTransaction(tx, {
      ...input,
      streamScope: "session",
      streamId: input.sessionId,
    });
  }

  async appendRunEvent(input: RunEventInput): Promise<PublicEvent> {
    return runQuery(
      "append_run_event",
      { sessionId: input.sessionId, runId: input.runId },
      () =>
        this.prisma.$transaction((tx) =>
          this.appendRunEventInTransaction(tx, input),
        ),
    );
  }

  async appendRunEventInTransaction(
    tx: Prisma.TransactionClient,
    input: RunEventInput,
  ): Promise<PublicEvent> {
    return this.appendScopedEventInTransaction(tx, {
      ...input,
      streamScope: "run",
      streamId: input.runId,
    });
  }

  async listAfter(taskId: string, after: number): Promise<PublicEvent[]> {
    return this.listTaskEvents(taskId, after);
  }

  async listTaskEvents(taskId: string, after: number): Promise<PublicEvent[]> {
    const events = await runQuery("list_task_events", { taskId, after }, () =>
      this.prisma.event.findMany({
        where: { streamId: taskId, sequence: { gt: after } },
        orderBy: { sequence: "asc" },
      }),
    );
    return events.map(toPublic);
  }

  async listSessionEvents(
    sessionId: string,
    after: number,
  ): Promise<PublicEvent[]> {
    const events = await runQuery(
      "list_session_events",
      { sessionId, after },
      () =>
        this.prisma.event.findMany({
          where: {
            streamScope: "session",
            streamId: sessionId,
            sequence: { gt: after },
          },
          orderBy: { sequence: "asc" },
        }),
    );
    return events.map(toPublic);
  }

  async listRunEvents(runId: string, after: number): Promise<PublicEvent[]> {
    const events = await runQuery("list_run_events", { runId, after }, () =>
      this.prisma.event.findMany({
        where: {
          streamScope: "run",
          streamId: runId,
          sequence: { gt: after },
        },
        orderBy: { sequence: "asc" },
      }),
    );
    return events.map(toPublic);
  }

  async listScopedEvents(
    streamScope: Exclude<EventStreamScope, "task">,
    streamId: string,
    after: number,
  ): Promise<PublicEvent[]> {
    return streamScope === "session"
      ? this.listSessionEvents(streamId, after)
      : this.listRunEvents(streamId, after);
  }

  async listTaskEventsAfter(
    taskId: string,
    after: number,
  ): Promise<PublicEvent[]> {
    const rows = await runQuery(
      "list_task_events_with_task",
      { taskId, after },
      () =>
        this.prisma.$queryRaw<TaskEventQueryRow[]>`
          SELECT
            e.id,
            e.stream_id AS "streamId",
            e.stream_scope AS "streamScope",
            e.domain,
            e.sequence,
            e.type,
            e.producer_service AS "producerService",
            e.producer_id AS "producerId",
            e.task_id AS "taskId",
            e.session_id AS "sessionId",
            e.run_id AS "runId",
            e.message_id AS "messageId",
            e.artifact_id AS "artifactId",
            e.sandbox_id AS "sandboxId",
            e.command_id AS "commandId",
            e.correlation_id AS "correlationId",
            e.payload,
            e.created_at AS "createdAt"
          FROM tasks AS t
          LEFT JOIN events AS e
            ON e.stream_id = t.id AND e.sequence > ${after}
          WHERE t.id = ${taskId}
          ORDER BY e.sequence ASC
        `,
    );
    if (rows.length === 0)
      throw notFound("task_not_found", "Task was not found");

    return rows.flatMap((row) => {
      if (row.id === null) return [];
      return [
        toPublic({
          id: row.id,
          streamId: row.streamId ?? taskId,
          streamScope: row.streamScope ?? "task",
          domain: row.domain ?? "task",
          sequence: row.sequence ?? 0,
          type: row.type ?? "task_created",
          producerService: row.producerService ?? "task",
          producerId: row.producerId ?? taskId,
          taskId: row.taskId ?? taskId,
          sessionId: row.sessionId,
          runId: row.runId,
          messageId: row.messageId,
          artifactId: row.artifactId,
          sandboxId: row.sandboxId,
          commandId: row.commandId,
          correlationId: row.correlationId,
          payload: row.payload ?? {},
          createdAt: row.createdAt ?? new Date(0),
        }),
      ];
    });
  }

  private async appendStreamInTransaction(
    tx: Prisma.TransactionClient,
    input: AppendEventInput,
  ): Promise<PublicEvent> {
    const streamId = input.streamId ?? input.taskId;
    if (streamId !== input.taskId)
      throw new Error("Event stream must be the owning task stream");

    const rows = await tx.$queryRaw<
      Array<{ next_event_sequence: number }>
    >`SELECT next_event_sequence FROM tasks WHERE id = ${input.taskId} FOR UPDATE`;
    const row = rows[0];
    if (!row) throw new Error("Task disappeared while appending event");

    const event = await tx.event.create({
      data: {
        id: eventId(),
        streamId,
        streamScope: "task",
        domain: input.domain ?? "task",
        sequence: row.next_event_sequence,
        type: input.type,
        producerService: input.producerService,
        producerId: input.producerId,
        taskId: input.taskId,
        sessionId: input.sessionId ?? null,
        runId: input.runId ?? null,
        messageId: input.messageId ?? null,
        artifactId: input.artifactId ?? null,
        sandboxId: input.sandboxId ?? null,
        commandId: input.commandId ?? null,
        correlationId: input.correlationId ?? null,
        payload: input.payload as Prisma.InputJsonValue,
      },
    });
    await tx.task.update({
      where: { id: input.taskId },
      data: { nextEventSequence: { increment: 1 } },
    });
    return toPublic(event);
  }

  async appendScopedEventInTransaction(
    tx: Prisma.TransactionClient,
    input: AppendScopedEventInput,
  ): Promise<PublicEvent> {
    const runId = input.runId;
    if (input.streamScope === "run" && !runId)
      throw new Error("Run stream is missing its owner");
    const streamId = input.streamScope === "session" ? input.sessionId : runId;
    if (streamId !== input.streamId)
      throw new Error("Event stream does not match its owner");

    const rows =
      input.streamScope === "session"
        ? await tx.$queryRaw<
            Array<{ next_event_sequence: number }>
          >`SELECT next_event_sequence FROM chat_sessions WHERE id = ${input.sessionId} FOR UPDATE`
        : await tx.$queryRaw<
            Array<{ next_event_sequence: number }>
          >`SELECT next_event_sequence FROM tasks WHERE id = ${runId} AND session_id = ${input.sessionId} FOR UPDATE`;
    const row = rows[0];
    if (!row) throw new Error("Event stream owner disappeared");

    const data: Prisma.EventUncheckedCreateInput = {
      id: eventId(),
      streamId: input.streamId,
      streamScope: input.streamScope,
      domain: input.domain ?? input.streamScope,
      sequence: row.next_event_sequence,
      type: input.type,
      producerService: input.producerService,
      producerId: input.producerId,
      taskId: input.taskId ?? null,
      sessionId: input.sessionId,
      runId: input.runId ?? null,
      messageId: input.messageId ?? null,
      artifactId: input.artifactId ?? null,
      sandboxId: input.sandboxId ?? null,
      commandId: input.commandId ?? null,
      correlationId: input.correlationId ?? null,
      payload: input.payload as Prisma.InputJsonValue,
    };
    const event = await tx.event.create({ data });
    if (input.streamScope === "session")
      await tx.chatSession.update({
        where: { id: input.sessionId },
        data: { nextEventSequence: { increment: 1 } },
      });
    else {
      if (!runId) throw new Error("Run stream is missing its owner");
      await tx.task.update({
        where: { id: runId },
        data: { nextEventSequence: { increment: 1 } },
      });
    }
    return toPublic(event);
  }
}
