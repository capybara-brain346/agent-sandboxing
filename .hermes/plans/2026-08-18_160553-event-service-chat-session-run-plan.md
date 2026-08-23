# Event Service Chat Sessions/Runs Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Evolve the event domain from “every event belongs to a task stream” to chat sessions owning conversation/workspace, task runs representing execution attempts, and committed events powering replayable SSE/timeline/chat views.

**Architecture:** Keep the core invariant: persist lifecycle state change and its event in one database transaction, then publish to SSE only after commit. Introduce session-scoped streams for conversation and run-scoped streams for execution, while retaining taskId as a compatibility alias during migration. Treat raw logs/tool outputs as artifacts with event summaries/pointers, not prompt-context messages.

**Tech Stack:** TypeScript, Node/Express, Prisma/PostgreSQL, Vitest, React/EventSource frontend.

---

## Decisions

### Domain ownership

1. **ChatSession owns conversation and workspace.**
   - A session is the durable user-facing object: title, repo/workspace config, current status, created/updated timestamps, and `nextEventSequence` for the session stream.
   - All messages and all run attempts attach to a session.

2. **TaskRun is one execution attempt.**
   - A run is the operational lifecycle object: provisioning/running/completed/failed/cancelled status, sandbox/command references, diff/result/summary/failure metadata, and `nextEventSequence` for the run stream if run-local ordering is kept.
   - Retries create new `TaskRun` rows under the same `ChatSession`; they do not mutate prior run history.

3. **Task is deprecated as a stream owner.**
   - Existing `Task` maps conceptually to `TaskRun` for migration.
   - Keep `taskId` in public payloads/routes temporarily as `legacyTaskId`/alias to avoid breaking current tests and clients, but new writes should prefer `sessionId` and `runId`.

### Event stream boundaries

Use two first-class stream scopes:

1. **Session stream** (`streamScope = "session"`, `streamId = sessionId`)
   - Source of truth for UI chat/timeline replay.
   - Contains conversation message events, high-level run lifecycle events, artifact visibility events, and session status changes.
   - Monotonic `sequence` ordered by `ChatSession.nextEventSequence`.

2. **Run stream** (`streamScope = "run"`, `streamId = runId`)
   - Detailed harness/runtime stream for one attempt.
   - Contains sandbox, command, agent tool, raw log pointer, and fine-grained harness visibility events.
   - Monotonic `sequence` ordered by `TaskRun.nextEventSequence`.

3. **Optional aggregate view:** `/sessions/:sessionId/events` reads the session stream and can include summarized run milestones. It should not merge every run-stream log into prompt-visible chat by default. If a full diagnostic timeline is needed, add a query such as `?includeRunEvents=true` that returns a merged projection with an explicit composite cursor.

### Event taxonomy

Split event names by domain prefix. Existing names can be supported as legacy aliases but new events should be semantically grouped.

#### Session/message events

- `session_created`
- `session_title_updated`
- `session_workspace_attached`
- `session_archived` / `session_deleted` if needed
- `message_created`
- `message_updated` (rare; e.g. assistant streaming finalized or edited)
- `message_deleted` / `message_redacted` if needed
- `assistant_message_started`
- `assistant_message_delta` (only if streaming tokens are persisted; otherwise avoid noisy token events)
- `assistant_message_completed`
- `run_requested` (user/assistant intent that spawned a run)

#### Run lifecycle events

- `run_created`
- `run_provisioning_started`
- `run_running`
- `run_completed`
- `run_failed`
- `run_cancelled`
- `run_result_ready`

Map current task events:

- `task_created` → `run_created` plus session `run_requested` if created from a message
- `task_provisioning_started` → `run_provisioning_started`
- `task_running` → `run_running`
- `task_completed` → `run_completed`
- `task_failed` → `run_failed`
- `task_cancelled` → `run_cancelled`
- `task_result_ready` → `run_result_ready`

#### Harness/runtime visibility events

Keep under run stream by default:

- `sandbox_created`
- `sandbox_provisioning_started`
- `fixture_repo_copy_started`
- `fixture_repo_copied`
- `sandbox_ready`
- `sandbox_failed`
- `sandbox_stopping`
- `sandbox_stopped`
- `command_started`
- `command_output_artifact_created` (replaces large/noisy `command_output` payloads)
- `command_completed`
- `command_failed`
- `command_timed_out`
- `command_cancelled`
- `agent_tool_call_started` (renames `agent_tool_call`)
- `agent_tool_call_completed` (renames `agent_tool_result`)
- `git_diff_requested`
- `git_diff_completed`
- `cleanup_started`
- `cleanup_completed`

### Message events vs run events

1. **Messages are prompt-context candidates.**
   - Persist messages in a `Message` table with `role`, `content`, `sessionId`, optional `runId`, and metadata.
   - Message events announce the lifecycle of message rows; they do not contain raw command logs/tool output except user/assistant-authored message content.

2. **Run events are operational telemetry.**
   - Run events show what the harness/agent did and link to artifacts.
   - Run events must not automatically become model prompt context.

3. **Tool outputs and command logs are artifacts.**
   - Store full raw outputs in an `Artifact`/`RunArtifact` table or blob/file backing store.
   - Events carry bounded render-safe metadata: artifact id, content type, byte size, truncated flag, line range, short preview, and redaction status.
   - Prompt construction should explicitly select message history plus curated run summary/diff/artifact excerpts, never blindly replay all events.

### SSE shape

#### Public event envelope

New canonical envelope:

```ts
type PublicEventV2 = {
  id: string;
  stream: {
    scope: "session" | "run";
    id: string;
    sequence: number;
  };
  sessionId: string;
  runId: string | null;
  taskId?: string | null; // legacy compatibility only
  sandboxId: string | null;
  commandId: string | null;
  artifactId: string | null;
  messageId: string | null;
  type: EventTypeV2;
  domain:
    | "session"
    | "message"
    | "run"
    | "sandbox"
    | "command"
    | "agent"
    | "artifact"
    | "cleanup";
  producer: {
    service: EventProducerServiceV2;
    id: string;
  };
  correlationId: string | null;
  causationId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};
```

Keep `id: <sequence>` in SSE only for single-scope streams. For aggregate streams, use a composite Last-Event-ID such as `session:<sequence>` or JSON/base64 cursor.

#### Routes

- `GET /sessions/:sessionId/events?after=<sequence>`: canonical chat/session stream. Replays session events, subscribes to post-commit session events.
- `GET /sessions/:sessionId/runs/:runId/events?after=<sequence>` or `GET /runs/:runId/events`: detailed run stream.
- Existing `GET /tasks/:taskId/events` remains as compatibility adapter resolving taskId → runId and returning run events in legacy envelope until removed.

### Ordering and replay

1. **Per-stream total order:** enforce `@@unique([streamScope, streamId, sequence])`.
2. **No global total order required:** use `createdAt` and event id only for diagnostics, not correctness.
3. **Replay-before-live race:** preserve current subscribe-buffer-replay-finish pattern, but key clients by `streamScope + streamId` rather than taskId.
4. **Aggregate rendering:** frontend should sort within each stream by `sequence`; if combining session/run streams, use session milestone events as anchors and nest run events by runId rather than pretending a single total sequence exists.
5. **Idempotence:** clients dedupe by `event.id` or `(stream.scope, stream.id, stream.sequence)`, not just numeric sequence.

### Transaction boundaries

1. Event appends that represent lifecycle transitions must happen in the same transaction as the state row update:
   - `ChatSession.status/title/workspace` + `session_*` event
   - `Message` create/update + `message_*` event
   - `TaskRun.status/result/failure` + `run_*` event
   - `Sandbox/Command` status changes + corresponding run events
   - `Artifact` create/update + `artifact_*` or pointer event

2. Publish after commit only:
   - Transaction returns one or more `PublicEventV2`s.
   - Service loops through returned events and calls `sseHub.publish()` after transaction success.
   - Failed transactions publish nothing.

3. Multi-stream writes:
   - For operations needing both session and run events, write both in the same DB transaction if they describe the same committed state change (e.g. create run row and append session `run_created` plus run `run_created`).
   - Lock each stream owner row before assigning sequence (`SELECT next_event_sequence ... FOR UPDATE`). Always lock in deterministic order (`ChatSession`, then `TaskRun`) to avoid deadlocks.

---

## Data model implications

### Prisma model additions/changes

Likely changes in `prisma/schema.prisma`:

```prisma
enum ChatSessionStatus {
  active
  archived
  deleted
}

enum RunStatus {
  created
  provisioning
  running
  completed
  failed
  cancelled
}

enum MessageRole {
  system
  user
  assistant
  tool // only if explicitly persisted as conversation, not raw artifact logs
}

model ChatSession {
  id                String            @id
  status            ChatSessionStatus @default(active)
  title             String?
  repoRef           String?           @map("repo_ref")
  workspacePath     String?           @map("workspace_path")
  image             String?
  nextEventSequence Int               @default(1) @map("next_event_sequence")
  createdAt         DateTime          @default(now()) @map("created_at")
  updatedAt         DateTime          @updatedAt @map("updated_at")

  messages Message[]
  runs     TaskRun[]
  events   Event[] @relation("SessionEvents")

  @@index([status, createdAt])
  @@map("chat_sessions")
}

model Message {
  id          String      @id
  sessionId   String      @map("session_id")
  runId       String?     @map("run_id")
  role        MessageRole
  content     String
  metadata    Json?
  createdAt   DateTime    @default(now()) @map("created_at")
  updatedAt   DateTime    @updatedAt @map("updated_at")

  session ChatSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  run     TaskRun?    @relation(fields: [runId], references: [id], onDelete: SetNull)
  events  Event[]     @relation("MessageEvents")

  @@index([sessionId, createdAt])
  @@index([runId, createdAt])
  @@map("messages")
}

model TaskRun {
  id                String    @id @map("id")
  sessionId         String    @map("session_id")
  legacyTaskId      String?   @unique @map("legacy_task_id")
  status            RunStatus
  instructions      String
  sandboxId         String?   @unique @map("sandbox_id")
  nextEventSequence Int       @default(1) @map("next_event_sequence")
  diff              String?
  agentSummary      String?   @map("agent_summary")
  exitReason        String?   @map("exit_reason")
  failureCode       String?   @map("failure_code")
  failureMessage    String?   @map("failure_message")
  createdAt         DateTime  @default(now()) @map("created_at")
  updatedAt         DateTime  @updatedAt @map("updated_at")
  provisioningAt    DateTime? @map("provisioning_at")
  runningAt         DateTime? @map("running_at")
  completedAt       DateTime? @map("completed_at")
  failedAt          DateTime? @map("failed_at")
  cancelledAt       DateTime? @map("cancelled_at")

  session   ChatSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  messages  Message[]
  artifacts Artifact[]
  events    Event[] @relation("RunEvents")

  @@index([sessionId, createdAt])
  @@index([status, createdAt])
  @@map("task_runs")
}

model Artifact {
  id           String   @id
  sessionId    String   @map("session_id")
  runId        String?  @map("run_id")
  kind         String
  contentType  String   @map("content_type")
  uri          String
  byteSize     Int      @map("byte_size")
  sha256       String?
  preview      String?
  redacted     Boolean  @default(false)
  createdAt    DateTime @default(now()) @map("created_at")

  run    TaskRun? @relation(fields: [runId], references: [id], onDelete: Cascade)
  events Event[]  @relation("ArtifactEvents")

  @@index([sessionId, createdAt])
  @@index([runId, createdAt])
  @@map("artifacts")
}
```

Update `Event` rather than replacing it wholesale:

```prisma
model Event {
  id              String   @id
  streamScope     String   @map("stream_scope") // session | run; later enum
  streamId        String   @map("stream_id")
  sequence        Int
  type            String
  domain          String
  producerService String   @map("producer_service")
  producerId      String   @map("producer_id")
  sessionId       String   @map("session_id")
  runId           String?  @map("run_id")
  taskId          String?  @map("task_id") // nullable legacy
  sandboxId       String?  @map("sandbox_id")
  commandId       String?  @map("command_id")
  artifactId      String?  @map("artifact_id")
  messageId       String?  @map("message_id")
  correlationId   String?  @map("correlation_id")
  causationId     String?  @map("causation_id")
  payload         Json
  createdAt       DateTime @default(now()) @map("created_at")

  session ChatSession @relation("SessionEvents", fields: [sessionId], references: [id], onDelete: Cascade)
  run     TaskRun?    @relation("RunEvents", fields: [runId], references: [id], onDelete: Cascade)
  message Message?    @relation("MessageEvents", fields: [messageId], references: [id], onDelete: SetNull)
  artifact Artifact?  @relation("ArtifactEvents", fields: [artifactId], references: [id], onDelete: SetNull)

  @@unique([streamScope, streamId, sequence])
  @@index([sessionId, sequence])
  @@index([runId, sequence])
  @@index([streamScope, streamId, sequence])
  @@index([producerService, producerId])
  @@index([artifactId])
  @@map("events")
}
```

### Compatibility constraints

- Initial migration can backfill one `ChatSession` and one `TaskRun` per existing `Task`.
- `TaskRun.id` can initially equal old `Task.id` to minimize route/test churn, with `legacyTaskId` also set.
- Existing event rows get `streamScope = "run"`, `runId = taskId`, `sessionId = generated session id`, and retain `taskId`.
- Existing `streamId` values remain task ids/run ids for run-stream compatibility.

---

## Event payload concepts

Keep payloads small, stable, and display-oriented. Put large/unsafe data behind artifact references.

### `message_created`

```json
{
  "role": "user",
  "content_preview": "Please fix the test suite...",
  "content_bytes": 34,
  "run_id": null
}
```

Full message content is loaded via messages API or snapshot, not necessarily from event payload.

### `run_created`

```json
{
  "instructions_preview": "Implement the requested change...",
  "model": "openrouter/anthropic/claude-sonnet-4",
  "workspace_path": "/repo/workspaces/sess_...",
  "retry_of_run_id": null
}
```

### `run_completed` / `run_failed` / `run_cancelled`

```json
{
  "exit_reason": "completed",
  "agent_summary_present": true,
  "result_artifact_id": "art_...",
  "diff_artifact_id": "art_..."
}
```

Failure payload:

```json
{
  "code": "task_run_failed",
  "message": "Task run failed",
  "operation": "run_task",
  "retryable": false
}
```

### `agent_tool_call_started`

```json
{
  "tool_name": "bash",
  "args_preview": { "command": "npm test" },
  "args_redacted": false
}
```

### `agent_tool_call_completed`

```json
{
  "tool_name": "bash",
  "status": "succeeded",
  "exit_code": 0,
  "duration_ms": 1234,
  "result_artifact_id": "art_...",
  "result_preview": "3 tests passed",
  "truncated": true
}
```

### `command_output_artifact_created`

```json
{
  "command_id": "cmd_...",
  "artifact_id": "art_...",
  "stream": "stdout",
  "byte_size": 8192,
  "preview": "npm test\n...",
  "truncated": false
}
```

---

## Implementation tasks

### Task 1: Add canonical event/domain types

**Objective:** Define V2 identifiers, event names, stream scopes, and public envelope while keeping legacy types available.

**Files:**

- Modify: `src/types/event.types.ts`
- Modify: `src/types/task.types.ts`
- Modify: `frontend/src/api/types.ts`
- Test: `tests/agent-events.test.ts`
- Test: add/modify `tests/event-store.test.ts`

**Steps:**

1. Add `EVENT_STREAM_SCOPES = ["session", "run"]`.
2. Add prefixed V2 event type constants while keeping old `EVENT_TYPES` as a union/alias during migration.
3. Add `PublicEventV2` with `sessionId`, nullable `runId`, nullable legacy `taskId`, `messageId`, `artifactId`, and nested `stream`/`producer`.
4. Add frontend mirror types.
5. Add type/schema tests that reject missing `sessionId` on V2 events but allow legacy `PublicEvent` in compatibility paths.

### Task 2: Migrate database schema for sessions, runs, messages, artifacts

**Objective:** Introduce the new persistent owners and nullable/expanded event references.

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_chat_sessions_runs_events/migration.sql`
- Test: existing Prisma-backed tests and `npm run prisma:generate`

**Steps:**

1. Add `ChatSession`, `TaskRun`, `Message`, and `Artifact` models.
2. Expand `Event` with `streamScope`, `sessionId`, `runId`, `messageId`, `artifactId`, `domain`, `causationId`, and nullable `taskId`.
3. Backfill existing `tasks` rows into one session + one run each.
4. Backfill existing events to run streams and attach session ids.
5. Keep existing `tasks` table until service migration is complete; do not drop in this pass.

### Task 3: Generalize EventStore from task streams to scoped streams

**Objective:** Make event append/list work for either session or run streams without violating transactional sequencing.

**Files:**

- Modify: `src/services/events/event-store.ts`
- Test: `tests/event-store.test.ts`

**Steps:**

1. Replace `AppendEventInput.taskId`-required shape with canonical `AppendScopedEventInput` requiring `streamScope`, `streamId`, `sessionId`, and optional `runId/taskId`.
2. Implement `appendSessionEventInTransaction(tx, input)` locking `chat_sessions.next_event_sequence`.
3. Implement `appendRunEventInTransaction(tx, input)` locking `task_runs.next_event_sequence`.
4. Keep `appendTaskEvent*` wrappers that resolve legacy taskId → runId/sessionId and emit run-scoped events.
5. Add tests for independent session/run sequences, uniqueness, and missing owner errors.

### Task 4: Update SseHub to key by stream scope/id

**Objective:** Support session and run subscriptions with replay buffering and idempotent ordering.

**Files:**

- Modify: `src/services/events/sse-hub.ts`
- Modify: `src/routes/sse.ts`
- Test: `tests/task-routes.test.ts` or new `tests/sse-hub.test.ts`

**Steps:**

1. Change client map key from taskId to `${scope}:${id}`.
2. Change `subscribe`, `finishReplay`, `unsubscribe`, and `publish` signatures to use stream scope/id.
3. Update SSE `id` writer to use numeric sequence for single streams and leave room for composite cursors later.
4. Verify replay/live race protection still buffers events published during DB replay.

### Task 5: Add session/run routes and compatibility adapters

**Objective:** Expose canonical SSE and snapshot endpoints while preserving `/tasks/:taskId/*` during migration.

**Files:**

- Create: `src/routes/session.routes.ts` or extend route registration in `src/index.ts`
- Modify: `src/routes/task.routes.ts`
- Modify: `src/services/task/task.ts` or introduce `src/services/session/session-service.ts` and `src/services/run/run-service.ts`
- Test: `tests/task-routes.test.ts`, add `tests/session-routes.test.ts`

**Steps:**

1. Add `POST /sessions` to create a session with optional initial user message.
2. Add `GET /sessions/:sessionId` snapshot with messages, latest run summary, events URL.
3. Add `POST /sessions/:sessionId/runs` to start a run attempt.
4. Add `GET /sessions/:sessionId/events` for session stream replay/live.
5. Add `GET /runs/:runId/events` or nested equivalent for detailed run stream.
6. Keep `POST /tasks`, `GET /tasks/:taskId`, `GET /tasks/:taskId/events`, `GET /tasks/:taskId/result`, and `DELETE /tasks/:taskId` as adapters to the new run service.

### Task 6: Move lifecycle writes to run/session transactions

**Objective:** Preserve the atomic lifecycle+event invariant across new domain owners.

**Files:**

- Modify: `src/services/task/task.ts`
- Modify: `src/services/sandbox/sandbox.ts`
- Modify: `src/services/sandbox/command-execution.ts`
- Modify: `src/services/agent/tool-event-relay.ts`
- Test: `tests/task-service.test.ts`, `tests/task-cancellation.test.ts`, `tests/sandbox-service.test.ts`, `tests/command-execution-service.test.ts`, `tests/agent-tool-relay.test.ts`

**Steps:**

1. Replace task status updates with run status updates in create/start/complete/fail/cancel flows.
2. Where a run lifecycle change should be visible in chat, append a session-level milestone in the same transaction.
3. Update sandbox and command services to accept `{ sessionId, runId, legacyTaskId? }` context.
4. Ensure every post-transaction returned event is published only after the transaction resolves.
5. Add tests that intentionally throw inside transactions and assert no SSE publish occurred.

### Task 7: Introduce artifacts for raw logs/tool outputs

**Objective:** Prevent raw command logs/tool outputs from becoming prompt context and keep event payloads bounded.

**Files:**

- Create: `src/services/artifacts/artifact-store.ts`
- Modify: `src/services/sandbox/command-execution.ts`
- Modify: `src/services/agent/tool-event-relay.ts`
- Modify: `src/services/agent/agent-runner.ts` prompt construction if it currently consumes event history later
- Test: `tests/command-execution-service.test.ts`, `tests/agent-tool-relay.test.ts`, add `tests/artifact-store.test.ts`

**Steps:**

1. Add artifact creation in the same transaction as pointer events when outputs are finalized; for streaming chunks, batch or append artifact segments outside prompt context with clear ordering metadata.
2. Replace `command_output` payload chunks with artifact pointer events or bounded previews.
3. Replace `agent_tool_result.result_snippet` as the only persisted detail with `result_artifact_id` plus small preview.
4. Add redaction/truncation metadata.
5. Add tests that large outputs are not stored in event payloads and are retrievable via artifact API/service.

### Task 8: Update frontend rendering model

**Objective:** Render chat and timeline from session events/messages and detailed harness events from run streams.

**Files:**

- Modify: `frontend/src/api/types.ts`
- Modify: `frontend/src/api/useTaskEvents.ts` or create `frontend/src/api/useEventStream.ts`
- Modify: `frontend/src/pages/TaskDetailPage.tsx`
- Create/modify: chat session page components as needed, including `frontend/src/components/EventTimeline.tsx`

**Steps:**

1. Rename generic hook to `useEventStream(eventsUrl)` and dedupe by `(stream.scope, stream.id, stream.sequence)`.
2. Render session messages as chat bubbles using `Message` rows/snapshots or `message_created` events.
3. Render session run milestone cards in the chat timeline.
4. Render detailed run harness visibility as nested expandable timeline under each run.
5. Use artifact ids to fetch/display full command/tool output on demand; never display giant event payloads directly.

### Task 9: Migration and deprecation path

**Objective:** Transition from task-only events safely.

**Files:**

- Modify: docs/planning or API docs if present
- Modify: tests expecting `/tasks/...` URLs
- Add migration tests if migration harness exists

**Steps:**

1. Phase A: dual-read/legacy-write wrappers. Existing behavior unchanged externally, DB has new nullable columns backfilled.
2. Phase B: new writes produce `sessionId/runId` and compatibility `taskId`; routes expose both `/sessions` and `/tasks`.
3. Phase C: frontend moves to sessions/runs; task routes emit deprecation headers.
4. Phase D: make `taskId` nullable/legacy-only; remove hard invariant that every event has taskId.
5. Phase E: drop old `Task` table or keep read-only view after consumers migrate.

---

## Test strategy

### Unit tests

- `EventStore`:
  - appends session and run events with independent sequences.
  - locks owner row and increments sequence atomically.
  - rejects appending to missing session/run.
  - legacy `appendTaskEvent` resolves existing task/run and fills `sessionId/runId/taskId`.

- `SseHub`:
  - keys clients by scope/id.
  - buffers events while replaying.
  - dedupes/sends only events with sequence greater than cursor.
  - does not leak run-stream events to session-stream subscribers unless explicitly projected.

- Services:
  - create session + message emits `session_created`/`message_created` only after commit.
  - create run emits run row + run event + session milestone atomically.
  - completion/failure/cancellation update run status and emit event in one transaction.
  - rollback means no publish.

- Artifact handling:
  - large command/tool outputs create artifacts and only bounded previews in events.
  - artifact ids are present on relevant events.
  - raw artifact content is not included in prompt-context assembly by default.

### Route/integration tests

- `GET /sessions/:sessionId/events?after=N` replays session events and then receives live post-commit events.
- `GET /runs/:runId/events?after=N` replays detailed run events.
- Legacy `/tasks/:taskId/events` still works during migration.
- `Last-Event-ID` cursor works for session and run streams.
- Frontend hook handles reconnect and dedupes composite stream keys.

### End-to-end/acceptance tests

- Start a session with a user message, create a run, observe session timeline milestones and run detail events.
- Retry under same session creates a second run without mutating first run history.
- Complete/cancel/fail flows produce both correct snapshot state and ordered events.
- Raw command/tool output is viewable as artifact, but session chat context contains only messages and curated summary.

### Verification commands

Run after implementation:

```bash
npm run prisma:generate
npm run typecheck
npm run lint
npm test
npm run build
```

If frontend has a separate package, also run its typecheck/build scripts from `frontend/`.

---

## Risks, tradeoffs, and open questions

### Risks

- **Dual stream complexity:** Merging session and run streams can confuse ordering. Prefer nested UI rendering rather than global merge.
- **Deadlocks:** Multi-stream transactions must lock `ChatSession` before `TaskRun` consistently.
- **Compatibility churn:** Tests and clients assume `taskId` and `/tasks/:taskId/events`; keep adapters until frontend/API migration is complete.
- **Large event payload history:** Existing `command_output` rows may contain chunks. Backfill can leave them as legacy run events; new code should stop creating large payloads.
- **Prompt contamination:** Any future prompt builder must be audited to ensure it reads messages/curated artifacts, not all events.
- **SSE cursor shape:** Numeric cursor is simple for single streams. Aggregate streams need composite cursors; avoid aggregate live merge unless needed.

### Tradeoffs

- **Session stream with milestones + run stream details** is more work than one stream but gives a clean chat UX and prevents raw telemetry from polluting conversation context.
- **Keeping task compatibility** slows cleanup but reduces migration blast radius.
- **Artifacts table/blob store** adds a retrieval path but keeps events small, replay fast, and safer to render.

### Open questions

1. Should `TaskRun.id` equal legacy `Task.id` permanently, or should a separate `run_...` id be introduced immediately?
2. Are assistant token deltas required as persisted events, or can assistant messages be persisted only when complete?
3. Where should artifact bytes live: PostgreSQL text/json for MVP, filesystem path under workspace, or object storage-compatible URI?
4. Should session status derive from latest run, or have explicit session lifecycle independent of run status?
5. Should a run be cancellable through `DELETE /runs/:runId` while `DELETE /tasks/:taskId` remains an adapter?
6. Do we need a global audit log stream, or are per-session/run streams sufficient?

---

## Files likely to change

- `prisma/schema.prisma`
- `src/types/event.types.ts`
- `src/types/task.types.ts`
- `src/services/events/event-store.ts`
- `src/services/events/sse-hub.ts`
- `src/routes/sse.ts`
- `src/routes/task.routes.ts`
- `src/index.ts`
- New `src/routes/session.routes.ts`
- New `src/services/session/session-service.ts`
- New `src/services/run/run-service.ts` or refactor of `src/services/task/task.ts`
- New `src/services/artifacts/artifact-store.ts`
- `src/services/sandbox/sandbox.ts`
- `src/services/sandbox/command-execution.ts`
- `src/services/agent/tool-event-relay.ts`
- `src/services/agent/agent-runner.ts`
- `frontend/src/api/types.ts`
- `frontend/src/api/useTaskEvents.ts` or new `frontend/src/api/useEventStream.ts`
- `frontend/src/components/EventTimeline.tsx`
- `frontend/src/pages/TaskDetailPage.tsx`
- New session/chat frontend page components
- Tests under `tests/*event*`, `tests/task-*`, `tests/sandbox-*`, `tests/agent-*`, plus new session/run/artifact tests

---

## Acceptance criteria

- New events can be appended to either session or run streams with monotonic per-stream sequence numbers.
- Lifecycle state transitions and their events are committed atomically.
- SSE publishes only after commit and supports replay from `after`/`Last-Event-ID`.
- Frontend can render a chat/session timeline and detailed run harness timeline without relying on task-only event semantics.
- Raw command logs/tool outputs are stored/referenced as artifacts, not copied into message prompt context.
- Existing `/tasks` APIs continue to work during migration or have an explicit tested deprecation behavior.
