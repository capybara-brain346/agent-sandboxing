import type { SandboxEventActor } from "@prisma/client";
import type { EventType } from "./domain";

export type PublicEvent = {
  id: string;
  sandboxId: string;
  commandId: string | null;
  sequence: number;
  type: EventType;
  actor: SandboxEventActor;
  correlationId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};
