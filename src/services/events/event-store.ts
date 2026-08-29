import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { runQuery } from "../../shared/query-logging";
import type {
  EventProducerService,
  EventType,
  PublicEvent,
} from "../../types/event.types";

export type SessionEventInput = {
  sessionId: string;
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

type EventRow = {
  id: string;
  streamId: string;
  streamScope: string;
  domain: string;
  sequence: number;
  type: string;
  producerService: string;
  producerId: string;
  sessionId: string | null;
  messageId: string | null;
  artifactId: string | null;
  sandboxId: string | null;
  commandId: string | null;
  correlationId: string | null;
  payload: Prisma.JsonValue;
  createdAt: Date;
};

const eventId = (): string =>
  `evt_${randomUUID().replaceAll("-", "").slice(0, 20)}`;

const toPublic = (event: EventRow): PublicEvent => {
  if (
    event.streamScope !== "session" ||
    event.sessionId === null ||
    event.sessionId !== event.streamId
  )
    throw new Error("Event is not session-scoped");
  return {
    id: event.id,
    streamId: event.streamId,
    streamScope: "session",
    domain: event.domain,
    sessionId: event.sessionId,
    messageId: event.messageId,
    artifactId: event.artifactId,
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

  async append(input: SessionEventInput): Promise<PublicEvent> {
    return runQuery(
      "append_session_event",
      { sessionId: input.sessionId },
      () =>
        this.prisma.$transaction((tx) =>
          this.appendSessionEventInTransaction(tx, input),
        ),
    );
  }

  async appendSessionEvent(input: SessionEventInput): Promise<PublicEvent> {
    return this.append(input);
  }

  async appendInTransaction(
    tx: Prisma.TransactionClient,
    input: SessionEventInput,
  ): Promise<PublicEvent> {
    return this.appendSessionEventInTransaction(tx, input);
  }

  async appendSessionEventInTransaction(
    tx: Prisma.TransactionClient,
    input: SessionEventInput,
  ): Promise<PublicEvent> {
    const rows = await tx.$queryRaw<
      Array<{ next_event_sequence: number }>
    >`SELECT next_event_sequence FROM chat_sessions WHERE id = ${input.sessionId} FOR UPDATE`;
    const row = rows[0];
    if (!row) throw new Error("Session disappeared while appending event");

    const event = await tx.event.create({
      data: {
        id: eventId(),
        streamId: input.sessionId,
        streamScope: "session",
        domain: input.domain ?? "session",
        sequence: row.next_event_sequence,
        type: input.type,
        producerService: input.producerService,
        producerId: input.producerId,
        sessionId: input.sessionId,
        messageId: input.messageId ?? null,
        artifactId: input.artifactId ?? null,
        sandboxId: input.sandboxId ?? null,
        commandId: input.commandId ?? null,
        correlationId: input.correlationId ?? null,
        payload: input.payload as Prisma.InputJsonValue,
      },
    });
    await tx.chatSession.update({
      where: { id: input.sessionId },
      data: { nextEventSequence: { increment: 1 } },
    });
    return toPublic(event);
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
}
