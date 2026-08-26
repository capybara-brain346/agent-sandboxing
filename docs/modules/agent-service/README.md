# Agent Service — Agent Runner, Event Relay, and Live Acceptance

The Agent Service owns all model-backed agent behavior. It runs inside the API
process, uses the AI SDK 7 `generateText` calls with the configured OpenRouter
model, owns orchestration and summary-compaction decisions, proxies seven tools
through the session-owned sandbox runtime, relays tool lifecycle events to the
shared run event stream, and records model usage for the eval trace layer. It
does not expose an HTTP route or call the persisted command API.

`RunService` remains responsible for run lifecycle transitions, terminal
results, cancellation, and diff capture; the sandbox is never stopped by a
completed run. AgentRunner returns a schema-validated `WorkerResult` or throws;
it does not mutate run state. The retired generic `TaskRunner` runtime has a
small composition adapter for compatibility, but the chat harness receives the
typed worker result directly — see the [Chat Session Service](../chat-session/README.md#phase-5-orchestrator-worker-harness).

## Read first

- [`docs/agent-sandboxing-project.md`](../../agent-sandboxing-project.md) — product direction and control-plane/execution-plane boundary
- [`Chat Session Service`](../chat-session/README.md) — run lifecycle, orchestrator-worker harness, and runner seam
- [`Sandbox Service`](../sandbox-service/README.md) — session-owned runtime target and execution boundary
- [`Event Service`](../event-service/README.md) — durable event and SSE contract
- [`docs/planning/agent-service-atomic-mvp-plan.md`](../../planning/agent-service-atomic-mvp-plan.md) — MVP decisions and non-goals

## Implementation map

- [`AgentRunner`](../../../src/services/agent/agent-runner.ts) — model loop, tool registry, cancellation, and summary extraction
- [`code-worker.ts`](../../../src/services/agent/code-worker.ts) — typed worker seam used by the chat harness
- [`ToolEventRelay`](../../../src/services/agent/tool-event-relay.ts) — durable tool-call/result events and safe payloads
- [`model.ts`](../../../src/services/agent/model.ts) — OpenRouter model resolution
- [`orchestrator-agent.ts`](../../../src/services/agent/orchestrator-agent.ts) — direct-reply/delegation model and bounded delegation controller
- [`session-summary-compactor.ts`](../../../src/services/agent/session-summary-compactor.ts) — bounded summary-compaction model
- [`load-prompt.ts`](../../../src/prompts/load-prompt.ts) — loads and validates the versioned system prompt YAML files
- [`prompts/code-worker.yaml`](../../../prompts/code-worker.yaml) — CodeWorker's `generateText` system prompt
- [`tools/`](../../../src/services/agent/tools/) — sandbox-proxied tool implementations and bash policy
- [`tests/agent-runner.test.ts`](../../../tests/agent-runner.test.ts) — runner behavior and cancellation
- [`tests/orchestrator-agent.test.ts`](../../../tests/orchestrator-agent.test.ts) — orchestration behavior and delegation bounds
- [`tests/session-summary.test.ts`](../../../tests/session-summary.test.ts) — summary compaction and bounds
- [`tests/agent-tool-relay.test.ts`](../../../tests/agent-tool-relay.test.ts) — event ordering and payload bounds
- [`tests/agent-tools.test.ts`](../../../tests/agent-tools.test.ts) — tool validation and runtime behavior
- [`tests/evals/run-dataset-evals.ts`](../../../tests/evals/run-dataset-evals.ts) — local orchestrator routing eval runner
- [`tests/evals/run-repo-evals.ts`](../../../tests/evals/run-repo-evals.ts) — local repository behavior eval runner
- [`tests/evals/subjective-judge.ts`](../../../tests/evals/subjective-judge.ts) — report-only subjective score judge

The production composition path selects the model-backed AgentRunner,
OrchestratorAgent, and SessionSummaryCompactor. The default test composition
uses the existing placeholder runner; harness tests inject small collaborators
directly so they do not need provider credentials. `RunOrchestrator` depends on
the narrow `CodeWorker` contract and receives the typed AgentRunner result
directly. These are in-process collaborators of `RunService`, not a separate
HTTP service. The chat service wires production collaborators explicitly but
does not contain their model calls.

## Dataset eval smoke suite

`npm run eval:dataset` runs the ten-case local orchestrator suite in
[`tests/evals/cases/dataset.jsonl`](../../../tests/evals/cases/dataset.jsonl).
It calls `ModelOrchestratorAgent` directly with a fake worker delegate, so it
does not provision Docker, access the database, or require Langfuse. The
runner writes one JSON object per case to
`tests/evals/results/dataset-<timestamp>.jsonl`, prints routing and delegation
scores, and exits nonzero when the 95% deterministic case threshold fails.
The command still requires the configured `OPENROUTER_API_KEY` and
`AGENT_MODEL`.

`npm run eval:dataset:judge` enables the optional report-only subjective judge.
It uses the configured `AGENT_MODEL`, adds five 1-to-5 scores to each JSONL
record, and includes the scores in the terminal report. The judge receives the
case task, bounded context, and observed outcome, but not case expectations.
Judge errors are recorded in the case result and never change deterministic
case status or suite exit status. `npm run eval:repo:judge` does the same for
repository cases; `npm run eval:judge` runs both suites with judging enabled.

Both runners accept a `resultsPath` and `resume` option when called as library
functions. Resuming reads the existing JSONL, keeps passing case records, and
retries failed or incomplete cases. A truncated final JSONL line is ignored so
an interrupted run can be resumed safely; completed records include the
observed model, worker, tool, diff, response, and command facts needed to debug
failures locally.

## Repo eval suite

`npm run eval:repo` runs the ten repository cases in
[`tests/evals/cases/repo.jsonl`](../../../tests/evals/cases/repo.jsonl) through
the real chat-session service seam. Each case is copied to a temporary Git
repository, executed in its own chat session, and removed after the terminal
run is collected. The runner records run results, worker-report artifacts,
assistant messages, changed files, verification commands, and agent tool events
in `tests/evals/results/repo-<timestamp>.jsonl`.

Cases can declare `postRunCommands`. The runner applies the captured diff to the
temporary host copy for local test seams; the live service runs each command in
the provisioned sandbox. It stores exit code, timing, output, and truncation
facts in `observed.postRunChecks`. These checks are independent of worker-
reported test claims and are included in the verification score. Case
expectations also support exact or allowlisted changed files, forbidden diff
snippets, required response text, test mentions, and blocker mentions.

The suite requires the same database, Docker, model, and provider settings as a
live agent run. It passes when at least nine of ten cases pass all deterministic
scores and no case changes a forbidden file or diff snippet. The runner uses
`SANDBOX_IMAGE` for the fixture container, so the configured image must provide
the fixture's Python and Git tooling.

## Composition and model configuration

`AGENT_MODEL` must use the `openrouter:<model-id>` format. The composition root
resolves it with `createOpenRouter({ apiKey: config.OPENROUTER_API_KEY })` and
injects the resulting AI SDK `LanguageModel` into `AgentRunner`. Development
and production configuration requires `OPENROUTER_API_KEY`; test-mode
configuration intentionally permits a missing key so unit tests can inject a
fake model or runner.

The key remains in the control plane. It is not included in sandbox
environment variables, tool inputs, events, provider error messages, or logs.

## Runtime boundary

Each factory receives a `Pick<SandboxRuntime, "simpleExec">`, the sandbox's
container name, loaded `Config`, and the run `AbortSignal`. The factory returns
an AI SDK 7 `tool({ inputSchema, execute })` object. The registry contains
exactly these keys:

`read`, `write`, `edit`, `bash`, `grep`, `find`, and `ls`.

The tools execute in `/workspace/repo` through `SandboxRuntime.simpleExec`.
They do not access Prisma, `SandboxService`, Docker, the event store, or
`process.env` directly. Every runtime call receives the run signal and either
`AGENT_TOOL_TIMEOUT_MS` or `AGENT_BASH_TIMEOUT_MS`.
Worker briefs expose `/workspace/repo` as the only workspace path; fixture and
repository source references are not included as worker filesystem paths.

Before creating the registry, AgentRunner asks
`SandboxService.getAgentToolTarget(sessionId, runId, sandboxId)` for the
session-owned, `ready` sandbox. That internal seam queries session ownership
and returns only the container name and `simpleExec`; no Prisma or Docker
details enter the Agent Service.

## AgentRunner and cancellation

AgentRunner checks the run signal before target lookup and before the model
call. It calls `generateText` with one user message containing the worker
brief, the system prompt, all seven workspace tools, and an internal `finish`
tool. The same `abortSignal` is passed through, with a stop condition that
requires a validated finish result and
`isStepCount(config.AGENT_MAX_STEPS + 1)`. The `finish` input is validated with
`workerResultSchema` during that same tool loop, so the accepted result is the
authoritative worker result.
The extra step reserves room for the terminal `finish` call without reducing
the existing work budget. Tool executions are serialized per run because the
AI SDK may request multiple tools concurrently while the tools share one
workspace. The `finish` input is validated with `workerResultSchema` during
that same tool loop; invalid finish input does not satisfy the stop condition,
so the worker can retry with a valid result. The accepted result is merged with
the tool-derived changed-file list and returned as the typed `WorkerResult`.
`finish` is an internal control tool and is not persisted as a user-visible
tool event. If the worker reaches the step limit without submitting a valid
result, AgentRunner returns a blocked result instead of making a second model
call.

An `AbortError` is re-thrown so `RunService`'s existing cancellation path owns
the terminal `cancelled` state. Other provider/model failures become the safe
`agent_run_failed` service error and are persisted by `RunService` as a failed
run.

`ModelOrchestratorAgent` and `ModelSessionSummaryCompactor` use the same
configured model seam for chat orchestration and periodic summary compaction.
Both receive the run `AbortSignal`. The model orchestrator delegates through a
bounded controller that owns attempt results, blocked corrections, and the
terminal failed-attempt rule. `RunOrchestrator` remains responsible for loading
context and persisting the compaction result; it does not import the AI SDK or
call a provider.

## System prompt loading

`AGENT_SYSTEM_PROMPT` is loaded at module load via
`getPromptText("code-worker")`, which reads and validates
[`prompts/code-worker.yaml`](../../../prompts/code-worker.yaml) (versioned,
with `id`, `version`, `updated_at`, `description`, and `prompt` fields) and
caches the parsed result. Prompt YAML files live at the repo root, not under
`src/`, so the same `process.cwd()`-relative path resolves identically in dev
(`tsx`) and in the esbuild-bundled production build; the runtime Docker stage
copies `prompts/` alongside `dist/` for this reason. A malformed or missing
prompt file fails fast at process startup rather than at request time.

## Tool event relay

`ToolEventRelay` handles AI SDK `onToolExecutionStart` and
`onToolExecutionEnd` callbacks. It appends `agent_tool_call` before tool
execution and `agent_tool_result` after it through `EventStore.append`, then
publishes the returned event. Each event includes the run and sandbox IDs,
`producerService: "agent"`, `producerId: runId`, and a correlation ID shared
by the matching call/result pair. Repeated SDK call IDs are disambiguated.

Call payloads use `tool_name` and `args`. Result payloads use
`tool_name`, a UTF-8-safe `result_snippet` bounded to 500 bytes,
`truncated`, `exit_code`, and non-negative integer `duration_ms`. Tool errors
use a safe generic result snippet and a null exit code; raw runtime/provider
errors are never persisted.

## Debug logging

Agent debug logs report worker and model lifecycle outcomes, durations, tool-call
counts, delegation counts, summary sizes, and safe failure codes. They do not
log prompts, worker briefs, tool arguments or results, provider responses,
secrets, or model-generated text. Backend logs are JSON-only. `LOG_LEVEL`
controls emission, and `LOG_COLOR` can color JSON lines for TTY readability;
non-TTY output remains clean JSON by default.

## Tool contracts

- `read({ path })` returns `{ content, truncated }`. The content is capped at
  `AGENT_READ_MAX_BYTES`.
- `write({ path, content })` returns `{ bytesWritten }`. Content is sent as
  base64 through the shell and is capped at `AGENT_WRITE_MAX_BYTES`.
- `edit({ path, oldString, newString })` requires exactly one literal match,
  writes the replacement, and returns `{ diff, truncated }`. Files and the
  replacement are limited by the read/write limits; the returned replacement
  diff is capped at 1 KiB.
- `bash({ command })` returns bounded `{ stdout, stderr, exitCode, timedOut,
truncated }` output. Its timeout is `AGENT_BASH_TIMEOUT_MS` and its response
  budget is `AGENT_BASH_OUTPUT_MAX_BYTES`.
- `grep({ pattern, path? })` recursively returns numbered `matches`. Exit code
  1 is an empty match set.
- `find({ pattern, path? })` returns matching file paths in `paths`.
- `ls({ path? })` returns a detailed directory listing in `listing`.

`grep`, `find`, and `ls` have a fixed 50 KiB UTF-8 response budget and report
`truncated: true` when the budget is exceeded. All truncation preserves valid
UTF-8 boundaries.

## Validation and errors

Paths must be absolute lexical paths under `/workspace/repo`. Empty, relative,
traversal, NUL/control-character, shell-operator, and outside-workspace paths
are rejected. Generated path and data arguments use POSIX shell quoting; file
content is base64 encoded rather than interpolated as shell source.

The bash grammar permits only the allowlisted commands, with `|`, `&&`, and
`||` between command segments and redirects whose targets remain in the
workspace. It rejects newlines, semicolons, background execution, command
substitution, backticks, subshells, nested `sh`/`bash -c`, `xargs`, unsafe
`find` execution flags, outside-workspace paths, and test runners/invocations
including `npm test`, `npm run test`, `npx vitest`, `npx jest`, Playwright, and
Cypress.

Invalid input, oversized input, timeouts, non-zero command results, and
runtime failures become bounded `ServiceError`s with stable safe codes. Raw
runtime diagnostics are not copied into error messages. Cancellation remains an
`AbortError` so the future runner can stop the whole task cleanly.

## Configuration

The public runtime configuration contract is defined only in
[`src/config.ts`](../../../src/config.ts):

- `AGENT_TOOL_TIMEOUT_MS`: non-bash tool timeout, default 30 seconds.
- `AGENT_BASH_TIMEOUT_MS`: bash timeout, default 120 seconds.
- `AGENT_BASH_OUTPUT_MAX_BYTES`: bash response budget, default 50 KiB.
- `AGENT_READ_MAX_BYTES`: read/edit source budget, default 256 KiB.
- `AGENT_WRITE_MAX_BYTES`: write/edit result budget, default 1 MiB.
- `LANGFUSE_ENABLED`: enables remote Langfuse trace export, default `false`.
- `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY`: required when Langfuse is enabled.
- `LANGFUSE_BASE_URL`: optional Langfuse endpoint override.
- `LANGFUSE_FLUSH_TIMEOUT_MS`: best-effort flush timeout, default 2 seconds.
- `LOCAL_TRACE_EXPORT_ENABLED`: enables JSONL trace export, default `false`.
- `LOCAL_TRACE_EXPORT_PATH`: JSONL destination, default `.data/eval-traces.jsonl`.
- `EVAL_TRACE_CONTEXT_SNAPSHOT_ENABLED`: includes context snapshots, default `false`.

When running with Docker Compose, `.env` values are interpolated into the
container only when they are listed in `docker-compose.yml`. Set the Langfuse
variables in `.env` before recreating the app container:

```bash
LANGFUSE_ENABLED=true
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_BASE_URL=https://cloud.langfuse.com
```

```bash
docker compose up --build -d
```

The tools are intentionally DB-independent and Docker-independent in tests;
tests mock only the `simpleExec` seam.

## Live acceptance

Live coverage extends the chat-session harness; no second acceptance script is
required. From the repository root, run:

```bash
NODE_ENV=development BASE_URL=http://localhost:3000 \
  scripts/acceptance/chat-session-atomic-mvp.sh
```

The command requires a non-test API running against the repository workspace,
Postgres with the committed Prisma migrations applied, a reachable Docker
daemon, a clean host fixture repository, and `curl`, `git`, `jq`, `timeout`,
`npx`, and `docker` on the host.
The API process must have `OPENROUTER_API_KEY` configured and a valid
`AGENT_MODEL`; the key is required by the harness but is never printed.

The harness also accepts these environment variables:

- `BASE_URL` (default `http://localhost:3000`)
- `NODE_ENV` (must be `development` or `production`, not `test`)
- `OPENROUTER_API_KEY` (required; used by the API, never logged by the harness)
- `DATABASE_URL` (used by `npx prisma migrate status`)
- `REPO_REF` (default `./repo`) and `FIXTURE_REPO_PATH` (default `./repo`)
- `POLL_SECONDS` (default 180) and `SSE_TIMEOUT_SECONDS` (default 5)

The scenarios are:

1. A read-only agent reads exactly `/workspace/repo/hello.txt`, returns a
   non-null summary, and produces an empty diff.
2. An editing agent appends the exact acceptance line to `hello.txt`; the
   result is completed and its diff contains that line.
3. Full event replay, `after=2`, and `Last-Event-ID: 2` resume checks verify
   strict ordering and include the agent events.
4. Cancellation and missing-fixture provisioning failure remain covered.

For each live agent run, assertions validate the durable event envelope,
session/run/sandbox ownership, matching tool-call correlation IDs and
ordering, bounded result snippets, exit codes, truncation flags, durations,
sanitized provider output, diff lifecycle events, and that the sandbox is
reused (not stopped) across runs in the same session. They deliberately do
not compare exact model prose. Agent edits happen only in copied sandbox
workspaces; the host fixture is checked for changes and restored after the
provisioning-failure scenario on every exit path.
