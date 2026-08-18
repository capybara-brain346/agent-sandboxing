import type { Response } from "express";
import type { EventStreamScope, PublicEvent } from "../../types/event.types";

export type SseClient = {
  response: Response;
  streamScope: EventStreamScope;
  streamId: string;
  buffered: PublicEvent[];
  replaying: boolean;
  lastSent: number;
  closed: boolean;
};

export class SseHub {
  private readonly clients = new Map<string, Set<SseClient>>();

  subscribe(streamId: string, response: Response, after: number): SseClient;
  subscribe(
    streamScope: EventStreamScope,
    streamId: string,
    response: Response,
    after: number,
  ): SseClient;
  subscribe(
    streamScopeOrId: string,
    streamOrResponse: string | Response,
    responseOrAfter: Response | number,
    maybeAfter?: number,
  ): SseClient {
    const legacy = typeof streamOrResponse !== "string";
    const streamScope: EventStreamScope = legacy
      ? "task"
      : (streamScopeOrId as EventStreamScope);
    const streamId = legacy ? streamScopeOrId : streamOrResponse;
    const response = (legacy ? streamOrResponse : responseOrAfter) as Response;
    const after = (legacy ? responseOrAfter : maybeAfter) as number;
    const client: SseClient = {
      response,
      streamScope,
      streamId,
      buffered: [],
      replaying: true,
      lastSent: after,
      closed: false,
    };
    const key = this.key(streamScope, streamId);
    const clients = this.clients.get(key) ?? new Set<SseClient>();
    clients.add(client);
    this.clients.set(key, clients);
    response.on("close", () => this.unsubscribe(streamScope, streamId, client));
    return client;
  }

  finishReplay(streamId: string, client: SseClient, replayLast: number): void;
  finishReplay(
    streamScope: EventStreamScope,
    streamId: string,
    client: SseClient,
    replayLast: number,
  ): void;
  finishReplay(
    streamScopeOrId: string,
    clientOrId: SseClient | string,
    replayLastOrClient: number | SseClient,
    maybeReplayLast?: number,
  ): void {
    const legacy = typeof clientOrId !== "string";
    const streamScope: EventStreamScope = legacy
      ? "task"
      : (streamScopeOrId as EventStreamScope);
    const streamId = legacy ? streamScopeOrId : clientOrId;
    const client = (legacy ? clientOrId : replayLastOrClient) as SseClient;
    const replayLast = (
      legacy ? replayLastOrClient : maybeReplayLast
    ) as number;
    if (client.streamScope !== streamScope || client.streamId !== streamId)
      return;
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
    const streamScope = this.eventScope(event);
    const keys = [this.key(streamScope, event.streamId)];
    if (event.taskId && event.taskId === event.streamId) {
      if (streamScope === "run") keys.push(this.key("task", event.taskId));
      if (streamScope === "task") keys.push(this.key("run", event.taskId));
    }
    for (const key of keys)
      for (const client of this.clients.get(key) ?? []) {
        if (client.closed) continue;
        if (client.replaying) client.buffered.push(event);
        else if (event.sequence > client.lastSent) this.send(client, event);
      }
  }

  unsubscribe(streamId: string, client: SseClient): void;
  unsubscribe(
    streamScope: EventStreamScope,
    streamId: string,
    client: SseClient,
  ): void;
  unsubscribe(
    streamScopeOrId: string,
    clientOrId: SseClient | string,
    maybeClient?: SseClient,
  ): void {
    const legacy = typeof clientOrId !== "string";
    const streamScope: EventStreamScope = legacy
      ? "task"
      : (streamScopeOrId as EventStreamScope);
    const streamId = legacy ? streamScopeOrId : clientOrId;
    const client = (legacy ? clientOrId : maybeClient) as SseClient;
    client.closed = true;
    client.buffered.length = 0;
    const key = this.key(streamScope, streamId);
    const clients = this.clients.get(key);
    clients?.delete(client);
    if (clients?.size === 0) this.clients.delete(key);
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

  private key(streamScope: EventStreamScope, streamId: string): string {
    return `${streamScope}:${streamId}`;
  }

  private eventScope(event: PublicEvent): EventStreamScope {
    if (event.streamScope !== undefined) return event.streamScope;
    if (event.sessionId && event.streamId === event.sessionId) return "session";
    if (event.runId && event.streamId === event.runId) return "run";
    return "task";
  }
}

export const sseHub = new SseHub();
