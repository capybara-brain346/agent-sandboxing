# Task Service

## Purpose

The Task Service is the product-facing boundary of the sandboxed coding task
system. It accepts a repo-scoped task, owns the task state machine, creates the
linked sandbox, orchestrates the run, captures the result, and exposes one
replayable task event stream.

The service is implemented in [`src/services/task/task.ts`](../../../src/services/task/task.ts)
and is reached through [`src/routes/task.routes.ts`](../../../src/routes/task.routes.ts).
Sandbox execution remains an internal in-process dependency; callers never
call Docker or sandbox routes directly.

## Read first

- [`docs/agent-sandboxing-project.md`](../../agent-sandboxing-project.md) — product direction
- [`Event Service`](../event-service/README.md) — durable task events and SSE delivery
- [`Sandbox Service`](../sandbox-service/README.md) — internal execution plane
- [`task-service-product-boundary.excalidraw`](./task-service-product-boundary.excalidraw) — component diagram
- [`docs/planning/task-service-atomic-mvp-plan.md`](../../planning/task-service-atomic-mvp-plan.md) — implementation decisions and scope

## Status and scope

The current implementation is the Task Service Atomic MVP. It proves the
product loop with the in-process Agent Service runner:

```text
create task -> provision sandbox -> run agent -> capture diff -> stop sandbox
```

`AgentRunner` drives the AI SDK 7 tool loop against the task-owned sandbox and
returns only a bounded final summary. TaskService remains the authority for
task lifecycle transitions, diff capture, terminal results, cancellation, and
cleanup. Agent tool lifecycle events are appended to the same task stream by
the Agent Service after the sandbox is ready.

This phase does not include GitHub authentication or cloning by URL, users or
auth, queues, retries, a frontend, or PR creation. `repoRef` currently
identifies the local fixture path accepted by the sandbox runtime, not a GitHub
repository reference. OpenRouter credentials are loaded only by the
control-plane composition root and are never sent to a sandbox.

## Public HTTP contract

The application exposes task routes and `/health`. Sandbox routes are retired.
Request validation happens at the route boundary with strict Zod schemas.

### Create a task

```http
POST /tasks
Content-Type: application/json
```

Request body:

```json
{
  "repoRef": "./repo",
  "instructions": "No-op",
  "image": "node:22-bookworm"
}
```

`repoRef` and `instructions` are required non-empty strings. `image` is
optional; when omitted, the sandbox configuration supplies the image. Unknown
body properties are rejected.

The route returns `202 Accepted` immediately:

```json
{
  "taskId": "task_<id>",
  "status": "created",
  "eventsUrl": "/tasks/task_<id>/events"
}
```

The task row, linked `creating` sandbox row, `task_created` event, and
`sandbox_created` event are committed together. Provisioning starts only after
that transaction commits and the initial events have been published.

### Get task status

```http
GET /tasks/:taskId
```

Example shape:

```json
{
  "taskId": "task_<id>",
  "status": "running",
  "repoRef": "./repo",
  "instructions": "No-op",
  "eventsUrl": "/tasks/task_<id>/events",
  "resultUrl": "/tasks/task_<id>/result",
  "createdAt": "2026-08-16T00:00:00.000Z",
  "provisioningAt": "2026-08-16T00:00:00.010Z",
  "runningAt": "2026-08-16T00:00:00.100Z",
  "completedAt": null,
  "failure": null
}
```

`completedAt` is the terminal timestamp, regardless of whether the task
completed, failed, or was cancelled. Missing tasks return `404` with
`task_not_found`.

### Stream task events

```http
GET /tasks/:taskId/events?after=0
```

The endpoint returns Server-Sent Events. A reconnect may use either the
`after` query parameter or the `Last-Event-ID` header. The cursor is a
non-negative integer task-stream sequence. The server replays committed rows
before switching the connection to live fanout; events committed during the
replay query are buffered so they are not lost. Keepalive comments are sent
every 15 seconds.

Each event has this JSON shape:

```json
{
  "id": "evt_<id>",
  "streamId": "task_<id>",
  "taskId": "task_<id>",
  "sandboxId": "sbox_<id>",
  "commandId": null,
  "sequence": 4,
  "type": "task_running",
  "producerService": "task",
  "producerId": "task_<id>",
  "correlationId": "<id>",
  "payload": {},
  "createdAt": "2026-08-16T00:00:00.100Z"
}
```

The `id` sent in the SSE frame is the numeric `sequence`, which is also the
replay cursor. The event store is canonical; `SseHub` is only the in-memory
live delivery layer.

### Get the result

```http
GET /tasks/:taskId/result
```

Results are available only for `completed`, `failed`, or `cancelled` tasks.
Active tasks return `409 task_not_terminal`.

```json
{
  "taskId": "task_<id>",
  "status": "completed",
  "diff": "diff --git ...",
  "agentSummary": null,
  "exitReason": "completed",
  "failure": null,
  "createdAt": "2026-08-16T00:00:00.000Z",
  "completedAt": "2026-08-16T00:00:00.200Z"
}
```

`exitReason` is one of `completed`, `failed`, `cancelled`, or `timed_out`.
The current task runner persists `completed`, `failed`, or `cancelled`; the
`timed_out` value is part of the result contract for future runner behavior.

### Cancel a task

```http
DELETE /tasks/:taskId
```

For a task in `created`, `provisioning`, or `running`, the route returns
`202 Accepted`:

```json
{
  "taskId": "task_<id>",
  "status": "cancelling",
  "eventsUrl": "/tasks/task_<id>/events"
}
```

Cancellation aborts the in-process runner signal, captures a best-effort diff,
stops the sandbox, and persists `cancelled` plus a result-ready event. A task
already in `cancelled` returns `200`. A completed or failed task returns
`409 task_already_terminal`. If cancellation persistence fails, the execution
remains retryable and a later request can attempt it again.

## Task state machine

`TaskService` is the only owner of task transitions:

```text
created --> provisioning --> running --> completed
   |             |              |
   +-------------+--------------+-------> failed
   |             |              |
   +-------------+--------------+-------> cancelled
```

Terminal states are `completed`, `failed`, and `cancelled`. State mutation and
the corresponding task lifecycle events are committed in one transaction.
The asynchronous run never publishes an event before its transaction commits.

The normal execution sequence is:

1. Create `Task` and linked `Sandbox` rows and append `task_created` and
   `sandbox_created`.
2. Claim `created -> provisioning` and append
   `task_provisioning_started`.
3. Ask `SandboxService` to provision the Docker workspace.
4. Claim `provisioning -> running` and append `task_running`.
5. Call the injected `TaskRunner` with `taskId`, `sandboxId`, `instructions`,
   and an `AbortSignal`.
6. Capture the sandbox diff and atomically persist the terminal result with
   `task_completed` and `task_result_ready`.
7. Stop the sandbox after the result is durable. Cleanup is best effort and
   does not rewrite a completed result.

Provisioning, runner, and diff failures become `failed` tasks with a safe
failure code/message and a `task_result_ready` event. Sandbox lifecycle and
command events are interleaved in the same task stream.

## Collaboration boundaries

```text
task routes
     |
     v
TaskService ---- EventStore ---- Postgres
     |
     +---- AgentRunner (TaskRunner)
     |
     +---- SandboxService ---- CommandExecutionService ---- SandboxRuntime ---- Docker
     |
     +---- SseHub ---- open SSE responses
```

The route layer owns HTTP parsing, response status, and SSE setup. `TaskService`
owns orchestration and task state. `SandboxService` owns sandbox state and
execution. `EventStore` owns durable ordered events. `SseHub` owns only live
connection fanout. Services do not import Express types or shell out to Docker.

The production singleton is constructed at module load. Unit tests substitute
plain object collaborators for Prisma, EventStore, SandboxService, the runner,
and the event publisher.

The normal run delegates the agent loop to AgentRunner after the task reaches
`running`. A model/provider failure is converted to a safe `agent_run_failed`
error and persisted by TaskService as a failed terminal task. Cancellation
uses the existing task AbortSignal, which propagates to the AI SDK and each
sandbox tool before TaskService captures the best-effort diff and cleans up.

## Event taxonomy

Task lifecycle events emitted by the current implementation:

- `task_created`
- `task_provisioning_started`
- `task_running`
- `task_completed` or `task_failed` or `task_cancelled`
- `task_result_ready`

The same stream can contain sandbox, command, and diff events from the internal
execution plane. See the [Sandbox Service event stream](../sandbox-service/README.md#event-stream)
for those event types and payload conventions.

Agent tool calls and results use `agent_tool_call` and `agent_tool_result` with
the AI SDK call ID as their correlation ID. The Event Service documents their
bounded payloads and append-before-publish ordering.

## Development and verification

From the repository root:

```bash
npm run typecheck
npm run lint
npm test
```

For a local smoke test, start Postgres and the app, initialize `repo/` as a
Git fixture, then use the create/status/events/result flow above. The
acceptance harness is [`scripts/acceptance/task-service-atomic-mvp.sh`](../../../scripts/acceptance/task-service-atomic-mvp.sh).

When changing task or sandbox persistence, update the Prisma schema through a
new migration. Do not hand-edit existing migration files.
