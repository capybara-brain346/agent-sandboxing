# Sandbox Service

## Purpose

The Sandbox Service is the chat-session product's internal execution plane. It
owns the session-owned Docker workspace, captures the Git diff, and publishes
sandbox lifecycle events to the owning run stream.

The service does not own run orchestration or the public HTTP API. Those
responsibilities belong to the [Chat Session Service](../chat-session/README.md)
and [`RunService`](../../../src/services/task/run-service.ts).

## Read first

- [`docs/agent-sandboxing-project.md`](../../agent-sandboxing-project.md) — product and architecture context
- [`Chat Session Service`](../chat-session/README.md) — current product boundary and orchestration
- [`Task Run Runtime`](../task-service/README.md) — shared execution runtime and removed `/tasks` history
- [`docs/planning/sandbox-service-atomic-mvp-plan.md`](../../planning/sandbox-service-atomic-mvp-plan.md) — historical standalone execution-plane design

## Boundary and status

Sandboxes are created only through the chat-session run flow. There are no
registered `/sandboxes/*` routes. `RunService` provisions the session-owned
sandbox on the first run of a session and reuses it, unstopped, on later runs.

The service currently uses a local fixture repository and Docker. GitHub
integration, authentication, queues, and a second runtime provider are out of
scope. The Agent Service owns the control-plane agent loop and uses this
service only through the narrow session-owned runtime seam.

The public run response does not expose sandbox or container handles. The run
event envelope includes `sandboxId` and `commandId` fields for observability;
callers should consume these as event metadata rather than use them as a
separate API surface.

## Internal service contract

`SandboxService` is constructor-injected into `RunService`. Its session-scoped
operations are:

- `createForSessionInTransaction(tx, input, { sessionId })` — inserts a
  `creating` sandbox row owned by the session and returns its sandbox ID,
  container name, and workspace path. It does not invoke Docker.
- `ensureReadyForSession(sessionId, runId, sandboxId)` — returns immediately
  for an already-ready sandbox, otherwise provisions it: creates and starts
  the container, copies the fixture into the workspace, and returns `ready` or
  a structured provisioning failure.
- `getAgentToolTarget(sessionId, runId, sandboxId)` — validates session
  ownership and `ready` status, then returns only the container name and a
  `simpleExec` runtime seam to the Agent Service. It never exposes Docker,
  Prisma, or unrelated runtime methods.
- `diffForSession(sessionId, runId, sandboxId)` — reads `git diff --binary`
  from the session workspace.

The sandbox is never stopped by a completed run; it is reused by later runs in
the same session for as long as the session lives.

The Agent Service uses an in-process runtime seam and never receives raw Docker
access. `SandboxRuntime.simpleExec(containerName, command, cwd, options)` runs a
single command and captures bounded `stdout` and `stderr` asynchronously. It
returns non-zero exit codes as normal results, reports a killed timeout with
`timedOut: true`, and rejects cancellation with an `AbortError`. Environment
variables and an `AbortSignal` are optional inputs. Tool code remains
responsible for workspace path validation and command allowlisting.

## Sandbox lifecycle

The persisted sandbox states are `creating`, `ready`, `stopping`, `stopped`,
`failed`, and `deleted`. The normal session path is:

```text
session transaction (first run)
    |
    v
creating --provision--> ready
    |
    +-- provisioning/runtime failure --> failed
```

A completed run never transitions the sandbox to `stopping`/`stopped`; the
`stopping`/`stopped` states remain defined for a future explicit
session/sandbox teardown path.

`SandboxService` is the only place that defines the legal status transition
map. State changes and their lifecycle events are written in the same Prisma
transaction. Events are published to `SseHub` only after the transaction has
committed.

## Provisioning behavior

Provisioning currently:

1. Resolves and validates the configured fixture directory, defaulting to
   `./repo`.
2. Creates one named container using `SANDBOX_IMAGE` (default
   `node:22-bookworm`).
3. Applies the configured memory, CPU, and PID limits.
4. Starts the container with an idle `sleep infinity` process.
5. Creates `/workspace/repo` and copies the fixture contents, including
   `.git`, into it.
6. Verifies the Git workspace and changes ownership to `node:node`.

The fixture is copied into the container. The container does not receive a
host fixture bind mount or the Docker socket. Docker is invoked only by
[`src/services/sandbox/runtime.ts`](../../../src/services/sandbox/runtime.ts).

The workspace path is `/workspace/repo`. User-supplied command working
directories are accepted only when [`isWorkspacePath`](../../../src/services/sandbox/workspace.ts)
confirms that they remain under this path.

## Command execution

`CommandExecutionService`
([`src/services/sandbox/command-execution.ts`](../../../src/services/sandbox/command-execution.ts))
implements a persisted, one-command-at-a-time execution model, but it is not
currently wired into `SandboxService` or reachable from any route — agent
tools use the `simpleExec` runtime seam instead (below). It is retained and
unit-tested as a seam for a future durable/streamed command API. Where wired,
its contract is:

Commands run sequentially per sandbox. A database constraint allows at most one
`running` command for a sandbox. Each command is persisted before execution is
started and receives an ordered task-stream event sequence.

Command input is normalized as follows:

- `command` is trimmed and must not be empty.
- `cwd` defaults to `/workspace/repo` and must remain inside the workspace.
- Environment names must match `[A-Z_][A-Z0-9_]*`; each value is limited to
  4096 characters.
- `timeoutMs` defaults to `SANDBOX_COMMAND_TIMEOUT_MS` and cannot exceed it
  (default: 120 seconds).
- Persisted output is capped by `COMMAND_OUTPUT_MAX_BYTES` (default: 10 MiB),
  split into UTF-8-safe chunks, and marked when truncated.

The command snapshot records status, exit code, output byte count, truncation,
and timestamps. Command execution failures are represented as structured
events and safe service errors; raw runtime failures do not cross the service
boundary.

Agent tools use `simpleExec` for one-shot capture rather than the persisted
command API. Captured output is bounded by `COMMAND_OUTPUT_MAX_BYTES`, remains
valid UTF-8 at the boundary, and reports `truncated` when the combined output
exceeds the limit.

The sandbox target seam never forwards the OpenRouter API key or any other
control-plane secret into a container. Agent tool calls receive only the
session-owned runtime target and the run cancellation signal.

## Event stream

There is no sandbox-specific event stream. Every sandbox lifecycle event
carries the owning `sessionId`/`runId` and is appended to that run's ordered
`Event` log. Sandbox events that can appear in the stream include:

- sandbox: `sandbox_created`, `sandbox_provisioning_started`,
  `fixture_repo_copy_started`, `fixture_repo_copied`, `sandbox_ready`, and
  `sandbox_failed`
- agent tools: `agent_tool_call` and `agent_tool_result`, appended by the
  Agent Service to the same owning run stream
- diff capture: `git_diff_requested` and `git_diff_completed`

The durable `EventStore` is canonical. `SseHub` provides live fanout and
buffers events during replay; reconnects use the run event sequence via the
`after` query parameter or `Last-Event-ID` header.
See the [Event Service documentation](../event-service/README.md) for the
shared event contract and append/publish invariants.

## Debug logging

Sandbox debug logs cover provisioning start and outcome, sandbox reuse through
`RunService`, and diff capture outcome. They include session, run, and sandbox
IDs with durations, byte counts, and safe failure codes. Fixture paths, image
values, command output, and runtime error details are not added to debug logs.
Backend logs are JSON-only. `LOG_LEVEL` controls emission, and `LOG_COLOR` can
color JSON lines for TTY readability; non-TTY output remains clean JSON by
default.

## Development and smoke test

From the repository root:

```bash
cp .env.example .env
npm install
npm run prisma:generate
docker compose up -d postgres
npm run prisma:migrate
npm run typecheck
npm test
npm run dev
```

The root Compose file also supports the migration/app flow:

```bash
docker compose build app
docker compose up db-migrate
docker compose up app
```

Create a Git fixture, start a session, and send a message through the public
product boundary:

```bash
mkdir -p repo && git -C repo init
git -C repo config user.email acceptance@example.test
git -C repo config user.name acceptance
printf 'hello\n' > repo/hello.txt && git -C repo add hello.txt && git -C repo commit -m fixture
curl -sS -X POST http://localhost:3000/chat-sessions \
  -H 'content-type: application/json' \
  -d '{"repo":{"source":"fixture","ref":"./repo"}}'
curl -sS -X POST http://localhost:3000/chat-sessions/<sessionId>/messages \
  -H 'content-type: application/json' \
  -d '{"content":"No-op"}'
curl -sS http://localhost:3000/chat-sessions/<sessionId>/runs/<runId>
curl -N 'http://localhost:3000/chat-sessions/<sessionId>/runs/<runId>/events?after=0'
curl -sS http://localhost:3000/chat-sessions/<sessionId>/runs/<runId>/result
```

Use run events, run results, and direct service tests for diagnostics. The
retired `/sandboxes/*` and `/tasks/*` HTTP routes are intentionally not
available.

## Configuration

All runtime configuration is loaded and validated by `src/config.ts`:

- `SANDBOX_IMAGE`
- `FIXTURE_REPO_PATH`
- `SANDBOX_PROVISION_TIMEOUT_MS`
- `SANDBOX_COMMAND_TIMEOUT_MS`
- `SANDBOX_MEMORY_BYTES`
- `SANDBOX_CPUS`
- `SANDBOX_PIDS_LIMIT`
- `SANDBOX_STOP_GRACE_MS`
- `COMMAND_OUTPUT_MAX_BYTES`

Agent-facing limits are also validated centrally here so tool implementations do
not read `process.env` directly:

- `AGENT_MODEL` (default `openrouter:deepseek/deepseek-v4-flash`)
- `AGENT_MAX_STEPS` (default `25`, range `1..100`)
- `AGENT_BASH_TIMEOUT_MS` (default `120000`, minimum `1000`)
- `AGENT_BASH_OUTPUT_MAX_BYTES` (default `51200`, minimum `1024`)
- `AGENT_READ_MAX_BYTES` (default `262144`, minimum `1024`)
- `AGENT_WRITE_MAX_BYTES` (default `1048576`, minimum `1024`)
- `AGENT_TOOL_TIMEOUT_MS` (default `30000`, minimum `1000`)

`OPENROUTER_API_KEY` is deliberately not a sandbox-facing setting; the Agent
Service composition root owns it and never forwards it to tools or containers.

Do not read `process.env` directly from sandbox modules. Add new runtime
settings to the Zod config schema with an explicit default.
