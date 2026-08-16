import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { runQuery } from "../../shared/query-logging";
import { notFound } from "../../shared/errors";
import type {
  EventProducerService,
  EventType,
  PublicEvent,
} from "../../types/event.types";

export type AppendEventInput = {
  /** The task stream is the only supported event stream. */
  taskId: string;
  streamId?: string;
  type: EventType;
  producerService: EventProducerService;
  producerId: string;
  sandboxId?: string | null;
  commandId?: string | null;
  correlationId?: string | null;
  payload: Record<string, unknown>;
};

export type TaskEventInput = Omit<AppendEventInput, "streamId" | "taskId"> & {
  taskId: string;
};

type EventRow = {
  id: string;
  streamId: string;
  sequence: number;
  type: string;
  producerService: string;
  producerId: string;
  taskId: string;
  sandboxId: string | null;
  commandId: string | null;
  correlationId: string | null;
  payload: Prisma.JsonValue;
  createdAt: Date;
};

type TaskEventQueryRow = {
  id: string | null;
  streamId: string | null;
  sequence: number | null;
  type: string | null;
  producerService: string | null;
  producerId: string | null;
  taskId: string | null;
  sandboxId: string | null;
  commandId: string | null;
  correlationId: string | null;
  payload: Prisma.JsonValue | null;
  createdAt: Date | null;
};

const eventId = (): string =>
  `evt_${randomUUID().replaceAll("-", "").slice(0, 20)}`;

const toPublic = (event: EventRow): PublicEvent => {
  if (!event.taskId) throw new Error("Event is missing its owning task");
  return {
    id: event.id,
    streamId: event.streamId,
    taskId: event.taskId,
    sandboxId: event.sandboxId,
    commandId: event.commandId,
    sequence: event.sequence,
    type: event.type as EventType,
    producerService: event.producerService as EventProducerService,
    producerId: event.producerId,
    correlationId: event.correlationId,
    payload: event.payload as Record<string, unknown>,
    createdAt: event.createdAt.toISOString(),
  };
};

export class EventStore {
  constructor(private readonly prisma: PrismaClient) {}

  async append(input: AppendEventInput): Promise<PublicEvent> {
    return runQuery(
      "append_event",
      { taskId: input.taskId },
      () =>
        this.prisma.$transaction((tx) =>
          this.appendInTransaction(tx, input),
        ),
    );
  }

  async appendTaskEvent(input: TaskEventInput): Promise<PublicEvent> {
    return this.append(input);
  }

  async appendInTransaction(
    tx: Prisma.TransactionClient,
    input: AppendEventInput,
  ): Promise<PublicEvent> {
    return this.appendStreamInTransaction(tx, input);
  }

  async appendTaskEventInTransaction(
    tx: Prisma.TransactionClient,
    input: TaskEventInput,
  ): Promise<PublicEvent> {
    return this.appendInTransaction(tx, input);
  }

  async listAfter(taskId: string, after: number): Promise<PublicEvent[]> {
    return this.listTaskEvents(taskId, after);
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
            e.sequence,
            e.type,
            e.producer_service AS "producerService",
            e.producer_id AS "producerId",
            e.task_id AS "taskId",
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
          sequence: row.sequence ?? 0,
          type: row.type ?? "task_created",
          producerService: row.producerService ?? "task",
          producerId: row.producerId ?? taskId,
          taskId: row.taskId ?? taskId,
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
        sequence: row.next_event_sequence,
        type: input.type,
        producerService: input.producerService,
        producerId: input.producerId,
        taskId: input.taskId,
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
}
