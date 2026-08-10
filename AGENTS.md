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
  routes/sandbox.routes.ts   thin HTTP layer: parse -> call service -> respond/next(error)
  services/sandbox/
    sandbox.ts          SandboxService: sandbox lifecycle, state transitions, orchestration
    command-execution.ts CommandExecutionService: command lifecycle within a sandbox
    runtime.ts           SandboxRuntime: all docker CLI calls, the only place shelling out
    event-store.ts       EventStore: appends/reads SandboxEvent rows (append-only log)
    sse-hub.ts            SseHub: in-memory pub/sub fanout to open SSE connections
    workspace.ts          workspace path constants + validation helper
  shared/errors.ts      ServiceError (code/message/status/details) — the only error type
                         that crosses a service boundary intentionally
  shared/query-logging.ts runQuery()/logQueryFailure() — wraps Prisma calls for consistent
                         failure logging without double-logging expected ServiceErrors
  types/sandbox.types.ts  zod schemas + shared request/response/event types
prisma/schema.prisma    Sandbox / Command / SandboxEvent models, source of truth for DB shape
tests/                  vitest, one file per service/module, mirrors src/services structure
```

Control flow is layered and one-directional: `routes` -> `SandboxService` ->
(`CommandExecutionService`, `EventStore`, `SandboxRuntime`) -> Prisma /
Docker. Routes never touch Prisma or `SandboxRuntime` directly. Services
never import Express types.

Sandboxes and commands are state machines persisted in Postgres
(`SandboxStatus`, `CommandStatus` in `prisma/schema.prisma`); `sandbox.ts`'s
`transitions` map is the only place that encodes legal status transitions —
extend it there, don't special-case transitions elsewhere.

Every state change is recorded as an immutable, ordered `SandboxEvent`
(`event-store.ts`) and then published to `sseHub` for live subscribers.
When adding a new lifecycle step: append the event in the same DB
transaction as the state mutation (see `SandboxService.create`/`stop`/
`provision` for the pattern), then publish afterward. Never publish before
the transaction commits.

`sandboxService` and `sseHub` are process-wide singletons (constructed at
module load, not via a DI container) — see `sandbox.ts`'s final export and
`sse-hub.ts`. There is deliberately no interface/abstraction layer over the
runtime; `SandboxRuntime` is a concrete class. Don't reintroduce one (an
earlier `SandboxRuntime` interface was removed — see git history) unless a
second runtime implementation is actually being added.

## Conventions

- **Errors**: throw `ServiceError` (`src/shared/errors.ts`) for anything
  that should produce a specific HTTP status/code; anything else is treated
  as an unexpected 500 by `server.ts`'s `errorHandler` and logged. Route
  handlers catch and call `next(error)`; they don't format error responses
  themselves.
- **Validation**: Zod schemas in `types/sandbox.types.ts`, `.strict()` on
  request bodies, parsed at the route boundary before the service is
  called. Services assume already-validated input.
- **Config**: all runtime configuration goes through `config.ts`'s Zod
  schema with an explicit default. Never read `process.env` elsewhere.
- **Logging**: structured, event-name-first (`logger.info("event_name", {
  ...fields })`), see `logger.ts` usage throughout. Use `runQuery`/
  `logQueryFailure` for Prisma calls instead of ad hoc try/catch logging.
- **IDs**: sandbox/command/event IDs are generated with `randomUUID()` or
  Prisma `cuid()`; sandbox IDs are prefixed (`sbox_...`).
- **Docker access**: `SandboxRuntime` in `runtime.ts` is the only module
  that spawns `docker`. If you need a new docker operation, add a method
  there rather than shelling out from a service or route.
- **Workspace paths**: always validate user-supplied `cwd`/paths with
  `isWorkspacePath` (`workspace.ts`) before passing them into a container —
  don't accept arbitrary absolute paths from request bodies.

## Solid coding principles

- **Single Responsibility, layered strictly**: HTTP parsing (`routes/`),
  orchestration/state (`SandboxService`, `CommandExecutionService`),
  external I/O (`SandboxRuntime`, `EventStore`, Prisma) are separate
  concerns in separate files. A change to how Docker is invoked should
  never require touching a route; a change to a response shape should
  never require touching `runtime.ts`.
- **Depend on constructor-injected collaborators, not globals**:
  `SandboxService`/`CommandExecutionService` take `prisma`, `events`,
  `runtime`, `config`, `publish` as constructor args (see `sandbox.ts`).
  This is what makes them unit-testable without a real Docker daemon or
  DB — follow the same pattern for new services instead of importing
  singletons directly inside class bodies.
- **Narrow, explicit types over `any`/loose objects**: request/response and
  event shapes are defined once in `types/sandbox.types.ts` and reused;
  don't inline ad hoc object shapes for things that cross a module
  boundary.
- **Decoupling by contract, not by premature abstraction**: there is no
  `SandboxRuntime` interface today — one concrete implementation is enough.
  Prefer a concrete, well-named class with a small public method surface
  over introducing an interface "for testability" before there's a second
  implementation. Tests substitute plain object doubles that match the
  constructor's expected shape, not mocked interfaces.
  See `tests/sandbox-service.test.ts` for the pattern.
  If a task does require a second runtime implementation, define the
  interface at that point, sized to what both implementations actually
  need.
  Do not add abstractions, config flags, or generic parameters for
  scenarios that aren't part of the current task.
  YAGNI applies here as much as anywhere else in the codebase.
  Keep functions small and single-purpose; prefer composition over
  inheritance; keep the number of exported symbols per module small and
  intentional.
- **Immutable event log as the append point for state history**: don't add
  parallel ways to track "what happened" to a sandbox — extend the
  `EventType` union and go through `EventStore`.
- **Fail closed, log once**: unexpected errors are logged exactly once at
  the boundary that first classifies them (`runQuery`/`errorHandler`);
  don't add redundant logging further up the call stack for the same
  error.

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
