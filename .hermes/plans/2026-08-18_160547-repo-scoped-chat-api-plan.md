# Repo-Scoped Chat Sessions API Changes Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Replace the public one-shot task API with repo-scoped chat sessions where each user message can trigger one task run in the session-owned sandbox.

**Architecture:** Introduce `ChatSession` as the user-facing repo-scoped thread and sandbox owner, and reinterpret `TaskRun` as one execution turn tied to a user message. Keep routes thin, strict Zod validation at the route boundary, lifecycle transitions in services, durable events replayable through SSE, and sandbox/agent internals hidden from callers.

**Tech Stack:** Express 5, TypeScript, Zod, Prisma/Postgres, Server-Sent Events, React/Vite frontend client.

---

## Current context

- Existing public contract is task-centric: `POST /tasks`, `GET /tasks/:taskId`, `GET /tasks/:taskId/events`, `GET /tasks/:taskId/result`, `DELETE /tasks/:taskId`.
- Existing `Task` rows contain `repoRef`, `instructions`, `sandboxId`, lifecycle timestamps, result fields, and `nextEventSequence`.
- Existing `Event` rows require `taskId` and use the task id as `streamId`; SSE replay is by numeric `sequence` cursor.
- Existing frontend API types and hooks assume `CreateTaskRequest`, `TaskSnapshot`, `TaskResult`, and `PublicTaskEvent`.
- GitHub auth, GitHub clone by URL, PR creation, queues, and users are explicitly out of scope for this change.

## API decisions

1. **Public API becomes session-first.** New frontend work should start from `/chat-sessions`; `/tasks` remains transitional only.
2. **Repo scope lives on the chat session.** A `ChatSession` has repo metadata and optional auth-ready fields. A `TaskRun` inherits repo/sandbox context from its session and must not accept `repoRef` directly.
3. **Messages are durable API resources.** User/assistant/system messages are exposed separately from low-level task events so the chat UI can render history without replaying command/tool events.
4. **One user message creates at most one run initially.** `POST /chat-sessions/:sessionId/messages` persists the user message and, by default, creates a `TaskRun` for that message.
5. **Session SSE is the primary live stream.** SSE should be available at `/chat-sessions/:sessionId/events`; a run-specific alias may exist for focused progress panes.
6. **Existing run statuses can initially mirror task statuses.** Use `created | provisioning | running | completed | failed | cancelled`, with optional API aliases `queued`/`cancelling` deferred until an actual queue exists.
7. **Event stream cursor remains numeric per stream.** For session streams, `streamId` should become `chatSessionId`; events carry `chatSessionId`, `taskRunId`, and optional `messageId`.
8. **Compatibility is short-lived and explicit.** Keep `/tasks` as deprecated wrappers during frontend migration, then remove route mounting and task frontend types once callers move to sessions.

## Proposed REST endpoints

### Create chat session

```http
POST /chat-sessions
Content-Type: application/json
```

Request concept:

```json
{
  "repo": {
    "source": "fixture",
    "ref": "./repo",
    "provider": null,
    "owner": null,
    "name": null,
    "defaultBranch": null,
    "installationId": null
  },
  "title": "Fix login tests",
  "initialMessage": {
    "content": "Find and fix the failing login tests."
  },
  "image": "node:22-bookworm"
}
```

Response `201 Created` when no run is started, or `202 Accepted` when `initialMessage` starts a run:

```json
{
  "chatSessionId": "chat_<id>",
  "title": "Fix login tests",
  "repo": {
    "source": "fixture",
    "ref": "./repo",
    "provider": null,
    "owner": null,
    "name": null,
    "defaultBranch": null,
    "installationId": null
  },
  "status": "active",
  "sandboxId": "sbox_<id>",
  "eventsUrl": "/chat-sessions/chat_<id>/events",
  "messagesUrl": "/chat-sessions/chat_<id>/messages",
  "latestRun": {
    "taskRunId": "run_<id>",
    "status": "created",
    "eventsUrl": "/chat-sessions/chat_<id>/runs/run_<id>/events"
  },
  "createdAt": "2026-08-18T10:35:47.000Z",
  "updatedAt": "2026-08-18T10:35:47.000Z"
}
```

Validation decisions:

- `repo.source` initially accepts `fixture` and `github` for auth-ready shape, but implementation may reject `github` with `501 repo_source_not_supported` until GitHub clone exists.
- For MVP execution, require `repo.source: "fixture"` and non-empty `repo.ref`; store GitHub fields only if present but do not act on them.
- Unknown body fields should be rejected.
- `initialMessage.content` is optional for session creation; if absent, create a session and sandbox without a run only if sandbox lifecycle supports it. Otherwise make `initialMessage` required for this phase.

### List chat sessions

```http
GET /chat-sessions?limit=25&cursor=<opaque>&repoSource=fixture&repoRef=./repo
```

Response:

```json
{
  "items": [
    {
      "chatSessionId": "chat_<id>",
      "title": "Fix login tests",
      "repo": { "source": "fixture", "ref": "./repo" },
      "status": "active",
      "latestRunStatus": "running",
      "lastMessagePreview": "Find and fix the failing login tests.",
      "createdAt": "2026-08-18T10:35:47.000Z",
      "updatedAt": "2026-08-18T10:36:02.000Z"
    }
  ],
  "nextCursor": null
}
```

Frontend need: sidebar/thread list, recent sessions, repo filtering once GitHub is connected.

### Get chat session

```http
GET /chat-sessions/:chatSessionId
```

Response concept includes session metadata, sandbox status, latest run summary, and resource URLs. It should not embed the full message history by default.

### Update chat session metadata

```http
PATCH /chat-sessions/:chatSessionId
```

Request:

```json
{ "title": "Better title" }
```

Keep this narrow. Do not allow repo changes after session creation because the sandbox and history are repo-scoped.

### List messages with pagination

```http
GET /chat-sessions/:chatSessionId/messages?limit=50&before=<messageCursor>
```

Response:

```json
{
  "items": [
    {
      "messageId": "msg_<id>",
      "chatSessionId": "chat_<id>",
      "role": "user",
      "content": "Find and fix the failing login tests.",
      "taskRunId": "run_<id>",
      "createdAt": "2026-08-18T10:35:47.000Z"
    },
    {
      "messageId": "msg_<id>",
      "chatSessionId": "chat_<id>",
      "role": "assistant",
      "content": "I fixed the assertion mismatch and tests now pass.",
      "taskRunId": "run_<id>",
      "createdAt": "2026-08-18T10:36:10.000Z"
    }
  ],
  "nextCursor": null
}
```

Pagination decisions:

- Sort newest-first for efficient chat backfill, or oldest-first for display with `after`; choose one and document it. Recommended: `before` cursor returns messages older than the oldest loaded message, with `items` ordered ascending for direct render.
- Cursor should be opaque, but can encode `(createdAt, id)` internally.
- Default `limit` 50, max 100.

### Add user message and start a run

```http
POST /chat-sessions/:chatSessionId/messages
Content-Type: application/json
```

Request:

```json
{
  "content": "Now add a regression test.",
  "startRun": true
}
```

Response `202 Accepted`:

```json
{
  "message": {
    "messageId": "msg_<id>",
    "role": "user",
    "content": "Now add a regression test.",
    "taskRunId": "run_<id>",
    "createdAt": "2026-08-18T10:40:00.000Z"
  },
  "run": {
    "taskRunId": "run_<id>",
    "chatSessionId": "chat_<id>",
    "triggerMessageId": "msg_<id>",
    "status": "created",
    "eventsUrl": "/chat-sessions/chat_<id>/runs/run_<id>/events",
    "resultUrl": "/chat-sessions/chat_<id>/runs/run_<id>/result",
    "createdAt": "2026-08-18T10:40:00.000Z"
  },
  "eventsUrl": "/chat-sessions/chat_<id>/events"
}
```

Concurrency/error decision:

- Initially allow only one active run per session. If a run is `created | provisioning | running`, a new `startRun: true` request returns `409 session_run_in_progress` with details containing the active `taskRunId` and `eventsUrl`.
- If the user wants to append a message without execution later, allow `startRun: false` and return `201 Created`; otherwise omit until product needs it.

### List task runs in a session

```http
GET /chat-sessions/:chatSessionId/runs?limit=25&cursor=<opaque>
```

Response:

```json
{
  "items": [
    {
      "taskRunId": "run_<id>",
      "chatSessionId": "chat_<id>",
      "triggerMessageId": "msg_<id>",
      "status": "completed",
      "resultUrl": "/chat-sessions/chat_<id>/runs/run_<id>/result",
      "createdAt": "2026-08-18T10:40:00.000Z",
      "runningAt": "2026-08-18T10:40:02.000Z",
      "completedAt": "2026-08-18T10:41:00.000Z",
      "failure": null
    }
  ],
  "nextCursor": null
}
```

Frontend need: show per-turn progress, retry/cancel affordances, compact run history/debug details.

### Get run status

```http
GET /chat-sessions/:chatSessionId/runs/:taskRunId
```

Response concept mirrors existing `TaskSnapshot`, but uses `taskRunId`, includes `chatSessionId`, `triggerMessageId`, `sandboxId`, inherited repo metadata, timestamps, `failure`, and URLs.

### Stream session or run events

```http
GET /chat-sessions/:chatSessionId/events?after=0
GET /chat-sessions/:chatSessionId/runs/:taskRunId/events?after=0
```

- Session stream is the canonical UI stream and includes message/run/sandbox/agent/tool events for the whole thread.
- Run stream is optional convenience filtering for one run. If implemented, it should use the same durable event table filtered by `taskRunId`, not a separate in-memory channel.
- Continue supporting `Last-Event-ID` and keepalive comments.

### Get run result

```http
GET /chat-sessions/:chatSessionId/runs/:taskRunId/result
```

Response concept:

```json
{
  "taskRunId": "run_<id>",
  "chatSessionId": "chat_<id>",
  "status": "completed",
  "diff": "diff --git ...",
  "assistantMessageId": "msg_<id>",
  "agentSummary": "I fixed the assertion mismatch and added a regression test.",
  "exitReason": "completed",
  "failure": null,
  "createdAt": "2026-08-18T10:40:00.000Z",
  "completedAt": "2026-08-18T10:41:00.000Z"
}
```

Active runs return `409 run_not_terminal`. Missing or cross-session runs return `404 run_not_found` to avoid leaking ids.

### Cancel run

```http
DELETE /chat-sessions/:chatSessionId/runs/:taskRunId
```

Response mirrors existing cancellation semantics:

- `202 { "taskRunId": "run_<id>", "status": "cancelling", "eventsUrl": "..." }` for active runs.
- `200 { "taskRunId": "run_<id>", "status": "cancelled" }` for already cancelled.
- `409 run_already_terminal` for completed/failed runs.

## SSE event payload concepts

Event frame format should continue as named events:

```text
id: 42
event: run_running
data: { ...PublicChatEvent }
```

Public event shape:

```ts
type PublicChatEvent = {
  id: string;
  streamId: string;
  sequence: number;
  type: ChatEventType;
  producerService:
    | "chat"
    | "run"
    | "task"
    | "sandbox"
    | "command"
    | "runtime"
    | "cleanup"
    | "agent";
  producerId: string;
  chatSessionId: string;
  taskRunId: string | null;
  messageId: string | null;
  sandboxId: string | null;
  commandId: string | null;
  correlationId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};
```

New high-level event types:

- `chat_session_created`
- `chat_session_updated`
- `message_created`
- `run_created`
- `run_provisioning_started`
- `run_running`
- `run_completed`
- `run_failed`
- `run_cancelled`
- `run_result_ready`

Compatibility event decisions:

- Either rename task lifecycle events to run lifecycle events in the public API, or temporarily emit aliases. Recommendation: emit `run_*` for new session endpoints and keep existing `task_*` only on deprecated `/tasks/:taskId/events`.
- Preserve existing sandbox/command/agent events, but add `chatSessionId` and `taskRunId` so the frontend can group them.
- Use `message_created` for both user and assistant messages. Payload may include `{ "role": "assistant" }`, but the canonical content should be read via messages API or included in payload for real-time display.

## Error states and status codes

- `400 invalid_request`: strict Zod validation failure, bad cursor, unsupported enum value.
- `401 unauthenticated`: reserved for future auth middleware.
- `403 repo_access_denied`: reserved for future GitHub/user authorization.
- `404 chat_session_not_found`: session does not exist or is not visible to caller.
- `404 message_not_found`: only if individual message endpoints are added.
- `404 run_not_found`: run missing or not owned by the session path.
- `409 session_run_in_progress`: cannot start another run in same session yet.
- `409 run_not_terminal`: result requested before terminal state.
- `409 run_already_terminal`: cancellation requested for completed/failed run.
- `410 endpoint_retired`: optional explicit response during final `/tasks` removal window; otherwise return existing `404 not_found` after unmounting.
- `422 repo_scope_unavailable`: repo shape is valid but cannot be executed in this phase.
- `501 repo_source_not_supported`: `repo.source: "github"` supplied before GitHub execution exists.

All error bodies should keep the existing shape:

```json
{
  "error": {
    "code": "session_run_in_progress",
    "message": "A run is already active for this chat session",
    "details": { "taskRunId": "run_<id>", "eventsUrl": "..." }
  }
}
```

## Auth-ready repo scope fields

Recommended API type:

```ts
type RepoScope = {
  source: "fixture" | "github";
  ref: string;
  provider: "github" | null;
  owner: string | null;
  name: string | null;
  repoId: string | null;
  defaultBranch: string | null;
  installationId: string | null;
  cloneUrl: string | null;
};
```

MVP rules:

- `source: "fixture"`: `ref` is the existing local fixture path accepted by sandbox runtime; other fields are nullable.
- `source: "github"`: accept/store fields only if product wants pre-wiring, but return `501` when execution would require clone/auth.
- Do not introduce tokens, user ids, or GitHub API calls in this domain change.
- Prefer nullable columns over JSON-only storage for fields likely to become query filters: `repoSource`, `repoRef`, `repoProvider`, `repoOwner`, `repoName`, `repoId`, `repoDefaultBranch`, `repoInstallationId`.

## Compatibility/removal strategy for existing task endpoints

Phase 1: Add new endpoints beside existing `/tasks`.

- Implement `ChatSession`/`TaskRun` types and routes.
- Keep `/tasks` tests passing.
- Add deprecation headers to `/tasks` responses: `Deprecation: true`, `Link: </chat-sessions>; rel="successor-version"`, optionally `Sunset` if a date is known.

Phase 2: Migrate frontend.

- Replace `createTask/getTask/getTaskResult/cancelTask/useTaskEvents` with session/run equivalents.
- Keep task API client functions only if external callers need them.

Phase 3: Freeze `/tasks`.

- Stop adding fields to old task payloads except critical compatibility fields.
- Document `/tasks` as deprecated in `docs/modules/task-service/README.md`.

Phase 4: Remove `/tasks` public route.

- Remove mounting from `src/server.ts` only after frontend and acceptance scripts use `/chat-sessions`.
- Update retired-route tests in `tests/api.test.ts` to expect `/tasks` returns `404` or `410`.
- Keep internal `TaskRun` implementation names consistent; avoid retaining public `Task` terminology in new frontend types.

## Frontend needs

- Session list API for sidebar: title, repo display, latest status, updated timestamp, preview.
- Session detail API for metadata and status badges.
- Paginated message history with stable cursors and direct role/content fields.
- Message send API that returns both persisted user message and created run.
- Session-level SSE URL for real-time `message_created`, run status changes, command output, agent tool events, and result readiness.
- Run status/result URLs for reload recovery and focused progress panel.
- Error details for `session_run_in_progress` so UI can reattach to active run instead of creating duplicates.
- Event dedupe by sequence should continue, but frontend hook should key by `chatSessionId` and reset on session change.

## Likely backend files to change

- Create/modify types:
  - `src/types/chat.types.ts` or split `src/types/chat-session.types.ts` and `src/types/task-run.types.ts`
  - `src/types/event.types.ts`
- Create/modify routes:
  - `src/routes/chat-session.routes.ts`
  - `src/routes/task.routes.ts` for deprecation headers or wrapper behavior
  - `src/server.ts` to mount new router
- Create/modify services:
  - `src/services/task/task.ts` or new `src/services/chat/chat-session.ts`
  - `src/services/task/task-runner.ts` context should include `chatSessionId`, `taskRunId`, `messageId`
  - `src/services/events/event-store.ts`
  - `src/services/events/sse-hub.ts` if stream ids move from task ids to session ids
- Modify persistence:
  - `prisma/schema.prisma`
  - generated Prisma migration via `npm run prisma:migrate:dev`
- Modify frontend API:
  - `frontend/src/api/types.ts`
  - `frontend/src/api/client.ts`
  - `frontend/src/api/useTaskEvents.ts` or replace with `useChatEvents.ts`
  - UI components that call task API, discovered during implementation
- Modify docs:
  - `docs/modules/task-service/README.md`
  - `docs/modules/frontend/README.md`
  - possibly `docs/modules/event-service/README.md`

## Suggested persistence model

Conceptual schema:

```prisma
model ChatSession {
  id                 String   @id
  title              String?
  status             String
  repoSource         String   @map("repo_source")
  repoRef            String   @map("repo_ref")
  repoProvider       String?  @map("repo_provider")
  repoOwner          String?  @map("repo_owner")
  repoName           String?  @map("repo_name")
  repoId             String?  @map("repo_id")
  repoDefaultBranch  String?  @map("repo_default_branch")
  repoInstallationId String?  @map("repo_installation_id")
  image              String?
  sandboxId          String?  @unique @map("sandbox_id")
  nextEventSequence  Int      @default(1) @map("next_event_sequence")
  createdAt          DateTime @default(now()) @map("created_at")
  updatedAt          DateTime @updatedAt @map("updated_at")
  archivedAt         DateTime? @map("archived_at")
}

model ChatMessage {
  id            String   @id
  chatSessionId String   @map("chat_session_id")
  taskRunId     String?  @map("task_run_id")
  role          String
  content       String
  createdAt     DateTime @default(now()) @map("created_at")
}

model TaskRun {
  id               String   @id
  chatSessionId    String   @map("chat_session_id")
  triggerMessageId String   @map("trigger_message_id")
  status           TaskStatus
  sandboxId        String?  @map("sandbox_id")
  instructions     String
  diff             String?
  agentSummary     String?  @map("agent_summary")
  exitReason       String?  @map("exit_reason")
  failureCode      String?  @map("failure_code")
  failureMessage   String?  @map("failure_message")
  createdAt        DateTime @default(now()) @map("created_at")
  updatedAt        DateTime @updatedAt @map("updated_at")
  provisioningAt   DateTime? @map("provisioning_at")
  runningAt        DateTime? @map("running_at")
  completedAt      DateTime? @map("completed_at")
  failedAt         DateTime? @map("failed_at")
  cancelledAt      DateTime? @map("cancelled_at")
}
```

Important migration decisions:

- Decide whether to rename existing `tasks` to `task_runs` or create new tables and migrate. New tables are safer for compatibility; renames reduce duplicated code but make deprecation harder.
- Session-owned sandbox implies one sandbox per `ChatSession`, reused across runs. If current TaskService creates one sandbox per task, implementation must move sandbox creation/ownership to session creation or first run.
- Event table should either add nullable `chat_session_id`, `task_run_id`, `message_id` columns, or be rebuilt for chat streams. Adding columns is less disruptive.

## Implementation task outline

### Task 1: Define public chat/run types and validation schemas

**Objective:** Add strict Zod schemas and TypeScript contracts for session creation, messages, runs, pagination, and SSE events.

**Files:**

- Create: `src/types/chat.types.ts`
- Modify: `src/types/event.types.ts`
- Test: `tests/chat-routes.test.ts`

**Verification:** `npm test -- tests/chat-routes.test.ts`

### Task 2: Add route tests for the new REST contract

**Objective:** Lock API shape before service implementation.

**Files:**

- Create: `tests/chat-routes.test.ts`
- Modify: `tests/api.test.ts`

Test cases:

- `POST /chat-sessions` rejects unknown fields.
- `POST /chat-sessions` dispatches repo scope and optional initial message.
- `GET /chat-sessions/:id/messages` validates limit/cursor and returns paginated shape.
- `POST /chat-sessions/:id/messages` returns `202` with message/run.
- `GET /chat-sessions/:id/events?after=0` replays SSE.
- `DELETE /chat-sessions/:id/runs/:runId` returns `202` for cancelling.
- Cross-session run path returns `404 run_not_found`.

### Task 3: Add persistence migration for sessions/messages/runs/events

**Objective:** Persist chat sessions, messages, task runs, and chat-aware event metadata.

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<generated>/migration.sql`

**Command:** `npm run prisma:migrate:dev`

### Task 4: Add ChatSessionService and run orchestration seam

**Objective:** Implement service methods used by routes while preserving dependency direction.

**Files:**

- Create: `src/services/chat/chat-session.ts`
- Modify: `src/services/task/task-runner.ts`
- Possibly modify: `src/services/task/task.ts`

**Key service methods:**

- `createSession(input)`
- `listSessions(query)`
- `getSession(chatSessionId)`
- `listMessages(chatSessionId, page)`
- `appendUserMessage(chatSessionId, input)`
- `listRuns(chatSessionId, page)`
- `getRun(chatSessionId, taskRunId)`
- `eventsAfter(chatSessionId, after)`
- `result(chatSessionId, taskRunId)`
- `cancelRun(chatSessionId, taskRunId)`

### Task 5: Update EventStore/SseHub for session streams

**Objective:** Make durable session event replay and live delivery work with session stream ids and run metadata.

**Files:**

- Modify: `src/services/events/event-store.ts`
- Modify: `src/services/events/sse-hub.ts` only if API assumptions require changes
- Modify: `src/routes/sse.ts` only if cursor parsing changes
- Test: `tests/event-store.test.ts`, `tests/sse-hub.test.ts`, `tests/chat-routes.test.ts`

### Task 6: Mount routes and add compatibility/deprecation behavior

**Objective:** Expose `/chat-sessions` while preserving or deprecating `/tasks` intentionally.

**Files:**

- Create: `src/routes/chat-session.routes.ts`
- Modify: `src/server.ts`
- Modify: `src/routes/task.routes.ts`
- Test: `tests/api.test.ts`, `tests/task-routes.test.ts`, `tests/chat-routes.test.ts`

### Task 7: Update frontend API client and event hook

**Objective:** Provide frontend-ready types and functions for sessions, messages, runs, and session SSE.

**Files:**

- Modify: `frontend/src/api/types.ts`
- Modify: `frontend/src/api/client.ts`
- Create or modify: `frontend/src/api/useChatEvents.ts`
- Later UI files discovered by `search_files("createTask|getTask|useTaskEvents", path="frontend/src", file_glob="*.tsx")`

### Task 8: Update docs and acceptance tests

**Objective:** Document new public contract and make the old task API status explicit.

**Files:**

- Modify: `docs/modules/task-service/README.md`
- Modify: `docs/modules/event-service/README.md`
- Modify: `docs/modules/frontend/README.md`
- Modify or create acceptance script for chat-session flow if present

## Tests and validation

Targeted tests:

- `npm test -- tests/chat-routes.test.ts`
- `npm test -- tests/task-routes.test.ts`
- `npm test -- tests/api.test.ts`
- `npm test -- tests/event-store.test.ts`
- `npm test -- tests/sse-hub.test.ts`
- `npm test -- tests/task-service.test.ts`

Broader checks:

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run build`

Manual/acceptance checks after implementation:

1. Create a chat session with an initial message.
2. Connect to `/chat-sessions/:id/events` and confirm replay includes `chat_session_created`, `message_created`, `run_created`, and run lifecycle events.
3. Refresh the frontend and confirm messages load from `/messages` without replaying every low-level event.
4. Try a second message while a run is active and confirm `409 session_run_in_progress` includes active run details.
5. Cancel a running task run and confirm run status, SSE, and result endpoint agree.
6. Confirm old `/tasks` behavior is either still passing with deprecation headers or intentionally retired in tests/docs.

## Dependencies

- Schema/data model decision: new `chat_sessions`, `chat_messages`, `task_runs` tables vs renaming/reusing existing `tasks`.
- Sandbox lifecycle decision: create sandbox at session creation vs first run; whether idle sessions can exist without sandbox.
- Event stream ownership decision: session stream only vs both session and run streams.
- Frontend migration order: API client first, then UI components, then old task route retirement.
- GitHub future compatibility: finalize repo scope shape now, but do not add GitHub auth, clone, token storage, or PR APIs.

## Risks and tradeoffs

- **Terminology drift:** Keeping internal `Task` names while public API says `TaskRun` can confuse future changes. Prefer explicit new types even if implementation temporarily wraps old service code.
- **Event migration complexity:** Existing events require `taskId`; session streams require `chatSessionId`. Additive nullable columns reduce risk but require careful query/index updates.
- **Sandbox reuse:** Session-owned sandbox changes lifecycle semantics from one sandbox per task to one sandbox per thread. This may expose state leakage between runs, but that is also the desired chat-thread behavior.
- **Concurrent runs:** Blocking concurrent runs is simpler and safer; if future UX wants parallel turns, the data model should already allow multiple runs per session but service guards can be relaxed later.
- **Frontend reload recovery:** If messages are only emitted as SSE payloads and not persisted cleanly, refresh will lose chat history. Persist messages first, then emit events.
- **Deprecated endpoint lifetime:** Supporting `/tasks` wrappers too long can double maintenance. Set a clear removal checkpoint tied to frontend migration and acceptance tests.
- **Auth-ready fields:** Adding GitHub-shaped fields now helps future work, but executing GitHub repo scopes before auth/clone exists must fail loudly with `501`, not silently treat them as fixture paths.

## Open questions for implementer/product

1. Should `POST /chat-sessions` require an initial message, or allow empty draft sessions?
2. Should sandbox provisioning happen at session creation or first run creation?
3. Should the session stream include all low-level command output by default, or should verbose events require a `?verbosity=debug` query later?
4. Should old `/tasks` return deprecation headers first, or is immediate removal acceptable because there are no external clients?
5. Should assistant final summaries always become `assistant` messages, or should failed/cancelled runs only expose result metadata?
6. What title generation behavior is desired before an LLM title generator exists: explicit title, first-message preview, or repo-based fallback?
