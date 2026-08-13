import type { Response } from "express";
import type { StreamEvent } from "../../types/event.types";

export type SseClient = {
  response: Response;
  buffered: StreamEvent[];
  replaying: boolean;
  lastSent: number;
  closed: boolean;
};

const channelFor = (event: StreamEvent): string =>
  "streamId" in event ? event.streamId : event.sandboxId;

/** In-memory live fanout. Persisted Event rows remain the source of truth. */
export class SseHub {
  private readonly clients = new Map<string, Set<SseClient>>();

  subscribe(streamId: string, response: Response, after: number): SseClient {
    const client: SseClient = {
      response,
      buffered: [],
      replaying: true,
      lastSent: after,
      closed: false,
    };
    const clients = this.clients.get(streamId) ?? new Set<SseClient>();
    clients.add(client);
    this.clients.set(streamId, clients);
    response.on("close", () => this.unsubscribeOnClose(streamId, client));
    return client;
  }

  subscribeTask(taskId: string, response: Response, after: number): SseClient {
    return this.subscribe(taskId, response, after);
  }

  finishReplay(
    streamId: string,
    client: SseClient,
    replayLast: number,
  ): void {
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

  finishTaskReplay(
    taskId: string,
    client: SseClient,
    replayLast: number,
  ): void {
    this.finishReplay(taskId, client, replayLast);
  }

  publish(event: StreamEvent): void {
    const streamId = channelFor(event);
    for (const client of this.clients.get(streamId) ?? []) {
      if (client.closed) continue;
      if (client.replaying) client.buffered.push(event);
      else if (event.sequence > client.lastSent) this.send(client, event);
    }
  }

  /** Remove a client when replay cannot be completed before headers are sent. */
  unsubscribe(streamId: string, client: SseClient): void {
    client.closed = true;
    client.buffered.length = 0;
    const clients = this.clients.get(streamId);
    clients?.delete(client);
    if (clients?.size === 0) this.clients.delete(streamId);
  }

  unsubscribeTask(taskId: string, client: SseClient): void {
    this.unsubscribe(taskId, client);
  }

  private send(client: SseClient, event: StreamEvent): void {
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

  private unsubscribeOnClose(streamId: string, client: SseClient): void {
    this.unsubscribe(streamId, client);
  }

  closeAll(): void {
    for (const clients of this.clients.values())
      for (const client of clients) client.response.end();
    this.clients.clear();
  }
}

export const sseHub = new SseHub();
