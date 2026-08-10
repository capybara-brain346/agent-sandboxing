import type { Response } from "express";
import type { PublicEvent } from "../../types/sandbox.types";

type Client = {
  response: Response;
  buffered: PublicEvent[];
  replaying: boolean;
  lastSent: number;
};
export class SseHub {
  private readonly clients = new Map<string, Set<Client>>();
  subscribe(sandboxId: string, response: Response, after: number): Client {
    const client: Client = {
      response,
      buffered: [],
      replaying: true,
      lastSent: after,
    };
    const set = this.clients.get(sandboxId) ?? new Set<Client>();
    set.add(client);
    this.clients.set(sandboxId, set);
    response.on("close", () => this.unsubscribe(sandboxId, client));
    return client;
  }
  finishReplay(sandboxId: string, client: Client, replayLast: number): void {
    client.lastSent = Math.max(client.lastSent, replayLast);
    client.replaying = false;
    for (const event of client.buffered.splice(0))
      if (event.sequence > client.lastSent) {
        this.send(client, event);
      }
  }
  publish(event: PublicEvent): void {
    for (const client of this.clients.get(event.sandboxId) ?? []) {
      if (client.replaying) client.buffered.push(event);
      else if (event.sequence > client.lastSent) this.send(client, event);
    }
  }
  private send(client: Client, event: PublicEvent): void {
    client.response.write(
      `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
    );
    client.lastSent = event.sequence;
  }
  private unsubscribe(sandboxId: string, client: Client): void {
    const set = this.clients.get(sandboxId);
    set?.delete(client);
    if (set?.size === 0) this.clients.delete(sandboxId);
  }
  closeAll(): void {
    for (const set of this.clients.values())
      for (const client of set) client.response.end();
    this.clients.clear();
  }
}

export const sseHub = new SseHub();
