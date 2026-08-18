> Created: 2026-08-13
> Status: Valid / active planning document
> Valid for: Task Service Atomic MVP only
> Invalid when: task-service implementation is completed and the project moves to the next component, or this plan is superseded by a newer planning document
> Scope reminder: Express + TypeScript + Postgres + Prisma + in-process SandboxService orchestration + first-class Event Store; no Agent Service implementation, GitHub integration, auth, frontend, queues, or PR creation in this phase; sandbox HTTP routes are removed from the product surface

# Task Service Atomic MVP Implementation Plan

## 1. Product Boundary And Non-Goals

### Goal

Build the Task Service as the first product-facing boundary of the cloud coding agent system.

The MVP proves that the platform can:

- accept a repo-scoped coding task through task APIs
- hide sandbox IDs, container handles, arbitrary command execution, and sandbox internals from callers
- create and link exactly one sandbox per task
- persist task state, task result metadata, and ordered task-scoped events in Postgres
- stream one replayable task event stream over SSE
- drive the sandbox lifecycle in-process through `SandboxService`, not HTTP
- leave a narrow seam where the future Agent Service/agent runner plugs into the `running` phase
- complete the full result path with a placeholder runner: provision sandbox, run no agent work, capture diff, store terminal result, clean up/stop the sandbox
- cancel an in-flight task asynchronously and land it in a terminal state

The Task Service is the product boundary. Frontend and future external callers talk only to task APIs. Sandbox routes should be removed from the HTTP product surface in this phase; the sandbox remains an internal in-process execution service consumed by Task Service.

### Hard Scope

This phase includes only:

- Prisma schema changes for `Task` and a first-class append-only Event Store
- TypeScript task service code
- Express task routes
- removal of sandbox HTTP route registration from the public API surface
- task request/response/event Zod schemas
- in-process orchestration of the existing `SandboxService`
- durable task lifecycle events persisted through the existing Event Store pattern
- task SSE replay and live fanout over persisted events
- placeholder task runner seam
- diff/result capture
- async cancellation path
- DB-independent Vitest unit tests
- curl-based acceptance harness description

### Non-Goals

Do not implement or design as active MVP work:

- Agent Service or agent loop
- LLM provider calls, model selection, prompts, tool protocol, or memory
- GitHub auth, repository clone by URL, branch push, or PR creation
- users, organizations, sessions, auth, API keys, or tenant policy
- frontend
- queue workers or distributed orchestration
- retries of a failed task; retry is explicitly `create a new task`
- multiple sandboxes per task
- parallel task runs, parallel commands, terminal multiplexing, or subagents
- task scheduling or background recovery workers
- new sandbox runtime implementation
- arbitrary command execution exposed through task APIs

### Sandbox HTTP Route Removal

Remove sandbox HTTP routes from the app's registered product surface in this phase:

- `POST /sandboxes`
- `GET /sandboxes/:id`
- `GET /sandboxes/:id/events`
- `POST /sandboxes/:id/commands`
- `GET /sandboxes/:id/commands/:commandId`
- `GET /sandboxes/:id/diff`
- `DELETE /sandboxes/:id`

The underlying `SandboxService`, `CommandExecutionService`, `SandboxRuntime`, and sandbox event producers remain. They become internal collaborators behind Task Service. Debugging should happen through task events/results or direct service tests until an explicit internal admin/debug surface is deliberately designed.

## 2. Architecture Diagram

```text
product caller / curl acceptance harness
        |
        v
Express API process
        |
        +-- Task routes
        |       POST   /tasks
        |       GET    /tasks/:id
        |       GET    /tasks/:id/events
        |       GET    /tasks/:id/result
        |       DELETE /tasks/:id
        |
        +-- TaskService
        |       owns task state machine
        |       creates task + sandbox linkage
        |       orchestrates provisioning/running/result/cleanup
        |       appends task lifecycle events transactionally
        |       publishes committed events only after commit
        |
        +-- PlaceholderTaskRunner
        |       minimal runner seam called directly by TaskService
        |       MVP implementation does no agent work
        |       future Agent Service replaces this collaborator
        |
        +-- EventStore
        |       first-class append-only event service
        |       owns the events table and stream sequence allocation
        |       accepts events from task/sandbox/future agent/github producers
        |
        +-- SseHub
        |       existing in-memory fanout pattern
        |       task channel support for live task events
        |       replay remains DB-backed
        |
        +-- SandboxService (in-process collaborator)
                existing sandbox lifecycle and runtime orchestration
                not called over HTTP by TaskService

Postgres + Prisma
        |
        +-- tasks
        +-- sandboxes
        +-- commands
        +-- events

Docker daemon
        |
        +-- one container per task sandbox
                /workspace/repo
```

## 3. Components And Responsibilities

### Task Routes

Responsibilities:

- parse and validate request bodies with strict Zod schemas
- expose only task-level fields and URLs
- call `TaskService` methods
- set SSE headers for task event streams
- parse `after` query parameter and `Last-Event-ID` cursor
- pass errors to `next(error)` without formatting responses directly
- never import Prisma, `SandboxRuntime`, or Express types into services
- never expose sandbox IDs, container names, command IDs, or arbitrary command execution to product callers

Routes:

```text
POST   /tasks
GET    /tasks/:taskId
GET    /tasks/:taskId/events
GET    /tasks/:taskId/result
DELETE /tasks/:taskId
```

### TaskService

Responsibilities:

- create task IDs with `task_` prefix
- own the task transitions map and admission rules
- create task row and sandbox row in one database transaction, with no orphan sandbox window
- call `SandboxService` in-process for provisioning, diff, and stop behavior
- keep sandbox implementation details out of task responses
- append lifecycle events in the same DB transaction as task mutations
- publish events only after transaction commit
- start the asynchronous run flow in a private service method after `POST /tasks` returns `202`
- move tasks through `created -> provisioning -> running -> terminal`
- classify and persist failure paths as terminal task states
- capture terminal result payload: diff, `agentSummary = null`, exit reason, timestamps
- coordinate cancellation and best-effort sandbox cleanup

### SandboxService Collaboration

The Task Service consumes the existing `SandboxService` as a constructor-injected collaborator in the same Node process.

The plan requires adding an internal service method or refactoring the current create path so the Task Service can create/link the sandbox in the same DB transaction as the task row. The method should be internal to services, not exposed as a new HTTP route.

Preferred shape:

```ts
createForTaskInTransaction(
  tx: Prisma.TransactionClient,
  input,
  options: { taskId: string },
): Promise<{
  sandboxId: string;
  containerName: string;
  workspacePath: string;
}>;
```

Implementation detail to decide during coding:

- remove `SandboxService.create()` as an HTTP route path; keep only service methods needed by Task Service and tests
- extract a shared private/core creation helper that can create the sandbox with `taskId`
- ensure `TaskService.create()` owns the transaction that creates both `Task` and `Sandbox`
- let sandbox provisioning remain asynchronous after commit, as today

This is an internal refactor. Existing sandbox service unit tests should continue passing, but sandbox HTTP route tests should be removed or rewritten against task routes.

### Placeholder Runner Seam

Do not add a `TaskRunCoordinator` layer in MVP. `TaskService` already owns orchestration and can run a private `runTask()` method after create commit. A separate coordinator would be another middle object without a distinct responsibility.

The only seam needed now is a tiny runner collaborator called by `TaskService` during the `running` step:

```ts
type TaskRunContext = {
  taskId: string;
  sandboxId: string;
  instructions: string;
  signal: AbortSignal;
};

type TaskRunResult = {
  summary: string | null;
};
```

MVP behavior inside `TaskService.runTask()`:

- waits until the linked sandbox is ready
- marks task `running`
- calls the injected placeholder runner
- placeholder runner does no sandbox commands and returns `{ summary: null }`
- captures diff through `SandboxService.diff(sandboxId)`
- stores result and marks task `completed`
- stops/removes the sandbox after result capture

Future Agent Service replaces the placeholder runner collaborator. Do not add tool protocols, LLM settings, queues, retries, or agent-specific tables now.

### EventStore

Responsibilities:

- become a first-class service/entity, not a child of Sandbox or Task
- own a general `events` table used by task, sandbox, and future agent/github services
- keep the append-in-transaction pattern as source of truth
- allocate strictly increasing sequence numbers per stream
- persist task lifecycle events plus sandbox/command/future service events in one task stream
- record the producer service name and producer service entity ID for every event
- list events after a cursor for replay
- convert DB rows to public event objects

Decision: replace the sandbox-specific event table concept with a first-class `events` table. Details are in section 4.

### SseHub

Responsibilities:

- keep in-memory live fanout only
- add task-channel subscription/publish support or generalize channels without disrupting sandbox subscribers
- replay persisted events before live delivery, using the same race-free buffered pattern already present
- send SSE `id` equal to event sequence
- send SSE `event` equal to event type
- send SSE `data` as compact JSON event object
- send keepalive comments
- close disconnected clients cleanly

SSE is never the source of truth.

### Types And Validation

Responsibilities:

- add task request/response schemas under `src/types`, either in a new `task.types.ts` or a shared event types module if that keeps boundaries cleaner
- use service-name ID prefixes consistently for all service-owned public IDs
- `.strict()` all request bodies
- keep task public types explicit and narrow
- extend the existing `EventType` union with task lifecycle event names
- avoid `any` and loose object shapes at module boundaries

### Config

No direct `process.env` reads outside `config.ts`.

MVP should avoid new config unless required. If a task run timeout is needed for cancellation/timed-out state tests, add it to `config.ts` with a default, such as:

```text
TASK_RUN_TIMEOUT_MS=600000
```

Do not add GitHub, provider, queue, or frontend config.

## 4. Data Model

### Event Store Decision

Decision: promote Event Store to a first-class service/entity with a general `events` table. Do not model events as a child of Sandbox or Task, and do not keep the long-term table name `sandbox_events`.

Reasoning:

- events will be produced by Task Service, Sandbox Service, future Agent Service, future GitHub Service, and other platform services
- examples include `task_created`, `sandbox_ready`, `agent_message`, `github_clone_started`, `github_auth_failed`, and `pr_created`
- callers need one ordered stream for a product task, but producers are not all children of the sandbox
- Event Store should own event identity, sequence allocation, append/replay rules, and public event mapping
- this avoids turning Sandbox or Task into the parent table for unrelated future services
- it keeps one source of truth for "what happened" without duplicating per-service event tables

Required schema direction:

- create/rename to a general `events` table
- event `id` is non-null and service-prefixed, e.g. `evt_<random>`
- every event has a non-null `streamId`, usually the task ID for product task streams
- every event has a non-null `sequence` scoped to `streamId`
- every event records the producer service and producer entity ID
- events may optionally include related IDs such as `taskId`, `sandboxId`, `commandId`, `agentRunId`, or future GitHub operation IDs
- task APIs read by `streamId = taskId`
- future services append to the same task stream with their own producer metadata

### ID Prefix Convention

Use service-name/entity prefixes for all service-owned public IDs. This makes logs, events, payloads, and debugging self-describing without extra joins.

MVP prefixes:

```text
task_<random>     Task
sbox_<random>     Sandbox
cmd_<random>      Command
evt_<random>      Event
```

Reserved future prefixes:

```text
agent_<random>    Agent or agent run
gh_<random>       GitHub operation/integration record
pr_<random>       Pull request operation/result
```

Do not use bare Prisma `cuid()` values for public/service IDs once a model is part of the event stream or public API. Generate IDs in service code with the prefix before insert.

### `events`

Prisma model direction:

```prisma
model Event {
  id                String   @id
  streamId          String   @map("stream_id")
  sequence          Int
  type              String
  producerService   String   @map("producer_service")
  producerId        String   @map("producer_id")
  taskId            String?  @map("task_id")
  sandboxId         String?  @map("sandbox_id")
  commandId         String?  @map("command_id")
  correlationId     String?  @map("correlation_id")
  payload           Json
  createdAt         DateTime @default(now()) @map("created_at")

  task              Task?    @relation(fields: [taskId], references: [id], onDelete: SetNull)
  sandbox           Sandbox? @relation(fields: [sandboxId], references: [id], onDelete: SetNull)
  command           Command? @relation(fields: [commandId], references: [id], onDelete: SetNull)

  @@unique([streamId, sequence])
  @@index([streamId, sequence])
  @@index([producerService, producerId])
  @@index([taskId, sequence])
  @@index([sandboxId, sequence])
  @@index([commandId, sequence])
  @@map("events")
}
```

`producerService` values should be a small TypeScript union for MVP:

```ts
type EventProducerService =
  "task" | "sandbox" | "command" | "runtime" | "cleanup";
```

Future values include `agent` and `github`. Prefer a TypeScript union/string column for early migration flexibility rather than a Prisma enum unless the taxonomy has stabilized.

### `tasks`

Prisma model shape:

```prisma
model Task {
  id                String     @id
  status            TaskStatus
  repoRef           String     @map("repo_ref")
  instructions      String
  image             String?
  sandboxId         String?    @unique @map("sandbox_id")
  sandbox           Sandbox?   @relation(fields: [sandboxId], references: [id], onDelete: SetNull)
  nextEventSequence Int        @default(1) @map("next_event_sequence")
  diff              String?
  agentSummary      String?    @map("agent_summary")
  exitReason        String?    @map("exit_reason")
  failureCode       String?    @map("failure_code")
  failureMessage    String?    @map("failure_message")
  createdAt         DateTime   @default(now()) @map("created_at")
  updatedAt         DateTime   @updatedAt @map("updated_at")
  provisioningAt    DateTime?  @map("provisioning_at")
  runningAt         DateTime?  @map("running_at")
  completedAt       DateTime?  @map("completed_at")
  failedAt          DateTime?  @map("failed_at")
  cancelledAt       DateTime?  @map("cancelled_at")

  events            Event[]

  @@index([status, createdAt])
  @@index([createdAt])
  @@map("tasks")
}
```

Task IDs are generated in service code with a `task_` prefix.

### `TaskStatus`

Prisma enum:

```prisma
enum TaskStatus {
  created
  provisioning
  running
  completed
  failed
  cancelled
}
```

No separate `timed_out` status in MVP. Timeouts are terminal `failed` tasks with `exitReason = "timed_out"` and a reason event. This keeps the agreed status contract intact.

### `TaskExitReason`

Use a TypeScript union and string DB field rather than a Prisma enum while the result taxonomy settles:

```ts
type TaskExitReason = "completed" | "failed" | "cancelled" | "timed_out";
```

DB field: `tasks.exit_reason`.

### `Sandbox` Additions

Add optional relation back to Task:

```prisma
model Sandbox {
  id     String @id
  taskId String? @unique @map("task_id")
  task   Task?
}
```

A sandbox is internal once task routes exist. Sandbox rows created by Task Service have `taskId`; if any tests create sandboxes directly, they may use `taskId = null`, but no public HTTP route should create them.

### `Command` ID Prefix

Commands should move from bare `cuid()` to `cmd_` IDs when touched by this work. Command IDs remain internal to task API callers but appear in events and logs, so the prefix is still useful.

### Sequence Allocation

Task product streams use `tasks.next_event_sequence`.

Append transaction for any event in a task stream:

1. Lock `tasks` row by `streamId`/`taskId` with `SELECT ... FOR UPDATE`.
2. Read `next_event_sequence`.
3. Insert into `events` with `id = evt_...`, `stream_id = taskId`, producer metadata, related IDs, and sequence.
4. Increment `tasks.next_event_sequence`.
5. Commit the state mutation and event together.
6. Publish after commit.

If a future non-task stream is needed, add a generic `event_streams` table then. Do not add it in this MVP unless taskless streams are implemented now.

Do not allocate event sequence in memory.

### Result Storage

MVP stores result fields on `tasks`:

- `diff`: text diff captured after runner completion or cancellation failure where available
- `agentSummary`: nullable; always `null` in MVP placeholder runner
- `exitReason`: `completed`, `failed`, `cancelled`, or `timed_out`
- terminal timestamps
- safe failure code/message when relevant

This is acceptable for MVP. If diffs become large later, move diff payloads to artifact/object storage and store a reference.

## 5. API Surface

### Common Rules

Task APIs expose task concepts only.

They must not expose:

- sandbox IDs
- container names or IDs
- command IDs
- raw command execution endpoints
- workspace paths unless product UI explicitly needs a sanitized display field; omit for MVP

Common error shape remains the existing `ServiceError` response shape:

```json
{
  "error": {
    "code": "task_not_found",
    "message": "Task was not found",
    "details": {}
  }
}
```

### `POST /tasks`

Creates a task asynchronously.

Request:

```json
{
  "repoRef": "./repo",
  "instructions": "Update the greeting text",
  "image": "node:22-bookworm"
}
```

MVP semantics:

- `repoRef` is a local fixture repo path today
- `repoRef` replaces `fixtureRepoPath` at the product boundary
- `image` is optional and defaults through existing sandbox config
- repo URL, base branch, and base commit are future GitHub work and not accepted now

Response `202`:

```json
{
  "taskId": "task_abc123",
  "status": "created",
  "eventsUrl": "/tasks/task_abc123/events"
}
```

Errors:

- `400 invalid_request`
- `500 create_task_failed` for unexpected initial DB failure only

Provisioning failures after `202` must be visible via task snapshot, events, and result.

### `GET /tasks/:taskId`

Returns task snapshot.

Response `200` while active:

```json
{
  "taskId": "task_abc123",
  "status": "running",
  "repoRef": "./repo",
  "instructions": "Update the greeting text",
  "eventsUrl": "/tasks/task_abc123/events",
  "resultUrl": "/tasks/task_abc123/result",
  "createdAt": "2026-08-13T10:00:00.000Z",
  "provisioningAt": "2026-08-13T10:00:01.000Z",
  "runningAt": "2026-08-13T10:00:04.000Z",
  "completedAt": null,
  "failure": null
}
```

Response `200` terminal:

```json
{
  "taskId": "task_abc123",
  "status": "completed",
  "repoRef": "./repo",
  "eventsUrl": "/tasks/task_abc123/events",
  "resultUrl": "/tasks/task_abc123/result",
  "createdAt": "2026-08-13T10:00:00.000Z",
  "completedAt": "2026-08-13T10:00:05.000Z",
  "failure": null
}
```

Errors:

- `404 task_not_found`

### `GET /tasks/:taskId/events`

SSE stream for the task-scoped event log.

Request examples:

```bash
curl -N http://localhost:3000/tasks/task_abc123/events
curl -N "http://localhost:3000/tasks/task_abc123/events?after=4"
curl -N -H "Last-Event-ID: 4" http://localhost:3000/tasks/task_abc123/events
```

SSE frame:

```text
id: 5
event: task_running
data: {"id":"evt_abc123","streamId":"task_abc123","taskId":"task_abc123","sandboxId":null,"commandId":null,"sequence":5,"type":"task_running","producerService":"task","producerId":"task_abc123","payload":{},"createdAt":"2026-08-13T10:00:04.000Z","correlationId":null}

```

Public task event objects may include `sandboxId: null` for structural compatibility during the table transition, but task API documentation should not require clients to use sandbox IDs.

Errors before stream starts:

- `400 invalid_cursor`
- `404 task_not_found`

### `GET /tasks/:taskId/result`

Returns terminal result.

Response `200` terminal completed:

```json
{
  "taskId": "task_abc123",
  "status": "completed",
  "diff": "diff --git a/file.txt b/file.txt\n...",
  "agentSummary": null,
  "exitReason": "completed",
  "createdAt": "2026-08-13T10:00:00.000Z",
  "completedAt": "2026-08-13T10:00:05.000Z"
}
```

Response `200` terminal failed:

```json
{
  "taskId": "task_abc123",
  "status": "failed",
  "diff": "",
  "agentSummary": null,
  "exitReason": "failed",
  "failure": {
    "code": "provision_failed",
    "message": "Sandbox provisioning failed"
  },
  "completedAt": "2026-08-13T10:00:05.000Z"
}
```

Errors:

- `404 task_not_found`
- `409 task_not_terminal` when status is `created`, `provisioning`, or `running`

### `DELETE /tasks/:taskId`

Requests asynchronous cancellation.

Response `202` for active tasks:

```json
{
  "taskId": "task_abc123",
  "status": "cancelling",
  "eventsUrl": "/tasks/task_abc123/events"
}
```

Because the agreed status list does not include a persisted `cancelling` status, the response status field may be a transient operation state. The persisted task status remains its current active status until cancellation cleanup completes and `cancelled` is committed.

Response `200` for already terminal cancelled:

```json
{
  "taskId": "task_abc123",
  "status": "cancelled"
}
```

Errors:

- `404 task_not_found`
- `409 task_already_terminal` for `completed` or `failed` if cancellation cannot change outcome

Cancellation progress is observed through events and `GET /tasks/:taskId`.

## 6. State Machine And Events

### Task States

Enum:

```text
created
provisioning
running
completed
failed
cancelled
```

Allowed transitions:

```text
created      -> provisioning
created      -> cancelled
created      -> failed
provisioning -> running
provisioning -> failed
provisioning -> cancelled
running      -> completed
running      -> failed
running      -> cancelled
```

Rejected transitions:

- any terminal state -> any other state
- `created -> running` without provisioning
- `provisioning -> completed` without running
- `completed -> cancelled`
- `failed -> cancelled`
- `cancelled -> failed`

A single `transitions` map in `src/services/task/task.ts` must be the only place encoding legal task transitions. Do not special-case transitions in routes or helper modules.

### Admission Rules

- Create task: always creates a new task; no retrying in place
- Get task: any existing task
- Get events: any existing task, including terminal states
- Get result: terminal states only
- Cancel: active states only; idempotent for already `cancelled`

### Task/Sandbox Lifecycle Link

Required invariant: no orphan sandbox window.

Create flow:

1. Generate `taskId` and `sandboxId` before insert.
2. Open one DB transaction.
3. Insert `tasks` row with `status = created`, repoRef, instructions, image, `sandboxId`, `nextEventSequence = 1`.
4. Insert `sandboxes` row with `taskId`, `status = creating`, fixture repo path derived from `repoRef`, container name, image, workspace path.
5. Append `task_created` to `events` with `streamId = taskId`, `producerService = "task"`, and `producerId = taskId`.
6. Append `sandbox_created` to the same stream with `producerService = "sandbox"`, `producerId = sandboxId`, `taskId`, and `sandboxId`.
7. Commit.
8. Publish committed events.
9. Return `202`.
10. Start asynchronous `TaskService.runTask()`.

This requires extending `EventStore.appendInTransaction` to append general service events to a stream, not task/sandbox child records.

### Event Types

Extend the TypeScript `EventType` union with task lifecycle events:

```text
task_created
task_provisioning_started
task_running
task_completed
task_failed
task_cancelled
task_result_ready
```

Keep existing sandbox/command event names. Do not rename existing event types.

### Event Semantics

Task lifecycle events:

- `task_created`: task row exists and linked sandbox row exists
- `task_provisioning_started`: task moved to `provisioning`; sandbox provisioning is underway
- `task_running`: sandbox is ready and runner seam has started
- `task_completed`: runner completed and task is terminal successful
- `task_failed`: task is terminal failed; payload includes safe reason
- `task_cancelled`: task is terminal cancelled after run abort and sandbox cleanup attempts
- `task_result_ready`: terminal result payload has been persisted and can be read from `/tasks/:id/result`

Ordering requirement:

- every state change event is appended in the same transaction as the corresponding task status mutation
- `task_result_ready` is appended in the same transaction as result fields and terminal timestamp
- if `task_completed` and `task_result_ready` are both emitted, append `task_completed` first and `task_result_ready` second in the same transaction
- publish only after commit

### Appending Service Events Into The Task Stream

For task-owned work, Task Service, Sandbox Service, CommandExecutionService, Runtime/Cleanup, and future Agent/GitHub services append to the same Event Store stream with `streamId = taskId`. Each event records `producerService` and `producerId`. This gives callers one stream:

```text
task_created
sandbox_created
task_provisioning_started
sandbox_provisioning_started
fixture_repo_copy_started
fixture_repo_copied
sandbox_ready
task_running
git_diff_requested
git_diff_completed
task_completed
task_result_ready
sandbox_stopping
sandbox_stopped
```

There should be no temporary duplicate bridge if avoidable. The preferred implementation is one event row in the first-class `events` table, with task stream ID plus producer metadata and related IDs where applicable.

## 7. Failure Paths

Failure paths must land tasks in explicit terminal states. No task may dangle in `provisioning` or `running` after a known failure.

### Provision Failed

Trigger examples:

- fixture repo missing
- Docker create/start/copy failed
- workspace validation failed
- sandbox entered `failed` before ready

Flow:

1. Task is `provisioning`.
2. Sandbox provisioning fails and emits `sandbox_failed` with `taskId`.
3. TaskService marks task `failed`.
4. Store:
   - `exitReason = "failed"`
   - `failureCode = "provision_failed"` or underlying safe code
   - `failureMessage`
   - `failedAt`
5. Append `task_failed` and `task_result_ready` in the same transaction.
6. Best-effort stop/remove sandbox if a container was partially created.

### Sandbox Died

Trigger examples:

- container disappears before or during runner step
- `SandboxService.diff()` reports workspace/container unavailable
- Docker operation indicates the container cannot be used

Flow:

1. Classify safe payload with `code = "sandbox_died"`.
2. Mark task `failed` with `exitReason = "failed"`.
3. Append `task_failed` and `task_result_ready` transactionally.
4. Best-effort stop/remove sandbox.

### Command Failed

MVP placeholder runner does not run commands. Future agent runner command failures should not automatically fail a task unless the runner classifies the overall task as failed.

For MVP, if an internal command is added only for acceptance proof, non-zero exit should be classified by the runner and must produce:

- `task_failed`
- `exitReason = "failed"`
- safe failure code such as `command_failed`

Do not expose the command endpoint through task APIs.

### Cancelled

Cancellation is terminal `cancelled` with:

- `exitReason = "cancelled"`
- `agentSummary = null`
- diff captured if available after abort/cleanup begins, otherwise empty string
- `task_cancelled`
- `task_result_ready`

### Timed Out

Future timeout support should land as:

- persisted task status `failed`
- `exitReason = "timed_out"`
- event `task_failed` with payload code `agent_timed_out` or `task_timed_out`

If `TASK_RUN_TIMEOUT_MS` is included in MVP, test this path with the placeholder runner only if it can be done without adding agent abstractions.

### Unexpected Error Classification

Rules:

- throw `ServiceError` for expected boundary failures
- unexpected errors become safe `task_failed` payloads
- do not store stack traces or secrets in event payloads
- log unexpected errors once at the boundary that classifies them
- use `runQuery`/`logQueryFailure` for Prisma work

## 8. Cancellation

Cancellation is asynchronous.

### Active Cancellation Flow

Request:

```text
DELETE /tasks/:taskId
```

Flow:

1. Route validates task ID and calls `TaskService.cancel(taskId)`.
2. Service loads task.
3. If task is terminal:
   - return idempotently for `cancelled`
   - reject `completed`/`failed` with `409 task_already_terminal`
4. Record cancellation intent in memory for the active `TaskService.runTask()` execution.
5. Return `202` immediately.
6. Async cancellation worker/coordinator:
   - abort the runner step through an `AbortController`
   - if a sandbox command is in-flight, call the existing stop path so command cancellation is persisted where supported
   - stop/remove the container through `SandboxService.stop(sandboxId)`
   - capture diff if workspace is still available before stop, otherwise use empty diff
   - mark task `cancelled`
   - append `task_cancelled` and `task_result_ready`
   - publish committed events

### Cancellation During `created`

If cancellation arrives before provisioning starts:

- transition `created -> cancelled`
- do not start provisioning
- if sandbox row already exists from the create transaction, call `SandboxService.stop()` best-effort; it must handle `creating`
- append `task_cancelled` and `task_result_ready`

### Cancellation During `provisioning`

If cancellation arrives during provisioning:

- record cancellation intent
- stop/remove partially provisioned container best-effort
- when provisioning promise resolves or fails, suppress further transition to `running`
- transition to `cancelled`
- append `task_cancelled` and `task_result_ready`

### Cancellation During `running`

If cancellation arrives during runner execution:

- abort runner
- kill in-flight command via sandbox stop path
- capture diff if possible
- stop sandbox
- transition `running -> cancelled`

### Process Crash Limitation

MVP cancellation intent can be in memory because there is no queue worker or recovery process in this phase. Risk is documented in section 14. Do not add a distributed cancellation system now.

## 9. Event Stream And Replay

### Endpoint

```text
GET /tasks/:taskId/events
GET /tasks/:taskId/events?after=<sequence>
Last-Event-ID: <sequence>
```

Rules:

- `after` is an exclusive task sequence cursor
- `after=0` returns all task events
- `Last-Event-ID` is used only when `after` is absent
- invalid cursor returns `400 invalid_cursor`
- missing task returns `404 task_not_found`
- SSE `id` is sequence as a string
- SSE `event` is the event type
- SSE `data` is the public task event JSON
- keepalive comment every 15 seconds

### Replay Correctness

Use the current `SseHub` race-free pattern:

1. Subscribe first and buffer live events.
2. Query persisted task events after cursor, ordered by sequence.
3. Write replayed events.
4. Finish replay and flush buffered live events with `sequence > lastSent`.

Tests must prove:

- initial stream receives `task_created`
- replay from `after=0` returns task and sandbox events in sequence order
- reconnect with `after=N` returns only events with sequence greater than `N`
- reconnect with `Last-Event-ID: N` behaves like `after=N`
- live events committed during replay are not lost
- terminal task streams remain readable after sandbox cleanup

### Public Event Shape

Task event shape:

```ts
type PublicTaskEvent = {
  id: string;
  streamId: string;
  taskId: string | null;
  sandboxId: string | null;
  commandId: string | null;
  sequence: number;
  type: EventType;
  producerService: EventProducerService;
  producerId: string;
  correlationId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};
```

Do not keep the old `actor` field as the durable producer model. If a short-term compatibility mapper is needed for existing sandbox internals, keep it internal and map to `producerService` before persisting or returning task events.

### Payload Conventions

Rules:

- JSON objects only
- stable snake_case payload keys
- bounded output payloads remain governed by sandbox command output rules
- no secrets, stack traces, tokens, or host-only sensitive paths
- task APIs should not require callers to understand sandbox IDs

Example `task_failed` payload:

```json
{
  "code": "provision_failed",
  "message": "Sandbox provisioning failed",
  "operation": "provision_task",
  "retryable": false
}
```

Example `task_result_ready` payload:

```json
{
  "exit_reason": "completed",
  "diff_bytes": 128,
  "agent_summary_present": false
}
```

## 10. Tests

### Unit Tests

Use DB-independent Vitest tests mirroring the existing `tests/` structure. Use plain object doubles for Prisma, EventStore, SandboxService, runner, and publisher as existing service tests do.

Suggested files:

```text
tests/task-service.test.ts
tests/task-routes.test.ts
tests/task-events.test.ts
tests/task-cancellation.test.ts
tests/task-runner.test.ts
```

Cover:

- task transition validator accepts legal transitions
- task transition validator rejects illegal transitions
- create task validates request body strictly
- create response hides sandbox ID
- create flow writes task row and sandbox row in one transaction through collaborator/core helper
- create emits `task_created` and linked `sandbox_created` after commit
- provisioning success transitions `created -> provisioning -> running -> completed`
- placeholder runner returns summary null
- result capture stores diff, summary null, exit reason completed, terminal timestamp
- result endpoint rejects non-terminal tasks with `409 task_not_terminal`
- provision failure transitions to `failed` with `task_failed` and `task_result_ready`
- sandbox died failure transitions to `failed`
- cancellation from `created` lands `cancelled`
- cancellation from `provisioning` lands `cancelled`
- cancellation from `running` aborts runner and stops sandbox
- terminal cancellation is idempotent for already cancelled
- cancellation rejects completed/failed where outcome cannot change
- task SSE cursor parsing: `after`, `Last-Event-ID`, invalid cursor
- task event replay ordering
- no route imports Prisma/runtime directly

### Event Store Tests

Extend existing EventStore tests or add task-specific tests for:

- task-scoped sequence allocation locks task row
- all task-stream events allocate from `tasks.next_event_sequence`
- sandbox/command events include producer metadata and related IDs while using `streamId = taskId`
- append transaction rolls back event when task mutation fails
- list task events after cursor returns strict ascending task sequence

These should be DB-independent where possible. If row-lock behavior requires database integration later, document it separately and keep default `npm test` DB-independent.

### Route Validation Tests

Cover:

- `POST /tasks` requires non-empty `repoRef` and `instructions`
- extra request fields are rejected
- optional image is accepted
- task responses omit `sandboxId`, `containerName`, and `workspacePath`
- `DELETE /tasks/:id` returns `202` for active tasks
- service errors flow to Express error handler

### Existing Sandbox Tests

Existing sandbox service unit tests must remain passing. Remove or rewrite sandbox route tests because sandbox HTTP routes are no longer part of the product surface.

## 11. Acceptance Harness

Script path to implement later:

```text
scripts/acceptance/task-service-atomic-mvp.sh
```

The plan requires designing this script. Implementation happens in the implementation phase, not now.

### Prerequisites

The script assumes:

- API server already running at `BASE_URL`, default `http://localhost:3000`
- Postgres and Docker available to the service
- `jq`, `curl`, `git`, `timeout`, and POSIX shell tools installed
- local fixture repo can be created at `./repo`

### Harness Structure

Pseudo-shell outline:

```bash
#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
SSE_1="$(mktemp)"
SSE_2="$(mktemp)"
SSE_3="$(mktemp)"

assert_contains() { ...; }
assert_not_contains() { ...; }
wait_for_task_status() { ...; }
extract_last_sse_id() { ...; }

prepare_fixture_repo() {
  rm -rf repo
  mkdir repo
  git -C repo init
  git -C repo config user.email acceptance@example.test
  git -C repo config user.name "Acceptance Test"
  printf 'hello\n' > repo/hello.txt
  git -C repo add hello.txt
  git -C repo commit -m 'fixture'
}
```

### Create Task Assertions

```bash
CREATE_RESPONSE="$(
  curl -sS -i -X POST "$BASE_URL/tasks" \
    -H 'content-type: application/json' \
    -d '{"repoRef":"./repo","instructions":"No-op placeholder task"}'
)"

printf '%s' "$CREATE_RESPONSE" | grep 'HTTP/.* 202'
TASK_ID="$(printf '%s' "$CREATE_RESPONSE" | sed -n '/^{/,$p' | jq -r '.taskId')"
STATUS="$(printf '%s' "$CREATE_RESPONSE" | sed -n '/^{/,$p' | jq -r '.status')"
test "$STATUS" = "created"
case "$TASK_ID" in task_*) ;; *) exit 1 ;; esac

printf '%s' "$CREATE_RESPONSE" | sed -n '/^{/,$p' | jq -e '.eventsUrl == "/tasks/'"$TASK_ID"'/events"'
printf '%s' "$CREATE_RESPONSE" | sed -n '/^{/,$p' | jq -e 'has("sandboxId") | not'
```

### Readiness And Completion Assertions

Because the MVP placeholder runner completes quickly, wait for terminal `completed`:

```bash
wait_for_task_status "$TASK_ID" "completed" 30

SNAPSHOT="$(curl -sS "$BASE_URL/tasks/$TASK_ID")"
printf '%s' "$SNAPSHOT" | jq -e '.status == "completed"'
printf '%s' "$SNAPSHOT" | jq -e 'has("sandboxId") | not'
printf '%s' "$SNAPSHOT" | jq -e 'has("containerName") | not'
```

### Event Replay Assertions

```bash
timeout 5 curl -sS -N "$BASE_URL/tasks/$TASK_ID/events?after=0" > "$SSE_1" || true

assert_contains "$SSE_1" "event: task_created"
assert_contains "$SSE_1" "event: sandbox_created"
assert_contains "$SSE_1" "event: task_provisioning_started"
assert_contains "$SSE_1" "event: sandbox_ready"
assert_contains "$SSE_1" "event: task_running"
assert_contains "$SSE_1" "event: task_completed"
assert_contains "$SSE_1" "event: task_result_ready"
assert_not_contains "$SSE_1" "containerName"

LAST_ID="$(extract_last_sse_id "$SSE_1")"
test "$LAST_ID" -ge 1
```

### Reconnect With `after`

```bash
timeout 5 curl -sS -N "$BASE_URL/tasks/$TASK_ID/events?after=2" > "$SSE_2" || true
FIRST_REPLAYED_ID="$(grep '^id:' "$SSE_2" | head -1 | awk '{print $2}')"
test "$FIRST_REPLAYED_ID" -gt 2
assert_contains "$SSE_2" "event: task_result_ready"
```

### Reconnect With `Last-Event-ID`

```bash
timeout 5 curl -sS -N \
  -H "Last-Event-ID: 2" \
  "$BASE_URL/tasks/$TASK_ID/events" > "$SSE_3" || true

assert_contains "$SSE_3" "event: task_result_ready"
```

### Result Assertions

```bash
RESULT="$(curl -sS "$BASE_URL/tasks/$TASK_ID/result")"
printf '%s' "$RESULT" | jq -e '.status == "completed"'
printf '%s' "$RESULT" | jq -e '.exitReason == "completed"'
printf '%s' "$RESULT" | jq -e '.agentSummary == null'
printf '%s' "$RESULT" | jq -e '.diff | type == "string"'
printf '%s' "$RESULT" | jq -e 'has("sandboxId") | not'
```

### Cancellation Assertion

For cancellation acceptance, create a second task and cancel immediately. Because the placeholder runner may complete quickly, the harness should allow either a clean cancellation before completion or a documented `409 task_already_terminal` if the task already completed. A stronger later test can use a controllable fake runner in integration tests.

```bash
CANCEL_CREATE="$(curl -sS -X POST "$BASE_URL/tasks" \
  -H 'content-type: application/json' \
  -d '{"repoRef":"./repo","instructions":"Cancel me"}')"
CANCEL_TASK_ID="$(printf '%s' "$CANCEL_CREATE" | jq -r '.taskId')"

CANCEL_RESPONSE="$(curl -sS -i -X DELETE "$BASE_URL/tasks/$CANCEL_TASK_ID")"
printf '%s' "$CANCEL_RESPONSE" | grep -E 'HTTP/.* (202|200|409)'
```

Unit tests, not curl, are the primary proof of cancellation phase-specific behavior in MVP.

### Failure Path Assertion

```bash
mv repo repo.saved
FAIL_RESPONSE="$(curl -sS -i -X POST "$BASE_URL/tasks" \
  -H 'content-type: application/json' \
  -d '{"repoRef":"./repo","instructions":"Should fail provisioning"}')"
mv repo.saved repo

printf '%s' "$FAIL_RESPONSE" | grep 'HTTP/.* 202'
FAILED_TASK_ID="$(printf '%s' "$FAIL_RESPONSE" | sed -n '/^{/,$p' | jq -r '.taskId')"
wait_for_task_status "$FAILED_TASK_ID" "failed" 30

FAILED_EVENTS="$(mktemp)"
timeout 5 curl -sS -N "$BASE_URL/tasks/$FAILED_TASK_ID/events?after=0" > "$FAILED_EVENTS" || true
assert_contains "$FAILED_EVENTS" "event: task_failed"
assert_contains "$FAILED_EVENTS" "event: task_result_ready"

FAILED_RESULT="$(curl -sS "$BASE_URL/tasks/$FAILED_TASK_ID/result")"
printf '%s' "$FAILED_RESULT" | jq -e '.status == "failed"'
printf '%s' "$FAILED_RESULT" | jq -e '.exitReason == "failed"'
```

### Acceptance Exit Criteria

The script exits zero only if every assertion passes. It prints:

```text
PASS task service atomic MVP acceptance
```

on success.

## 12. File Layout

Target file layout:

```text
src/
  routes/
    task.routes.ts
    sandbox.routes.ts          remove from app registration; delete or leave unregistered only if tests still need temporary import
  services/
    task/
      task.ts                  TaskService, transitions, private runTask(), singleton export
      task-runner.ts           minimal placeholder runner seam only
    events/
      event-store.ts           first-class append/list methods for events table
      sse-hub.ts               generalized stream channel support
    sandbox/
      sandbox.ts               internal create/link/provision/stop support, no public route dependency
      command-execution.ts     internal command execution, cmd_ IDs
      runtime.ts               only Docker-spawning module
  types/
    task.types.ts              zod schemas and public task response types
    event.types.ts             EventType, producer service, public event types
    sandbox.types.ts           sandbox-internal request/runtime types as needed
  shared/
    errors.ts                  existing
    query-logging.ts           existing
prisma/
  schema.prisma                Task model, Event model, prefixed ID updates
scripts/
  acceptance/
    task-service-atomic-mvp.sh later implementation

tests/
  task-service.test.ts
  task-routes.test.ts
  task-events.test.ts
  task-cancellation.test.ts
  task-runner.test.ts
```

Server wiring:

- register `taskRouter`
- do not register `sandboxRouter`
- keep `/health` unchanged

Module boundary rules:

- routes import schemas and `taskService`
- services do not import Express types
- `TaskService` constructor receives Prisma, EventStore, SandboxService/core collaborator, config, runner, and publish callback
- avoid importing singleton collaborators inside class bodies

## 13. Implementation Order

Each phase ends in a verifiable state and should be small enough to review independently.

### Phase 1: Task Types And Route Skeleton

Deliverables:

- `src/types/task.types.ts`
- strict `createTaskSchema`
- public response/result/event types
- `src/routes/task.routes.ts` skeleton wired into app
- route handlers call a fake/incomplete service only in tests, not production behavior
- sandbox route registration removed from the app public surface

Verification:

```bash
npm run typecheck
npm test -- task-routes
curl -fsS http://localhost:3000/health
```

### Phase 2: Prisma Schema Plan Applied By Migration

Deliverables:

- `TaskStatus` enum
- `Task` model
- `taskId` relation on `Sandbox`
- first-class `Event` model/table with non-null `evt_` IDs, `streamId`, sequence, producer metadata, and related IDs
- partial/index/check changes generated through Prisma migration workflow
- `npm run prisma:generate`

Constraints:

- do not hand-edit files under `prisma/migrations/` outside the migration workflow
- preserve existing sandbox service/runtime models where needed internally; do not preserve sandbox HTTP route behavior

Verification:

```bash
npm run prisma:migrate:dev
npm run prisma:generate
npm run typecheck
```

### Phase 3: Task-Aware EventStore And SseHub

Deliverables:

- append task event in transaction
- append task-owned sandbox event in transaction
- list task events after cursor
- task stream sequence allocation from `tasks.next_event_sequence`
- sandbox/command producers append into task streams with producer metadata
- SseHub supports task channels or generalized channels

Verification:

```bash
npm test -- task-events
npm test -- event-store
npm run typecheck
```

### Phase 4: Transactional Task + Sandbox Creation

Deliverables:

- `TaskService.create()` generates `task_` ID
- task row and sandbox row created in one transaction
- `task_created` and linked `sandbox_created` appended before commit
- committed events published after commit
- response returns only task fields
- `POST /sandboxes` is no longer registered; task creation is the only HTTP creation path

Verification:

```bash
npm test -- task-service
npm test -- sandbox
npm run typecheck
curl -i -X POST http://localhost:3000/tasks \
  -H 'content-type: application/json' \
  -d '{"repoRef":"./repo","instructions":"No-op"}'
```

### Phase 5: Provisioning Orchestration

Deliverables:

- private `TaskService.runTask()` starts after create commit
- task transitions `created -> provisioning`
- sandbox provisioning is invoked in-process, not over HTTP
- task waits/observes sandbox ready or failed state
- provisioning failure lands task `failed`
- events appended transactionally and published after commit

Verification:

```bash
npm test -- task-service provisioning
npm run typecheck
curl -N "http://localhost:3000/tasks/<taskId>/events?after=0"
```

### Phase 6: Placeholder Runner And Result Capture

Deliverables:

- task transitions `provisioning -> running`
- placeholder runner returns `summary = null`
- diff captured through `SandboxService.diff()`
- task stores diff, summary null, `exitReason = completed`
- task transitions to `completed`
- `task_completed` and `task_result_ready` events
- `GET /tasks/:id/result`
- sandbox stopped after result capture

Verification:

```bash
npm test -- task-runner
npm test -- task-service result
npm run typecheck
curl -sS http://localhost:3000/tasks/<taskId>/result | jq
```

### Phase 7: Task SSE Replay And Live Delivery

Deliverables:

- `GET /tasks/:id/events`
- replay with `after`
- replay with `Last-Event-ID`
- keepalive comments
- replay/live race protection
- tests proving ordered task stream includes task and sandbox events

Verification:

```bash
npm test -- task-events
curl -N "http://localhost:3000/tasks/<taskId>/events?after=0"
curl -N -H "Last-Event-ID: 2" "http://localhost:3000/tasks/<taskId>/events"
```

### Phase 8: Cancellation

Deliverables:

- `DELETE /tasks/:id`
- in-memory cancellation registry/AbortController for active `TaskService.runTask()` executions
- cancellation from `created`, `provisioning`, and `running`
- runner abort handling
- sandbox stop/cleanup coordination
- terminal `cancelled` result
- idempotent already-cancelled behavior

Verification:

```bash
npm test -- task-cancellation
npm run typecheck
curl -i -X DELETE http://localhost:3000/tasks/<taskId>
```

### Phase 9: Acceptance Harness

Deliverables:

- `scripts/acceptance/task-service-atomic-mvp.sh`
- fixture repo setup
- create/completion/result assertions
- SSE replay/resume assertions
- cancellation smoke assertion
- failure path assertion
- response hiding assertions for sandbox internals

Verification:

```bash
BASE_URL=http://localhost:3000 scripts/acceptance/task-service-atomic-mvp.sh
npm test
npm run typecheck
npm run lint
```

## 14. Risks

### Risks

- In-process async orchestration can be interrupted if the API process crashes after returning `202`.
- Creating task and sandbox in one transaction requires an internal refactor of `SandboxService` creation helpers.
- Promoting `sandbox_events` to a first-class `events` table requires careful migration and updates to existing event-store tests.
- Sequence ownership must be unambiguous; task-owned sandbox events must not accidentally consume sandbox-only sequence counters and create gaps or duplicate task stream order.
- SSE replay could miss events if task channel buffering is not implemented with the same subscribe-first pattern as sandbox SSE.
- Placeholder runner may complete too quickly for reliable curl-level cancellation testing; cancellation edge cases need unit tests with controllable fakes.
- Storing full diffs on `tasks` can become too large later; acceptable for MVP but should move to artifact storage when needed.
- `SandboxService.stop()` currently controls cleanup; cancellation may need command cancellation improvements to fully satisfy "kill in-flight command" semantics.
- Task-owned sandbox cleanup after completion removes the container; task result must remain authoritative.
- Existing sandbox events may expose container names in payloads. Task API should avoid requiring clients to use them, but full redaction would require event payload filtering if product clients must never see internals.

### Tradeoffs

- Use in-process `SandboxService` calls instead of HTTP to keep layering, type safety, and transaction options.
- Remove sandbox routes now to enforce Task Service as the product boundary, accepting less direct HTTP debugging.
- Reuse the event table to keep one source of truth and one ordered task stream.
- Store result fields on `tasks` for MVP rather than introducing artifacts.
- Use a concrete placeholder runner seam rather than a broad AgentService abstraction.
- Keep retry as "create a new task" rather than adding retry state or workers.

### Deferred Decisions

Future only:

- Agent Service implementation and tool protocol
- GitHub repository clone/checkout/branch/push/PR
- durable queue/worker orchestration and crash recovery
- persisted cancellation intent and recovery
- task retry policy beyond create-new-task
- artifact storage for large diffs/logs
- event payload redaction/filtering for product clients if needed
- auth, users, organizations, and permissions
- distributed SSE fanout across multiple API instances
- any future internal admin/debug route for sandbox inspection
- multiple sandboxes per task or parallel subagents
