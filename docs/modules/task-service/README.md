# Task Run Runtime

## Purpose

This module no longer exposes a public product surface. The standalone
`TaskService` and its `/tasks` HTTP routes were removed in Phase 8 of the
[repo-scoped chat session agent harness plan](../../planning/repo-scoped-chat-session-agent-harness-plan.md).
The single product path is now session -> message -> run -> result, owned by
the [Chat Session Service](../chat-session/README.md) and
[`RunService`](../../../src/services/task/run-service.ts).

What remains in
[`src/services/task/task.ts`](../../../src/services/task/task.ts) is shared
execution runtime consumed only by the chat-session harness:

- `canTransition(from, to)` — the `TaskStatus` transition guard used by
  `RunService` to validate run state changes.
- `taskServiceRunner` — the process-wide `AgentRunner` instance (a
  `PlaceholderTaskRunner` under `NODE_ENV=test`) that `CodeWorkerRunner` wraps
  to execute a worker brief in the session-owned sandbox.
- `taskServiceArtifacts` — the process-wide `ArtifactStore` instance used to
  record diffs, worker reports, and truncated tool output.

[`src/services/task/task-runner.ts`](../../../src/services/task/task-runner.ts)
defines the shared `TaskRunner`/`TaskRunContext`/`TaskRunResult` contract that
both `AgentRunner` and `RunOrchestrator` implement; `TaskRunContext` always
carries `sessionId` and `messageId` now that every run is session-owned.

The underlying Prisma `Task` table is the transitional storage
representation of a `TaskRun` (see the
[Phase 0 decision record](../../planning/repo-scoped-chat-session-agent-harness-phase-0-decision-record.md)).
It is reached exclusively through `RunService` and `ChatSessionService`; there
is no direct task-scoped route or service boundary anymore.

## Read first

- [`Chat Session Service`](../chat-session/README.md) — the current product
  boundary: session/message/run API, orchestrator-worker harness, artifacts.
- [`Event Service`](../event-service/README.md) — durable session/run events
  and SSE delivery.
- [`Sandbox Service`](../sandbox-service/README.md) — session-owned execution
  plane.
- [`task-service-product-boundary.excalidraw`](./task-service-product-boundary.excalidraw) —
  component diagram (historical; predates the session-owned sandbox and
  `/tasks` removal).
- [`docs/planning/task-service-atomic-mvp-plan.md`](../../planning/task-service-atomic-mvp-plan.md) —
  original implementation decisions and scope (historical).

## History

Earlier phases of this codebase exposed `TaskService` directly through
`POST /tasks`, `GET /tasks/:taskId`, `GET /tasks/:taskId/events`,
`GET /tasks/:taskId/result`, and `DELETE /tasks/:taskId`, with the task itself
owning its own sandbox and event stream. That surface was retired once the
chat-session harness ([Phase 4](../chat-session/README.md) through
[Phase 6](../chat-session/README.md#phase-6-artifact-handling)) reached
equivalent acceptance coverage for session-owned sandboxes, run-scoped events,
and artifact handling. The historical request/response shapes are preserved
in the planning docs for reference; they are not a live contract.

## Development and verification

From the repository root:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

The exhaustive live acceptance harness for the current session -> message ->
run -> result path, including edit, cancellation, failure, cleanup, and SSE
cursor scenarios, is
[`scripts/acceptance/chat-session-atomic-mvp.sh`](../../../scripts/acceptance/chat-session-atomic-mvp.sh).

When changing run or sandbox persistence, update the Prisma schema through a
new migration. Do not hand-edit existing migration files.
