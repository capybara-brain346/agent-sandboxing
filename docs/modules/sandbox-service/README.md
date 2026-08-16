# Sandbox Service

## Purpose

The Sandbox Service is the task product's internal execution plane. It owns
the task-scoped Docker workspace, runs commands inside that workspace, captures
the Git diff, and publishes sandbox and command lifecycle events to the owning
task stream.

The service does not own task orchestration or the public HTTP API. Those
responsibilities belong to [`TaskService`](../task-service/README.md).

## Read first

- [`docs/agent-sandboxing-project.md`](../../agent-sandboxing-project.md) — product and architecture context
- [`Task Service`](../task-service/README.md) — current product boundary and orchestration
- [`docs/planning/task-service-atomic-mvp-plan.md`](../../planning/task-service-atomic-mvp-plan.md) — task-owned lifecycle decisions
- [`docs/planning/sandbox-service-atomic-mvp-plan.md`](../../planning/sandbox-service-atomic-mvp-plan.md) — historical standalone execution-plane design

## Boundary and status

Sandboxes are created only through the task flow in the public application.
There are no registered `/sandboxes/*` routes. `TaskService` creates the task
and its linked sandbox in one database transaction, then calls the sandbox
service in-process after that transaction commits.

The service currently uses a local fixture repository and Docker. GitHub
integration, authentication, queues, the agent loop, and a second runtime
provider are out of scope.

The public task response does not expose sandbox or container handles. The
task event envelope currently includes `sandboxId` and `commandId` fields for
MVP observability; callers should consume these as event metadata rather than
use them as a separate API surface.

## Internal service contract

`SandboxService` is constructor-injected into `TaskService`. Its task-scoped
operations are:

- `createForTaskInTransaction(tx, input, { taskId })` — inserts a `creating`
  sandbox row and returns its internal metadata. It does not invoke Docker.
- `provisionForTask(sandboxId)` — validates the task-owned row, creates and
  starts the container, copies the fixture into the workspace, and returns
  `ready` or a structured provisioning failure.
- `runCommand(taskId, input)` — delegates to `CommandExecutionService`; only
  the task's ready sandbox can run a command.
- `getCommand(taskId, commandId)` — returns the persisted command snapshot.
- `diff(sandboxId)` — reads `git diff --binary` from the task workspace.
- `stop(sandboxId)` — stops and removes the Docker container and persists the
  stopping/stopped lifecycle.

The future Agent Service should use the command seam through an in-process
collaborator. It must not receive raw Docker access.

## Sandbox lifecycle

The persisted sandbox states are `creating`, `ready`, `stopping`, `stopped`,
`failed`, and `deleted`. The normal task path is:

```text
task transaction
    |
    v
creating --provision--> ready --stop--> stopping --runtime cleanup--> stopped
    |
    +-- provisioning/runtime failure --> failed
```

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

## Event stream

There is no sandbox-specific event stream. Every event has an owning `taskId`
and is appended to that task's ordered `Event` log. Sandbox and command events
that can appear in the stream include:

- sandbox: `sandbox_created`, `sandbox_provisioning_started`,
  `fixture_repo_copy_started`, `fixture_repo_copied`, `sandbox_ready`,
  `sandbox_failed`, `sandbox_stopping`, and `sandbox_stopped`
- commands: `command_started`, `command_output`, `command_completed`,
  `command_failed`, and `command_timed_out`
- diff capture: `git_diff_requested` and `git_diff_completed`

The durable `EventStore` is canonical. `SseHub` provides live fanout and
buffers events during replay; reconnects use the task event sequence via the
`after` query parameter or `Last-Event-ID` header.

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

Create a Git fixture and start a task through the public product boundary:

```bash
mkdir -p repo && git -C repo init
git -C repo config user.email acceptance@example.test
git -C repo config user.name acceptance
printf 'hello\n' > repo/hello.txt && git -C repo add hello.txt && git -C repo commit -m fixture
curl -sS -X POST http://localhost:3000/tasks \
  -H 'content-type: application/json' \
  -d '{"repoRef":"./repo","instructions":"No-op"}'
curl -sS http://localhost:3000/tasks/<taskId>
curl -N 'http://localhost:3000/tasks/<taskId>/events?after=0'
curl -sS http://localhost:3000/tasks/<taskId>/result
```

Use task events, task results, and direct service tests for diagnostics. The
retired sandbox HTTP routes are intentionally not available.

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

Do not read `process.env` directly from sandbox modules. Add new runtime
settings to the Zod config schema with an explicit default.
