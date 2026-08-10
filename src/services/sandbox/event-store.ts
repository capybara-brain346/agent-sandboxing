import type { PrismaClient, Prisma, SandboxEventActor } from "@prisma/client";
import type { EventType, PublicEvent } from "../../types/sandbox.types";

type AppendInput = {
  sandboxId: string;
  type: EventType;
  actor: SandboxEventActor;
  payload: Record<string, unknown>;
  commandId?: string;
  correlationId?: string;
};
const toPublic = (event: {
  id: string;
  sandboxId: string;
  commandId: string | null;
  sequence: number;
  type: string;
  actor: SandboxEventActor;
  correlationId: string | null;
  payload: Prisma.JsonValue;
  createdAt: Date;
}): PublicEvent => ({
  ...event,
  type: event.type as EventType,
  payload: event.payload as Record<string, unknown>,
  createdAt: event.createdAt.toISOString(),
});

export class EventStore {
  constructor(private readonly prisma: PrismaClient) {}

  async append(input: AppendInput): Promise<PublicEvent> {
    return this.prisma.$transaction((tx) =>
      this.appendInTransaction(tx, input),
    );
  }

  async appendInTransaction(
    tx: Prisma.TransactionClient,
    input: AppendInput,
  ): Promise<PublicEvent> {
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
    return toPublic(event);
  }

  async listAfter(sandboxId: string, after: number): Promise<PublicEvent[]> {
    const events = await this.prisma.sandboxEvent.findMany({
      where: { sandboxId, sequence: { gt: after } },
      orderBy: { sequence: "asc" },
    });
    return events.map(toPublic);
  }
}
