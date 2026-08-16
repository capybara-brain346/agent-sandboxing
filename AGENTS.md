# AGENTS.md

Context and rules for coding agents working in this repo. Optimized for
correctness and low ambiguity, not exhaustiveness — read the referenced
files instead of trusting descriptions to stay current.

## What this is

Sandbox Service: the untrusted execution plane for a future cloud coding
agent system (see `docs/agent-sandboxing-project.md` for product direction).
It creates one Docker container per sandbox, copies a fixture repo into it,
runs commands inside it, streams structured events over SSE, and produces
git diffs. It does not itself run an agent loop, talk to GitHub, or hold
LLM/provider credentials — treat those as explicitly out of scope unless a
task says otherwise.

## Stack

- Node.js + TypeScript (ESM, strict mode), Express 5, Prisma (Postgres),
  Zod for input validation, Vitest for tests, esbuild for the prod bundle.
- Sandboxing is plain `docker` CLI invocations via `child_process.spawn`
  (`src/services/sandbox/runtime.ts`) — no Docker SDK, no other sandbox
  provider today.

## Architecture

```
src/
  index.ts            process entrypoint: config load, listen, signal/error-driven shutdown
  server.ts            createApp(): express wiring, request/error middleware, /health
  config.ts            zod-validated env schema — the only source of runtime config
  routes/task.routes.ts      only public product HTTP surface
  services/task/
    task.ts             TaskService: task lifecycle and result orchestration
    task-runner.ts      runner seam for the future Agent Service
  services/sandbox/
    sandbox.ts          internal task-owned lifecycle and execution orchestration
    command-execution.ts CommandExecutionService: task-scoped command lifecycle
    runtime.ts           SandboxRuntime: all docker CLI calls, the only place shelling out
    workspace.ts         workspace path constants + validation helper
  services/events/
    event-store.ts      task-stream Event persistence (append-only log)
    sse-hub.ts          in-memory task-stream pub/sub to open SSE connections
  shared/errors.ts      ServiceError (code/message/status/details) — the only error type
                         that crosses a service boundary intentionally
  shared/query-logging.ts runQuery()/logQueryFailure() — wraps Prisma calls for consistent
                         failure logging without double-logging expected ServiceErrors
  types/sandbox.types.ts  internal command/runtime types and validation
  types/event.types.ts    task-stream event envelope and producer taxonomy
prisma/schema.prisma    Task / Sandbox / Command / Event models, source of truth for DB shape
tests/                  vitest, one file per service/module, mirrors src/services structure
```

Control flow is layered and one-directional: `routes` -> `TaskService` ->
(`TaskRunner`, `SandboxService`, `EventStore`) -> (`CommandExecutionService`,
`SandboxRuntime`) -> Prisma / Docker. The Sandbox Service is an internal
task dependency; there is no standalone sandbox HTTP router. Routes never
touch Prisma, `SandboxRuntime`, or sandbox internals directly. Services never
import Express types.

Sandboxes and commands are state machines persisted in Postgres
(`SandboxStatus`, `CommandStatus` in `prisma/schema.prisma`); `sandbox.ts`'s
`transitions` map is the only place that encodes legal status transitions —
extend it there, don't special-case transitions elsewhere.

Every task, sandbox, and command state change is recorded as an immutable,
ordered `Event` row on the owning task stream and then published to `sseHub`
for live subscribers.
When adding a new lifecycle step: append the event in the same DB
transaction as the state mutation, then publish afterward. Never publish
before the transaction commits. Events always have a `taskId`; sandbox-owned
history is not a separate stream.

`sandboxService` and `sseHub` are process-wide singletons (constructed at
module load, not via a DI container) — see `sandbox.ts`'s final export and
`sse-hub.ts`. There is deliberately no interface/abstraction layer over the
runtime; `SandboxRuntime` is a concrete class. Don't reintroduce one (an
earlier `SandboxRuntime` interface was removed — see git history) unless a
second runtime implementation is actually being added.

## Working in this repo

- `npm run dev` — watch mode entrypoint. `npm test` — vitest (DB-independent
  unit tests). `npm run test:runtime` — tests that need a real Docker
  daemon/DB, run separately (`vitest.runtime.config.ts`).
- `npm run typecheck` and `npm run lint` before considering a change done;
  `tsconfig.json` runs with `strict`, `noUncheckedIndexedAccess`, and
  `exactOptionalPropertyTypes` — respect them rather than widening types or
  adding non-null assertions to route around them.
- Prisma schema changes need a migration: `npm run prisma:migrate:dev`.
  Don't hand-edit files under `prisma/migrations/`.
- `repo/` at the project root is a fixture repo copied into sandboxes for
  local dev/testing (see `FIXTURE_REPO_PATH` in `config.ts`) — it is not
  application source.
