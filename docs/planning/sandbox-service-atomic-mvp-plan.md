> Created: 2026-08-10
> Status: Valid / active planning document
> Valid for: Sandbox Service Atomic MVP only
> Invalid when: sandbox-service implementation is completed and the project moves to the next component, or this plan is superseded by a newer planning document
> Scope reminder: Express + TypeScript + Postgres + Prisma + Docker; no Task Service, GitHub, Agent Service, auth, frontend, or PR creation in this phase

# Sandbox Service Atomic MVP Implementation Plan

## 1. Product Boundary And Non-Goals

### Goal

Build the first atomic component of the cloud coding agent system: a Sandbox Service with a durable Event Store.

The MVP proves that the platform can:

- create an isolated Docker-backed sandbox asynchronously
- prepare a local fixture repository in the sandbox workspace
- persist sandbox state, command state, and ordered events in Postgres
- stream events over SSE without treating SSE as source of truth
- run sequential commands inside the sandbox
- return a current working-tree diff
- stop and clean up the sandbox
- replay event history after disconnect
- expose enough behavior for a future Task Service to orchestrate it

### Hard Scope

This phase includes only:

- Express HTTP API
- TypeScript service code
- Postgres
- Prisma
- Docker container runtime for sandboxes
- local fixture repo preparation from `./repo`
- durable event store and state snapshots
- curl-based acceptance harness

### Non-Goals

Do not implement or design as active MVP work:

- Task Service
- Agent Service
- GitHub integration
- GitHub clone, branch push, or PR creation
- auth, users, organizations, sessions, or API keys
- frontend
- Kubernetes
- microVMs
- queue workers
- distributed orchestration
- multi-host scheduling
- parallel terminal sessions
- browser preview
- LSP/file watching protocol
- long-lived per-user environments
- arbitrary Docker control exposed to callers

### Future Replacement Boundaries

The MVP should use narrow interfaces so future work can replace pieces later:

- `LocalFixtureRepoPreparer` can later become `GitHubRepoPreparer`.
- `DockerSandboxRuntime` can later become Kubernetes, VM, microVM, or hosted sandbox runtime.
- direct Express callers can later become Task Service calls.
- SSE can later be supplemented by WebSocket, but persisted events remain source of truth.

These boundaries must not pull future concerns into the MVP data model or API.

## 2. Architecture Diagram

```text
curl acceptance harness
        |
        v
Express API process
        |
        +-- SandboxController
        |       POST /sandboxes
        |       GET  /sandboxes/:id
        |       GET  /sandboxes/:id/events
        |       POST /sandboxes/:id/commands
        |       GET  /sandboxes/:id/diff
        |       DELETE /sandboxes/:id
        |
        +-- SandboxService
        |       validates lifecycle rules
        |       owns state transitions
        |       wraps DB mutations in transactions
        |
        +-- EventStore
        |       allocates per-sandbox sequence numbers
        |       appends ordered events transactionally
        |       supports replay by sequence cursor
        |
        +-- DockerSandboxRuntime
        |       creates/stops/removes containers
        |       runs commands through docker exec
        |       copies local fixture repo into workspace
        |
        +-- SseHub
                fans out committed events to connected clients
                never owns state

Postgres + Prisma
        |
        +-- sandboxes
        +-- commands
        +-- sandbox_events
        +-- optional sandbox_sequence_counters

Docker daemon
        |
        +-- one container per sandbox
                /workspace/repo
```

## 3. Components And Responsibilities

### Express App

Responsibilities:

- parse JSON requests
- validate basic request shape and route parameters
- map service errors to stable HTTP errors
- set SSE headers and keepalive comments
- avoid embedding lifecycle logic in route handlers

### SandboxService

Responsibilities:

- create sandbox rows in `creating`
- start asynchronous provisioning after the `POST /sandboxes` response can be returned
- enforce allowed sandbox transitions
- enforce command admission rules
- coordinate Docker runtime operations
- append events and update snapshot rows in one transaction wherever possible
- mark sandboxes failed when provisioning or runtime operations fail
- mark sandboxes stopped/deleted according to lifecycle rules

### CommandService

May be a separate module or part of `SandboxService`; either is acceptable if the lifecycle boundary stays clear.

Responsibilities:

- enforce one active command per sandbox
- create command rows in `queued` or `running`
- run command inside the container
- stream stdout/stderr chunks to event store
- persist exit code, timestamps, timeout flag, and final status
- handle command timeout and command process errors

### EventStore

Responsibilities:

- append events in a DB transaction
- allocate strictly increasing `sequence` values per sandbox
- store event type, payload, timestamps, actor, and correlation IDs
- query events after a sequence for replay
- keep payloads structured and bounded
- optionally notify the in-process SSE hub only after transaction commit

The Event Store is source of truth. SSE is only delivery.

### SseHub

Responsibilities:

- maintain in-memory client connections by sandbox ID
- on connect, replay persisted events after `after` query parameter or `Last-Event-ID`
- after replay, subscribe connection to live committed events
- send SSE `id` equal to the event sequence
- send SSE `event` equal to the event type
- send SSE `data` as JSON event object
- send keepalive comments
- drop disconnected clients cleanly

It must not synthesize authoritative lifecycle state.

### DockerSandboxRuntime

Responsibilities:

- create one container per sandbox
- apply resource limits and labels
- ensure workspace path exists
- copy local fixture repo into `/workspace/repo`
- run commands in `/workspace/repo` by default
- stop/remove containers
- inspect container health/existence where needed
- never expose Docker socket inside sandbox containers

### LocalFixtureRepoPreparer

Responsibilities:

- validate `./repo` exists on host before provisioning
- copy `./repo` into sandbox workspace
- optionally reset fixture workspace inside container before tests
- reject unsafe paths and symlinks that escape fixture root
- keep a clear future boundary for replacing this with clone/checkout

## 4. Exact Data Flows

### Create Sandbox

Request:

```text
POST /sandboxes
```

Flow:

1. Express validates JSON body.
2. Service creates `sandboxes` row:
   - `status = creating`
   - `fixture_repo_path = ./repo`
   - `workspace_path = /workspace/repo`
   - `container_name` precomputed
   - no `ready_at`
3. In the same transaction, append `sandbox_created`.
4. API returns `202 Accepted` immediately with snapshot `status = creating`.
5. Async provisioning starts in-process:
   - append `sandbox_provisioning_started`
   - validate host `./repo`
   - create Docker container
   - copy fixture repo into container workspace
   - validate `/workspace/repo` exists
   - update sandbox to `ready`
   - append `fixture_repo_copied`
   - append `sandbox_ready`
6. If any provisioning step fails:
   - stop/remove partially created container if possible
   - update sandbox to `failed`
   - append `sandbox_failed` with structured error payload

Readiness is determined only by the DB snapshot and events, not the original create response.

### Command Execution

Request:

```text
POST /sandboxes/:sandboxId/commands
```

Flow:

1. Express validates command body.
2. Service loads sandbox row.
3. Reject unless sandbox status is `ready`.
4. Reject if any command for the sandbox has status `queued` or `running`.
5. Create command row:
   - `status = running`
   - `started_at = now`
   - command text, cwd, env allowlist, timeout
6. Append `command_started`.
7. Run command with `docker exec`:
   - working dir defaults to `/workspace/repo`
   - stdout and stderr captured separately
   - output is chunked
8. For each output chunk:
   - append `command_output` with `stream`, `chunk`, and chunk counters
   - notify SSE after commit
9. On normal process exit:
   - update command to `succeeded` if exit code is `0`
   - update command to `failed` if exit code is non-zero
   - append `command_completed`
10. On timeout:
   - kill process if possible
   - update command to `timed_out`
   - append `command_timed_out`
   - leave sandbox `ready` unless container became unhealthy
11. If container disappeared or Docker exec fails because sandbox runtime is unusable:
   - update command to `failed`
   - update sandbox to `failed`
   - append `command_failed`
   - append `sandbox_failed`

### SSE Replay And Live Stream

Request:

```text
GET /sandboxes/:sandboxId/events
GET /sandboxes/:sandboxId/events?after=12
```

Flow:

1. Express resolves resume cursor:
   - prefer `after` query parameter if present
   - else use `Last-Event-ID` header if present
   - else start at `0`
2. Validate sandbox exists.
3. Set SSE headers.
4. Query persisted events where `sequence > cursor`, ordered by sequence ascending.
5. Send each replayed event using:
   - `id: <sequence>`
   - `event: <type>`
   - `data: <json>`
6. Register connection in `SseHub`.
7. For future committed events, send them live.
8. Send keepalive comment every 15 seconds:
   - `: keepalive`
9. On disconnect, unregister client.

Replay must not miss events committed between query and subscription. Implementation options:

- Option A, preferred for MVP: subscribe first, replay persisted events, then drop buffered live events whose sequence is less than or equal to the last replayed sequence before flushing buffered live events.
- Option B: replay, subscribe, then immediately query again from last replayed sequence to close the race.

Choose one and test reconnection.

### Stop And Cleanup

Request:

```text
DELETE /sandboxes/:sandboxId
```

Flow:

1. Load sandbox.
2. If sandbox is already `stopped`, return `200` with current snapshot.
3. If sandbox is `deleted`, return `410 Gone` or `404 Not Found`; prefer `410` if tombstones remain.
4. If a command is running:
   - mark command `cancelled`
   - append `command_cancelled`
5. Stop Docker container with grace timeout.
6. Remove Docker container.
7. Update sandbox:
   - `status = stopped`
   - `stopped_at = now`
   - `container_id = null` or keep final container ID for audit
8. Append `sandbox_stopped`.
9. Return `200`.

Cleanup after terminal states may be triggered manually in MVP with:

```text
POST /internal/cleanup
```

or by a process interval. If added, keep it internal and document it. Do not build a full worker queue.

### Failure Handling

Failure flow:

1. Catch operation error.
2. Classify error:
   - `validation_error`
   - `fixture_missing`
   - `docker_create_failed`
   - `docker_copy_failed`
   - `docker_exec_failed`
   - `command_timeout`
   - `container_exited`
   - `workspace_missing`
   - `unknown`
3. Append event with safe structured payload:
   - code
   - message
   - operation
   - retryable
   - commandId if relevant
4. Update snapshot state in the same transaction where possible.
5. Best-effort cleanup any runtime resource if provisioning failed before readiness.

Do not store secrets or full host stack traces in event payloads.

## 5. State Machines

### Sandbox States

Enum:

```text
creating
ready
stopping
stopped
failed
deleted
```

Allowed transitions:

```text
creating -> ready
creating -> failed
creating -> stopping
ready    -> stopping
ready    -> failed
stopping -> stopped
stopping -> failed
stopped  -> deleted
failed   -> deleted
```

MVP may omit physical deletion and keep `deleted` unused. If `deleted` is implemented, it must mean API tombstone/resource gone after cleanup, not merely stopped.

Rejected transitions:

- `ready -> creating`
- `failed -> ready`
- `stopped -> ready`
- `deleted -> any state`
- `creating -> stopped` without passing through `stopping`, unless provisioning cleanup explicitly stores `failed`

Operation admission rules:

- Create command: only `ready`.
- Get snapshot: any non-deleted state.
- Get events: any existing sandbox, including terminal states.
- Get diff: only `ready`, `stopping`, `stopped`, or `failed` if workspace/container is still available; otherwise return `409` with `workspace_unavailable`.
- Stop: allowed for `creating`, `ready`, and `stopping`; idempotent for `stopped`.
- Cleanup/delete: only terminal states `stopped` or `failed`.

### Command States

Enum:

```text
running
succeeded
failed
timed_out
cancelled
```

No queue is needed for MVP because commands are admitted only when no command is active.

Allowed transitions:

```text
running -> succeeded
running -> failed
running -> timed_out
running -> cancelled
```

Rejected transitions:

- any terminal command state -> any other state
- command creation when sandbox is not `ready`
- command creation when another command is `running`
- command creation for a missing, failed, stopped, or deleted sandbox

Command result semantics:

- `succeeded`: process exited with code `0`
- `failed`: process exited non-zero, Docker exec failed, or process could not be started
- `timed_out`: service killed the command because timeout elapsed
- `cancelled`: sandbox stop cancelled the command

Non-zero command exit does not fail the sandbox by itself.

## 6. Event Store Design

### Event Shape

Persisted event:

```ts
type SandboxEvent = {
  id: string;
  sandboxId: string;
  commandId?: string | null;
  sequence: number;
  type: SandboxEventType;
  payload: Record<string, unknown>;
  createdAt: string;
  actor: "api" | "provisioner" | "runtime" | "cleanup";
  correlationId?: string | null;
};
```

SSE `data` should include the same fields. SSE `id` must equal `sequence`.

### Event Types

Minimum MVP event types:

```text
sandbox_created
sandbox_provisioning_started
fixture_repo_copy_started
fixture_repo_copied
sandbox_ready
sandbox_failed
sandbox_stopping
sandbox_stopped
command_started
command_output
command_completed
command_failed
command_timed_out
command_cancelled
git_diff_requested
git_diff_completed
cleanup_started
cleanup_completed
```

`git_diff_requested` and `git_diff_completed` are useful for acceptance proof, but they should not be emitted on every polling call if that becomes noisy. For MVP acceptance, emitting them on `GET /diff` is acceptable.

### Sequence Allocation

Requirement:

- `sequence` is strictly increasing per `sandbox_id`.
- Event ordering is deterministic and stable across replay.
- No two events for one sandbox share a sequence.

Preferred implementation:

- Use a `sandboxes.next_event_sequence` integer column.
- Append transaction does:
  1. `SELECT ... FROM sandboxes WHERE id = $sandboxId FOR UPDATE`
  2. read `next_event_sequence`
  3. insert event with that sequence
  4. increment `next_event_sequence`
  5. update related snapshot rows in the same transaction

Alternative:

- Use `sandbox_event_counters` table with one row per sandbox and `SELECT FOR UPDATE`.

Do not allocate sequences in memory.

### Append Transaction

Every lifecycle mutation should be a single database transaction:

```text
BEGIN
  lock sandbox row
  validate current state
  update sandbox and/or command snapshot
  allocate sequence
  insert sandbox_events row
COMMIT
notify SseHub with committed event
```

For command output chunks, each chunk can be its own transaction. This keeps replay durable even if the process crashes mid-command.

### Ordering Rules

- Snapshot update and event insert are committed together.
- The event sequence represents the logical order for a sandbox.
- `created_at` is informational, not the ordering source.
- Cross-sandbox ordering is not guaranteed and not needed.

### Payload Conventions

Rules:

- payloads are JSON objects
- include IDs instead of duplicating full rows
- use stable snake_case keys inside payloads to align with database style
- never store secrets
- never store raw unbounded output in one event
- keep error payloads safe for frontend and logs
- include `exit_code`, `duration_ms`, and `timeout_ms` on command terminal events

Examples:

```json
{
  "container_name": "agent-sandbox-sbox_01H...",
  "workspace_path": "/workspace/repo"
}
```

```json
{
  "stream": "stdout",
  "chunk": "npm test\n",
  "chunk_index": 3,
  "truncated": false
}
```

```json
{
  "code": "fixture_missing",
  "message": "Local fixture repo ./repo was not found",
  "operation": "prepare_fixture_repo",
  "retryable": false
}
```

### Output Chunking

Command output can be large. MVP rules:

- maximum chunk payload size: 16 KiB of UTF-8 text
- chunk stdout and stderr separately
- preserve arrival order using event sequence
- include `chunk_index` per command stream or per command
- if a single output burst exceeds max size, split into multiple events
- if total command output exceeds configured cap, continue process but emit a final truncated notice:
  - `command_output` with `truncated = true`
  - or `command_completed.payload.output_truncated = true`

Suggested caps:

- `COMMAND_OUTPUT_CHUNK_BYTES = 16384`
- `COMMAND_OUTPUT_MAX_BYTES = 10485760` per command for persisted output

If output cap is reached, later output may be dropped from persistence but command completion must still be persisted.

### SSE Replay And Resume

Endpoint:

```text
GET /sandboxes/:sandboxId/events
GET /sandboxes/:sandboxId/events?after=<sequence>
Last-Event-ID: <sequence>
```

Rules:

- `after` means exclusive sequence cursor.
- `after=0` returns all events.
- `Last-Event-ID` is used only if `after` is absent.
- invalid cursor returns `400 invalid_cursor`.
- missing sandbox returns `404 sandbox_not_found`.
- SSE `id` is the sequence number as a string.
- SSE `event` is the event type.
- SSE `data` is compact JSON.

Replay correctness tests must prove:

- connecting from scratch receives earlier events
- reconnecting with `after=N` receives only events with sequence `> N`
- reconnecting with `Last-Event-ID: N` behaves the same when `after` is absent
- live events after replay continue on the same stream

## 7. Prisma/Postgres Schema Design

### Enums

Prisma enums:

```prisma
enum SandboxStatus {
  creating
  ready
  stopping
  stopped
  failed
  deleted
}

enum CommandStatus {
  running
  succeeded
  failed
  timed_out
  cancelled
}

enum SandboxEventActor {
  api
  provisioner
  runtime
  cleanup
}

enum OutputStream {
  stdout
  stderr
}
```

Event type may be a Prisma enum or string. Prefer string for event type in MVP to reduce migration churn while event taxonomy settles. Enforce known event types in TypeScript.

### `sandboxes`

Fields:

```prisma
model Sandbox {
  id                String        @id @default(cuid())
  status            SandboxStatus
  containerId       String?       @map("container_id")
  containerName     String        @unique @map("container_name")
  image             String
  workspacePath     String        @map("workspace_path")
  fixtureRepoPath   String        @map("fixture_repo_path")
  nextEventSequence Int           @default(1) @map("next_event_sequence")
  failureCode       String?       @map("failure_code")
  failureMessage    String?       @map("failure_message")
  createdAt         DateTime      @default(now()) @map("created_at")
  updatedAt         DateTime      @updatedAt @map("updated_at")
  readyAt           DateTime?     @map("ready_at")
  stoppingAt        DateTime?     @map("stopping_at")
  stoppedAt         DateTime?     @map("stopped_at")
  failedAt          DateTime?     @map("failed_at")
  deletedAt         DateTime?     @map("deleted_at")

  commands          Command[]
  events            SandboxEvent[]

  @@index([status, createdAt])
  @@index([createdAt])
  @@map("sandboxes")
}
```

Notes:

- `containerName` should be deterministic from sandbox ID after ID creation, or generated before insert with a random suffix.
- `nextEventSequence` must only be modified while holding a row lock.
- `deletedAt` should be null unless `status = deleted`.

### `commands`

Fields:

```prisma
model Command {
  id              String        @id @default(cuid())
  sandboxId       String        @map("sandbox_id")
  sandbox         Sandbox       @relation(fields: [sandboxId], references: [id], onDelete: Cascade)
  status          CommandStatus
  command         String
  cwd             String
  env             Json?
  timeoutMs       Int           @map("timeout_ms")
  exitCode        Int?          @map("exit_code")
  outputBytes     Int           @default(0) @map("output_bytes")
  outputTruncated Boolean       @default(false) @map("output_truncated")
  failureCode     String?       @map("failure_code")
  failureMessage  String?       @map("failure_message")
  startedAt       DateTime      @default(now()) @map("started_at")
  completedAt     DateTime?     @map("completed_at")
  createdAt       DateTime      @default(now()) @map("created_at")
  updatedAt       DateTime      @updatedAt @map("updated_at")

  events          SandboxEvent[]

  @@index([sandboxId, createdAt])
  @@index([sandboxId, status])
  @@map("commands")
}
```

Postgres partial unique index required outside Prisma schema:

```sql
CREATE UNIQUE INDEX commands_one_running_per_sandbox
ON commands (sandbox_id)
WHERE status = 'running';
```

This enforces one active command even under concurrent requests.

### `sandbox_events`

Fields:

```prisma
model SandboxEvent {
  id            String            @id @default(cuid())
  sandboxId     String            @map("sandbox_id")
  sandbox       Sandbox           @relation(fields: [sandboxId], references: [id], onDelete: Cascade)
  commandId     String?           @map("command_id")
  command       Command?          @relation(fields: [commandId], references: [id], onDelete: SetNull)
  sequence      Int
  type          String
  actor         SandboxEventActor
  correlationId String?           @map("correlation_id")
  payload       Json
  createdAt     DateTime          @default(now()) @map("created_at")

  @@unique([sandboxId, sequence])
  @@index([sandboxId, sequence])
  @@index([sandboxId, createdAt])
  @@index([commandId, sequence])
  @@map("sandbox_events")
}
```

### Constraints And Invariants

Database invariants:

- unique `(sandbox_id, sequence)` on events
- unique active running command per sandbox
- unique container name
- command must belong to the same sandbox as any event with both IDs

The last invariant is difficult with a simple foreign key. Enforce in service code for MVP; consider a composite FK later if needed.

Transactional invariants:

- every sandbox state change has a corresponding event in the same transaction
- every command terminal state has a corresponding terminal event in the same transaction
- event sequence allocation happens under sandbox row lock
- create sandbox transaction emits `sandbox_created`
- sandbox readiness transaction emits `sandbox_ready`

Suggested raw SQL migration additions:

```sql
ALTER TABLE commands
ADD CONSTRAINT commands_timeout_positive CHECK (timeout_ms > 0);

ALTER TABLE commands
ADD CONSTRAINT commands_output_bytes_nonnegative CHECK (output_bytes >= 0);

ALTER TABLE sandboxes
ADD CONSTRAINT sandboxes_next_event_sequence_positive CHECK (next_event_sequence > 0);
```

## 8. API Contract

### Common Error Shape

```json
{
  "error": {
    "code": "sandbox_not_found",
    "message": "Sandbox was not found",
    "details": {}
  }
}
```

Use stable machine-readable `code` values. Do not expose stack traces.

### `POST /sandboxes`

Creates a sandbox asynchronously.

Request:

```json
{
  "fixtureRepoPath": "./repo",
  "image": "node:22-bookworm",
  "timeoutMs": 600000
}
```

All fields can have defaults for acceptance:

- `fixtureRepoPath`: `./repo`
- `image`: configured `SANDBOX_IMAGE`
- `timeoutMs`: configured sandbox provisioning timeout

Response `202`:

```json
{
  "sandboxId": "cm123",
  "status": "creating",
  "workspacePath": "/workspace/repo",
  "eventsUrl": "/sandboxes/cm123/events"
}
```

Errors:

- `400 invalid_request`
- `500 create_sandbox_failed` only if initial DB insert fails

Provisioning failures after `202` must be visible through `GET /sandboxes/:id` and events, not by changing the create response.

### `GET /sandboxes/:id`

Response `200`:

```json
{
  "sandboxId": "cm123",
  "status": "ready",
  "containerName": "agent-sandbox-cm123",
  "workspacePath": "/workspace/repo",
  "createdAt": "2026-08-10T10:00:00.000Z",
  "readyAt": "2026-08-10T10:00:03.000Z",
  "failure": null
}
```

Failure snapshot:

```json
{
  "sandboxId": "cm123",
  "status": "failed",
  "workspacePath": "/workspace/repo",
  "failure": {
    "code": "fixture_missing",
    "message": "Local fixture repo ./repo was not found"
  }
}
```

Errors:

- `404 sandbox_not_found`
- `410 sandbox_deleted` if tombstones are hidden

### `GET /sandboxes/:id/events`

SSE stream.

Request examples:

```bash
curl -N http://localhost:3000/sandboxes/cm123/events
curl -N "http://localhost:3000/sandboxes/cm123/events?after=4"
curl -N -H "Last-Event-ID: 4" http://localhost:3000/sandboxes/cm123/events
```

SSE frame:

```text
id: 5
event: command_output
data: {"id":"evt1","sandboxId":"cm123","commandId":"cmd1","sequence":5,"type":"command_output","payload":{"stream":"stdout","chunk":"ok\n","chunk_index":1,"truncated":false},"createdAt":"2026-08-10T10:00:05.000Z","actor":"runtime","correlationId":null}

```

Errors before stream starts:

- `400 invalid_cursor`
- `404 sandbox_not_found`

### `POST /sandboxes/:id/commands`

Runs one command.

Request:

```json
{
  "command": "npm test",
  "cwd": "/workspace/repo",
  "env": {
    "CI": "1"
  },
  "timeoutMs": 120000
}
```

Response `202`:

```json
{
  "commandId": "cmd123",
  "sandboxId": "cm123",
  "status": "running"
}
```

Errors:

- `400 invalid_request`
- `404 sandbox_not_found`
- `409 sandbox_not_ready`
- `409 command_already_running`
- `422 unsafe_command_request`

Command request validation:

- command must be non-empty string
- no interactive TTY in MVP
- `cwd` must be under `/workspace/repo`
- env keys must match safe pattern such as `^[A-Z_][A-Z0-9_]*$`
- env values must be strings
- timeout must be within configured max

### `GET /sandboxes/:id/commands/:commandId`

Optional but useful for acceptance.

Response `200`:

```json
{
  "commandId": "cmd123",
  "sandboxId": "cm123",
  "status": "succeeded",
  "exitCode": 0,
  "outputBytes": 1234,
  "outputTruncated": false,
  "startedAt": "2026-08-10T10:00:05.000Z",
  "completedAt": "2026-08-10T10:00:07.000Z"
}
```

Errors:

- `404 sandbox_not_found`
- `404 command_not_found`

### `GET /sandboxes/:id/diff`

Returns current git diff from `/workspace/repo`.

Response `200`:

```json
{
  "sandboxId": "cm123",
  "diff": "diff --git a/file.txt b/file.txt\n...",
  "generatedAt": "2026-08-10T10:00:08.000Z"
}
```

Errors:

- `404 sandbox_not_found`
- `409 sandbox_not_ready`
- `409 workspace_unavailable`
- `500 diff_failed`

Diff implementation:

- run `git diff --binary` or plain `git diff` inside container
- MVP can use plain text diff unless binary file proof is needed
- do not persist full diff automatically; return current snapshot
- emit `git_diff_requested` and `git_diff_completed` for acceptance visibility

### `DELETE /sandboxes/:id`

Stops sandbox and removes container.

Response `200`:

```json
{
  "sandboxId": "cm123",
  "status": "stopped",
  "stoppedAt": "2026-08-10T10:00:12.000Z"
}
```

Errors:

- `404 sandbox_not_found`
- `410 sandbox_deleted`
- `500 sandbox_stop_failed`

Stop should be idempotent for already stopped sandboxes.

## 9. Docker Runtime Design

### Container Naming And Labels

Name:

```text
agent-sandbox-<sandboxId>
```

If Docker name length or character constraints matter, use a sanitized prefix plus short ID:

```text
agent-sandbox-<first_24_chars>
```

Labels:

```text
com.agent-sandboxing.service=sandbox-service
com.agent-sandboxing.sandbox-id=<sandboxId>
com.agent-sandboxing.created-at=<iso timestamp>
com.agent-sandboxing.managed=true
```

Labels allow cleanup to find orphaned containers without relying only on DB state.

### Workspace Path

Inside container:

```text
/workspace/repo
```

Container working directory:

```text
/workspace/repo
```

The service should never allow command `cwd` outside `/workspace/repo`.

### Copy Versus Mount

Use copy for MVP, not bind mount.

Decision:

- Create container with a Docker volume or writable container filesystem.
- Copy host `./repo` into container `/workspace/repo` using Docker archive copy.

Reasons:

- isolates sandbox writes from local fixture source
- makes reset behavior deterministic
- avoids host path mutation by sandbox commands
- keeps the future GitHub clone replacement simple

Do not bind mount the project repo or Docker socket into the sandbox.

### Container Process

Container can start with a long-running idle process:

```text
sleep infinity
```

Commands run through `docker exec`.

The runtime must handle:

- container create
- container start
- copy archive to `/workspace/repo`
- exec create/start/inspect
- stop with grace period
- remove with force after timeout

### Image

Default image:

```text
node:22-bookworm
```

This supports simple fixture repos with Node tooling. Keep image configurable:

```text
SANDBOX_IMAGE=node:22-bookworm
```

Acceptance fixture should not require network package installs unless intentionally testing network.

### Resource Limits

Suggested MVP limits:

```text
SANDBOX_MEMORY_BYTES=1073741824
SANDBOX_CPUS=1
SANDBOX_PIDS_LIMIT=256
SANDBOX_COMMAND_TIMEOUT_MS=120000
SANDBOX_PROVISION_TIMEOUT_MS=60000
SANDBOX_STOP_GRACE_MS=5000
SANDBOX_TTL_MS=3600000
```

Docker options:

- memory limit
- CPU quota or NanoCPUs
- pids limit
- no privileged mode
- read-only root filesystem only if compatible with package managers; defer if it blocks MVP
- writable `/workspace`

### User And Permissions

Prefer non-root execution.

MVP approach:

- use image with an existing non-root user if available, such as `node` in `node:22-bookworm`
- create `/workspace` owned by that user before command execution
- run container as non-root user

If copying as root is required by Docker API, fix ownership after copy:

```text
chown -R node:node /workspace/repo
```

### Network

Network can remain enabled for MVP because tests and installs often need network. Do not expose host Docker socket. Do not run privileged. Do not pass platform secrets into containers.

Future only:

- configurable network policy
- egress allowlists
- package cache proxy

### Timeout Behavior

Provision timeout:

- if container create/copy/validation exceeds timeout, mark sandbox `failed`
- best-effort remove container

Command timeout:

- kill command exec/process
- mark command `timed_out`
- append `command_timed_out`
- keep sandbox `ready` if container remains usable

Stop timeout:

- try graceful stop
- force remove after grace
- if removal fails, mark sandbox `failed` with `cleanup_failed` unless a retry mechanism exists

## 10. Local Fixture Repo Strategy

### Source

The fixture source is the host path:

```text
./repo
```

resolved relative to the service working directory.

### Preparation

Provisioning should:

1. resolve `fixtureRepoPath`
2. ensure it exists
3. ensure it is a directory
4. ensure it contains a `.git` directory or, for minimal fixtures, initialize git before acceptance
5. create a tar archive from its contents using safe path handling
6. copy archive to container `/workspace/repo`
7. verify inside container:
   - `test -d /workspace/repo`
   - `git -C /workspace/repo status --short` works

### Validation

Reject:

- missing fixture directory
- file instead of directory
- path outside allowed fixture root if request path is user-supplied
- symlink escapes during archive creation

For MVP acceptance, path can be fixed to `./repo` and not caller-controlled. If request includes `fixtureRepoPath`, treat it as a developer-only local parameter and validate tightly.

### Reset

Each sandbox gets a fresh copy. No reset endpoint is needed.

Acceptance harness should create or refresh `./repo` before calling the API:

```bash
rm -rf repo
mkdir repo
git -C repo init
printf 'hello\n' > repo/hello.txt
git -C repo add hello.txt
git -C repo commit -m 'fixture'
```

If Git user config is unavailable, harness should set local config:

```bash
git -C repo config user.email acceptance@example.test
git -C repo config user.name "Acceptance Test"
```

### Future GitHub Boundary

Future only:

- replace fixture copy with clone from repository URL
- checkout base branch/commit
- create task branch
- push branch and PR outside Sandbox Service or behind a separate integration boundary

Do not add GitHub fields to the MVP create request.

## 11. Test Strategy

### Unit Tests

Use fakes for:

- Docker runtime
- SSE hub
- clock/ID generation where needed

Cover:

- sandbox transition validator
- command transition validator
- command admission rules
- event payload validation
- sequence allocation service behavior with mocked transactions
- API request validation
- error mapping
- output chunk splitter
- SSE cursor parsing

Unit tests should not require Docker or Postgres except for modules explicitly testing Prisma mapping.

### Integration Tests

Use real Postgres, preferably testcontainers or Docker Compose.

Cover:

- Prisma migrations apply cleanly
- create sandbox row and event in same transaction
- event sequence increments under concurrent append attempts
- unique running command partial index rejects races
- replay query returns strict sequence order
- terminal state/event transaction rollback behavior

Docker runtime can be faked in DB integration tests.

### Runtime Integration Tests

Use real Docker with a small fixture repo.

Cover:

- container create/start/copy
- command exec stdout/stderr capture
- command timeout
- non-zero command exit
- diff generation after file mutation
- stop/remove container
- no mutation of host `./repo`

These tests can be slower and may run under an explicit script:

```text
npm run test:runtime
```

### Acceptance Tests

Use curl and shell only. This is the end-to-end proof that stubs future Task Service behavior.

Acceptance must prove:

- async create returns `202 creating`
- DB-backed snapshot eventually becomes `ready`
- SSE receives replayed setup events
- command endpoint returns `202 running`
- SSE receives command output and terminal event
- reconnect with `after` returns only later events
- reconnect with `Last-Event-ID` works
- diff reflects command mutation
- stop transitions sandbox to `stopped`
- cleanup removes container
- failed create due to missing fixture persists `failed` plus `sandbox_failed`

## 12. Curl Acceptance Script Outline

Script path:

```text
scripts/acceptance/sandbox-service-atomic-mvp.sh
```

The plan requires designing this script; implementation happens later.

### Prerequisites

The script assumes:

- API server already running at `BASE_URL`, default `http://localhost:3000`
- Postgres reachable by service
- Docker daemon available to service
- `jq`, `curl`, `git`, `timeout`, and standard POSIX shell tools installed

### Harness Structure

Pseudo-shell outline:

```bash
#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
WORK_DIR="$(pwd)"
SSE_1="$(mktemp)"
SSE_2="$(mktemp)"
SSE_3="$(mktemp)"

assert_json_eq() { ...; }
assert_contains() { ...; }
wait_for_status() { ...; }
wait_for_sse_event() { ...; }
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

### Create And Readiness Assertions

```bash
CREATE_RESPONSE="$(
  curl -sS -i -X POST "$BASE_URL/sandboxes" \
    -H 'content-type: application/json' \
    -d '{"fixtureRepoPath":"./repo"}'
)"

printf '%s' "$CREATE_RESPONSE" | grep 'HTTP/.* 202'
SANDBOX_ID="$(printf '%s' "$CREATE_RESPONSE" | sed -n '/^{/,$p' | jq -r '.sandboxId')"
STATUS="$(printf '%s' "$CREATE_RESPONSE" | sed -n '/^{/,$p' | jq -r '.status')"
test "$STATUS" = "creating"

wait_for_status "$SANDBOX_ID" "ready" 30
```

### Initial SSE Replay

```bash
timeout 5 curl -sS -N "$BASE_URL/sandboxes/$SANDBOX_ID/events?after=0" > "$SSE_1" || true

assert_contains "$SSE_1" "event: sandbox_created"
assert_contains "$SSE_1" "event: sandbox_ready"
LAST_ID="$(extract_last_sse_id "$SSE_1")"
test "$LAST_ID" -ge 1
```

### Command Execution And Live SSE

Start SSE in background before command:

```bash
curl -sS -N "$BASE_URL/sandboxes/$SANDBOX_ID/events?after=$LAST_ID" > "$SSE_2" &
SSE_PID="$!"
sleep 1
```

Run command:

```bash
COMMAND_RESPONSE="$(
  curl -sS -i -X POST "$BASE_URL/sandboxes/$SANDBOX_ID/commands" \
    -H 'content-type: application/json' \
    -d '{"command":"printf changed >> hello.txt && echo command-ok","timeoutMs":30000}'
)"

printf '%s' "$COMMAND_RESPONSE" | grep 'HTTP/.* 202'
COMMAND_ID="$(printf '%s' "$COMMAND_RESPONSE" | sed -n '/^{/,$p' | jq -r '.commandId')"

wait_for_command_status "$SANDBOX_ID" "$COMMAND_ID" "succeeded" 30
sleep 1
kill "$SSE_PID" || true

assert_contains "$SSE_2" "event: command_started"
assert_contains "$SSE_2" "event: command_output"
assert_contains "$SSE_2" "command-ok"
assert_contains "$SSE_2" "event: command_completed"
```

### SSE Reconnection With `after`

```bash
AFTER_COMMAND_ID="$(extract_last_sse_id "$SSE_2")"

timeout 5 curl -sS -N "$BASE_URL/sandboxes/$SANDBOX_ID/events?after=$LAST_ID" > "$SSE_3" || true

assert_contains "$SSE_3" "event: command_started"
assert_contains "$SSE_3" "event: command_completed"

FIRST_REPLAYED_ID="$(grep '^id:' "$SSE_3" | head -1 | awk '{print $2}')"
test "$FIRST_REPLAYED_ID" -gt "$LAST_ID"
```

### SSE Reconnection With `Last-Event-ID`

```bash
SSE_4="$(mktemp)"
timeout 5 curl -sS -N \
  -H "Last-Event-ID: $LAST_ID" \
  "$BASE_URL/sandboxes/$SANDBOX_ID/events" > "$SSE_4" || true

assert_contains "$SSE_4" "event: command_completed"
```

### Diff Assertion

```bash
DIFF_RESPONSE="$(curl -sS "$BASE_URL/sandboxes/$SANDBOX_ID/diff")"
printf '%s' "$DIFF_RESPONSE" | jq -e '.diff | contains("changed")'
```

### Stop And Cleanup Assertions

```bash
STOP_RESPONSE="$(
  curl -sS -i -X DELETE "$BASE_URL/sandboxes/$SANDBOX_ID"
)"

printf '%s' "$STOP_RESPONSE" | grep 'HTTP/.* 200'
printf '%s' "$STOP_RESPONSE" | sed -n '/^{/,$p' | jq -e '.status == "stopped"'

SNAPSHOT="$(curl -sS "$BASE_URL/sandboxes/$SANDBOX_ID")"
printf '%s' "$SNAPSHOT" | jq -e '.status == "stopped"'
```

If the API exposes container name, script can assert removal:

```bash
CONTAINER_NAME="$(printf '%s' "$SNAPSHOT" | jq -r '.containerName')"
! docker ps -a --format '{{.Names}}' | grep -Fx "$CONTAINER_NAME"
```

This assertion may need to run where Docker CLI can see the same daemon as the service.

### Failure Path Assertion

```bash
mv repo repo.saved
FAIL_RESPONSE="$(
  curl -sS -i -X POST "$BASE_URL/sandboxes" \
    -H 'content-type: application/json' \
    -d '{"fixtureRepoPath":"./repo"}'
)"
mv repo.saved repo

printf '%s' "$FAIL_RESPONSE" | grep 'HTTP/.* 202'
FAILED_SANDBOX_ID="$(printf '%s' "$FAIL_RESPONSE" | sed -n '/^{/,$p' | jq -r '.sandboxId')"
wait_for_status "$FAILED_SANDBOX_ID" "failed" 30

FAILED_EVENTS="$(mktemp)"
timeout 5 curl -sS -N "$BASE_URL/sandboxes/$FAILED_SANDBOX_ID/events?after=0" > "$FAILED_EVENTS" || true
assert_contains "$FAILED_EVENTS" "event: sandbox_failed"
assert_contains "$FAILED_EVENTS" "fixture_missing"
```

### Acceptance Exit Criteria

The script exits zero only if every assertion passes. It prints:

```text
PASS sandbox service atomic MVP acceptance
```

on success.

## 13. Implementation Phases

### Phase 0: Project Skeleton

Deliverables:

- Node/TypeScript project structure
- Express app startup
- Prisma installed and configured
- Docker Compose for Postgres
- env config loader
- health endpoint

Verification:

```bash
npm install
npm run typecheck
npm run test
docker compose up -d postgres
npx prisma migrate dev
curl -fsS http://localhost:3000/health
```

### Phase 1: Prisma Schema And Event Store

Deliverables:

- Prisma schema for sandboxes, commands, events
- raw SQL migration for partial unique index and checks
- EventStore append transaction with per-sandbox sequence allocation
- replay query by `after`
- tests for sequence ordering and transaction rollback

Verification:

```bash
npx prisma migrate reset
npm run test -- event-store
npm run typecheck
```

### Phase 2: Sandbox Lifecycle API With Fake Runtime

Deliverables:

- `POST /sandboxes` returns `202 creating`
- async fake provisioner marks `ready`
- `GET /sandboxes/:id`
- lifecycle transition validator
- events emitted for create/provision/ready/failure

Verification:

```bash
npm run test -- sandbox-lifecycle
npm run dev
curl -i -X POST http://localhost:3000/sandboxes -H 'content-type: application/json' -d '{}'
curl -sS http://localhost:3000/sandboxes/<id> | jq
```

### Phase 3: SSE Replay And Live Delivery

Deliverables:

- `GET /sandboxes/:id/events`
- replay with `after`
- replay with `Last-Event-ID`
- keepalive comments
- live fanout after committed events
- reconnect race handling

Verification:

```bash
npm run test -- sse
curl -N "http://localhost:3000/sandboxes/<id>/events?after=0"
curl -N -H "Last-Event-ID: 1" "http://localhost:3000/sandboxes/<id>/events"
```

### Phase 4: Docker Runtime And Fixture Copy

Deliverables:

- Docker container create/start
- labels and naming
- `/workspace/repo`
- copy `./repo` fixture
- non-root execution where practical
- resource limits
- stop/remove
- provisioning failure handling

Verification:

```bash
npm run test:runtime
docker ps -a --filter label=com.agent-sandboxing.service=sandbox-service
curl -sS http://localhost:3000/sandboxes/<id> | jq '.status'
```

### Phase 5: Command Execution

Deliverables:

- `POST /sandboxes/:id/commands`
- optional `GET /sandboxes/:id/commands/:commandId`
- command state machine
- one running command enforcement
- stdout/stderr chunk events
- exit code persistence
- timeout handling

Verification:

```bash
npm run test -- commands
curl -i -X POST http://localhost:3000/sandboxes/<id>/commands \
  -H 'content-type: application/json' \
  -d '{"command":"echo ok","timeoutMs":30000}'
curl -N "http://localhost:3000/sandboxes/<id>/events?after=0"
```

### Phase 6: Diff And Stop

Deliverables:

- `GET /sandboxes/:id/diff`
- `DELETE /sandboxes/:id`
- idempotent stop
- running command cancellation on stop
- cleanup events

Verification:

```bash
npm run test -- diff stop
curl -sS http://localhost:3000/sandboxes/<id>/diff | jq -r '.diff'
curl -i -X DELETE http://localhost:3000/sandboxes/<id>
```

### Phase 7: Curl Acceptance Harness

Deliverables:

- `scripts/acceptance/sandbox-service-atomic-mvp.sh`
- fixture repo creation/reset
- create/readiness assertions
- SSE replay assertions
- command output assertions
- reconnection assertions
- diff assertion
- stop/cleanup assertion
- failure path assertion

Verification:

```bash
BASE_URL=http://localhost:3000 scripts/acceptance/sandbox-service-atomic-mvp.sh
```

## 14. Risks, Tradeoffs, And Deferred Decisions

### Risks

- In-process async provisioning can be interrupted if the API process crashes after returning `202`.
- Docker exec stream handling can lose output if not persisted chunk-by-chunk.
- SSE race between replay and live subscription can miss events if not explicitly handled.
- Large command output can bloat Postgres if caps are not enforced.
- Running containers on the host Docker daemon is weaker isolation than VM/microVM isolation.
- Non-root execution can conflict with copied file ownership if not tested.
- Local fixture repos with symlinks can escape intended copy boundaries if archive creation is naive.
- Partial cleanup failures can leave orphaned containers.

### Tradeoffs

- Use Docker for MVP because it is fast to build and proves the product loop.
- Use Postgres event persistence instead of in-memory logs because replay and state recovery are central.
- Use async in-process provisioning instead of a worker queue because this phase avoids distributed orchestration.
- Use one command at a time because it makes output ordering, lifecycle, and acceptance clear.
- Use local fixture copy instead of GitHub clone because GitHub belongs to a later integration phase.
- Use SSE instead of WebSocket because MVP needs server-to-client event delivery only.

### Deferred Decisions

Future only:

- durable background worker for provisioning recovery
- Kubernetes, microVMs, or hosted sandboxes
- GitHub clone/checkout/branch/push
- Task Service orchestration
- Agent Service tool protocol
- auth and tenant isolation
- per-repo or per-org policy
- network egress controls
- artifact storage for large logs
- binary diff handling beyond plain text diff
- distributed SSE fanout across multiple API instances

## 15. Definition Of Done

The Sandbox Service Atomic MVP is done when:

- `POST /sandboxes` returns `202` with `creating`, never waits for readiness
- readiness and failure are persisted in Postgres and visible through `GET /sandboxes/:id`
- every sandbox lifecycle transition emits a durable ordered event
- commands run sequentially inside Docker containers
- every command terminal state emits a durable ordered event
- stdout and stderr are persisted as ordered bounded chunks
- SSE can replay from the beginning
- SSE can resume with `after`
- SSE can resume with `Last-Event-ID`
- SSE live delivery sends committed events without being source of truth
- `GET /diff` returns mutations made inside `/workspace/repo`
- `DELETE /sandboxes/:id` stops/removes the container and persists `stopped`
- local `./repo` fixture is copied into the sandbox and host fixture is not mutated
- missing fixture repo produces persisted `failed` state and `sandbox_failed`
- Docker containers have deterministic names, labels, limits, and no Docker socket exposure
- Prisma migrations include required constraints and indexes
- unit, integration, runtime, and acceptance tests are documented and runnable
- curl acceptance harness passes end to end
- no Task Service, GitHub integration, Agent Service, auth, frontend, PR creation, worker queue, Kubernetes, or microVM work is included
