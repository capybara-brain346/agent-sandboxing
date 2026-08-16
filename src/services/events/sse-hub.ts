import type { Response } from "express";
import type { PublicEvent } from "../../types/event.types";

export type SseClient = {
  response: Response;
  buffered: PublicEvent[];
  replaying: boolean;
  lastSent: number;
  closed: boolean;
};

/** In-memory live fanout for task streams. Persisted Event rows are canonical. */
export class SseHub {
  private readonly clients = new Map<string, Set<SseClient>>();

  subscribe(taskId: string, response: Response, after: number): SseClient {
    const client: SseClient = {
      response,
      buffered: [],
      replaying: true,
      lastSent: after,
      closed: false,
    };
    const clients = this.clients.get(taskId) ?? new Set<SseClient>();
    clients.add(client);
    this.clients.set(taskId, clients);
    response.on("close", () => this.unsubscribe(taskId, client));
    return client;
  }

  finishReplay(taskId: string, client: SseClient, replayLast: number): void {
    if (client.closed) return;

    client.lastSent = Math.max(client.lastSent, replayLast);
    client.replaying = false;
    const buffered = client.buffered
      .splice(0)
      .sort((left, right) => left.sequence - right.sequence);
    for (const event of buffered) {
      if (event.sequence > client.lastSent) this.send(client, event);
    }
  }

  publish(event: PublicEvent): void {
    for (const client of this.clients.get(event.streamId) ?? []) {
      if (client.closed) continue;
      if (client.replaying) client.buffered.push(event);
      else if (event.sequence > client.lastSent) this.send(client, event);
    }
  }

  unsubscribe(taskId: string, client: SseClient): void {
    client.closed = true;
    client.buffered.length = 0;
    const clients = this.clients.get(taskId);
    clients?.delete(client);
    if (clients?.size === 0) this.clients.delete(taskId);
  }

  private send(client: SseClient, event: PublicEvent): void {
    if (
      client.closed ||
      client.response.writableEnded ||
      client.response.destroyed
    )
      return;

    client.response.write(
      `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
    );
    client.lastSent = event.sequence;
  }

  closeAll(): void {
    for (const clients of this.clients.values())
      for (const client of clients) client.response.end();
    this.clients.clear();
  }
}

export const sseHub = new SseHub();
