# Event Service

## Purpose

The Event Service provides durable, ordered event logs for chat sessions and
the live Server-Sent Events delivery layer. It is implemented by:

- [`EventStore`](../../../src/services/events/event-store.ts), which persists
  and replays events in Postgres.
- [`SseHub`](../../../src/services/events/sse-hub.ts), which fans committed
  events out to open responses in the current process.

The public stream is:

```text
GET /chat-sessions/:sessionId/events
```

## Invariants

1. The canonical stream is session-scoped and keyed by the chat session ID.
2. Every persisted event has a session owner and uses the session ID as its
   stream ID; no other stream scope is supported.
3. Sequences are positive integers and strictly increasing per session.
4. A state mutation and its lifecycle event commit in one transaction.
5. `SseHub` receives an event only after that transaction commits.
6. Postgres is canonical; SSE can disconnect and replay from a cursor.
7. Events are append-only and consumers interpret `type`, `producerService`,
   and `payload` rather than delivery timing.

`EventStore` has no Express or SSE dependency. Producers receive an event store
and publish callback. The append methods never publish automatically.

## Persistence

The `Event` model stores the event ID, session stream ID, sequence, domain,
type, producer metadata, optional message, artifact, sandbox, and command
links, correlation ID, payload, and creation time. The database unique key on
stream scope, stream ID, and sequence prevents duplicate positions.

Use `appendSessionEventInTransaction` when an event belongs to another state
change. Use `appendSessionEvent` for a standalone event. Publish the returned
event only after the surrounding operation succeeds.

## Public event shape

```json
{
  "id": "evt_<id>",
  "streamScope": "session",
  "streamId": "chat_<id>",
  "domain": "message",
  "sessionId": "chat_<id>",
  "messageId": "msg_<id>",
  "artifactId": null,
  "sandboxId": "sbox_<id>",
  "commandId": null,
  "sequence": 4,
  "type": "message_processing_started",
  "producerService": "chat",
  "producerId": "msg_<id>",
  "correlationId": "cor_<id>",
  "payload": {},
  "createdAt": "2026-08-16T00:00:00.100Z"
}
```

Lifecycle event types include session and message events, sandbox events,
command events, agent tool events, pull request events, artifact events, diff
events, and cleanup events. `EVENT_TYPES` in
[`src/types/event.types.ts`](../../../src/types/event.types.ts) is the source
of truth.

## SSE delivery and replay

The route accepts a non-negative sequence cursor:

```http
GET /chat-sessions/chat_<id>/events?after=12
```

An explicit `after` query parameter takes precedence over `Last-Event-ID`.
Invalid cursors return `invalid_cursor`. The SSE event ID is the numeric
sequence; the data payload is the public event JSON.

`SseHub` subscribes before replaying durable events and buffers newly published
events during the query. It sorts the buffer and drops sequences already
covered by replay, closing the replay/live race. A process restart drops open
connections; clients reconnect and replay from Postgres.

## Verification

```bash
npm test -- tests/event-store.test.ts tests/sse-hub.test.ts tests/agent-events.test.ts
npm run typecheck
```
