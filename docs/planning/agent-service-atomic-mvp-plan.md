> Created: 2026-08-15
> Status: Valid / active planning document
> Valid for: Agent Service Atomic MVP only
> Invalid when: agent-service implementation is completed and the project moves to agent
> memory, multi-agent coordination, or external tool providers; or this plan is
> superseded by a newer planning document
> Scope reminder: in-process TaskRunner replacement using the Vercel AI SDK (`ai`
> package) for the agent loop; 7 custom tools proxied through Docker exec;
> no PI SDK, no memory, no multi-agent, no GitHub PR creation, no frontend

# Agent Service Atomic MVP Implementation Plan

## 1. Product Boundary And Non-Goals

### Goal

Build the Agent Service — the component that replaces `PlaceholderTaskRunner` with a
real LLM-driven coding agent inside the task lifecycle.

The Agent Service proves that the platform can:

- drive a Vercel AI SDK `generateText` agent loop from inside a `TaskRunner`
- define 7 sandbox-proxied tools (read, write, edit, bash, grep, find, ls) that
  operate inside the Docker container through `SandboxRuntime.simpleExec`
- allowlist bash commands to prevent the agent from running tests (MVP constraint)
- relay tool calls and tool results as task-scoped events through the existing
  EventStore + SseHub
- run a single agent turn (or multi-step tool loop) per task
- return a summary and an exit reason on completion/failure/cancellation
- abort cleanly on task cancellation, propagating the signal through the AI SDK
- accept model choice and timeout from env config (`config.ts`)
- use the portfolio website repository (`./repo` fixture, same as existing
  sandbox flow) as the test workload

The Agent Service is the final runtime component of the task lifecycle. When it
replaces `PlaceholderTaskRunner`, the full flow becomes: create task → provision
sandbox → run agent → capture diff/stash results → clean up → report outcome.

### Hard Scope

This phase includes only:

- `AgentRunner` class implementing `TaskRunner` from `task-runner.ts`
- 7 tool implementations, each a thin wrapper over Docker exec
- bash command allowlist (no test commands)
- Agent event types (`agent_tool_call`, `agent_tool_result`) appended to the task
  event stream
- `"agent"` added to `EventProducerService`
- model selection from `config.ts` (`AGENT_MODEL`)
- `generateText` from Vercel AI SDK as the agent loop engine
- `stopWhen: isStepCount(...)` for loop depth (default 25; AI SDK 7 API)
- AbortSignal plumbing through the AI SDK for cancellation
- DB-independent Vitest unit tests for the runner and each tool
- update to the curl-based acceptance harness to verify the agent runs

### Non-Goals

Do not implement or design as active MVP work:

- Agent memory, conversation persistence, or session resumption between tasks
- Multi-agent coordination, sub-agent spawning, or delegation
- Multiple models per task, model fallback, or provider routing
- Tool execution beyond the 7 sandbox-proxied tools (no web search, no API calls,
  no database access, no external services)
- Custom tools from the task instructions (no `"tools"` field in `CreateTaskRequest`)
- GitHub PR creation, branch push, or commit signing
- File watching, LSP, or live preview
- User-facing agent chat or frontend
- Agent timeouts beyond the task-level timeout (task cancellation covers this)
- Parallel tool execution or tool-level streaming to the frontend before the call
  completes
- Configurable tool allowlist — the allowlist is hardcoded for MVP
- LLM response streaming to the frontend — events contain only the final
  tool-call + result pairs, not text token deltas

### Task Runner Replacement

`PlaceholderTaskRunner` is replaced at the production `TaskService` singleton
construction in `src/services/task/task.ts`:

```typescript
const runner = new AgentRunner({
  config,
  sandbox: sandboxService,
  events,
  model: resolveAgentModel(config),
  publish,
});

const taskService = new TaskService(
  prisma,
  events,
  sandboxService,
  config,
  runner,
  publish,
);
```

The `TaskRunner` interface itself (`TaskRunContext`, `TaskRunResult`) does not
change. AgentRunner is an event producer: it receives `EventStore` and the
post-commit `publish` callback, appends each agent event through
`EventStore.append`, and publishes only after the append resolves. This keeps
agent event persistence inside the service boundary without adding a second
TaskService runner API. TaskService remains responsible for task lifecycle
events and terminal status/result persistence.

## 2. Architecture Diagram

```text
TaskService
    |
    +-- TaskRunner interface
    |       run(context: TaskRunContext): Promise<TaskRunResult>
    |
    +-- AgentRunner (replaces PlaceholderTaskRunner)
    |       |
    |       +-- Vercel AI SDK generateText ({ model, tools, stopWhen })
    |       |       |
    |       |       +-- tool("read")   -> sandboxRuntime.simpleExec("cat <path>")
    |       |       +-- tool("write")  -> sandboxRuntime.simpleExec("cat > <path>")
    |       |       +-- tool("edit")   -> sandboxRuntime.simpleExec(edit pipeline)
    |       |       +-- tool("bash")   -> sandboxRuntime.simpleExec(command) [allowlisted]
    |       |       +-- tool("grep")   -> sandboxRuntime.simpleExec("grep -n <pattern>")
    |       |       +-- tool("find")   -> sandboxRuntime.simpleExec("find <path> <test>")
    |       |       +-- tool("ls")     -> sandboxRuntime.simpleExec("ls -la <path>")
    |       |
    |       +-- ToolEventRelay
    |               captures tool calls + results
    |               EventStore.append -> publish callback with
    |               agent_tool_call / agent_tool_result
    |
    +-- SandboxRuntime (existing)
            adds simpleExec() method for one-shot command capture
            (existing run() is streaming; tools need synchronous capture)

EventStore + SseHub
    agent events flow through same append → publish path
```

## 3. Components And Responsibilities

### AgentRunner

File: `src/services/agent/agent-runner.ts`

Responsibilities:

- implement `TaskRunner.run(context)` with a real LLM agent
- create the system prompt for the coding agent (role + available tools +
  workspace at `/workspace/repo`)
- build the tool registry of 7 sandbox-proxied tools
- resolve the task-owned sandbox target through a narrow Sandbox Service seam
- call AI SDK 7 `generateText({ model, system, messages, tools, stopWhen })`
- wrap `generateText` with AbortSignal (the same signal from TaskRunContext)
- on completion: return `result.text.trim()` as the nullable summary
- relay tool call + result events through the injected EventStore and publish
  callback
- rethrow cancellation and convert provider failures to a safe `ServiceError`
  so TaskService owns the terminal task transition

Constructor seam:

- `config: Config`
- `sandbox: { getAgentToolTarget(taskId: string, sandboxId: string): Promise<{
containerName: string; runtime: Pick<SandboxRuntime, "simpleExec">;
}> }`
- `events: EventStore`
- `model: LanguageModel` (or an injected `resolveAgentModel` factory in tests)
- `publish: (event: PublicEvent) => void`

`getAgentToolTarget` is the only new Sandbox Service seam required by this
slice. It must query by both `taskId` and `sandboxId`, require `status ===
"ready"`, and return the existing runtime plus container name. This keeps
Prisma, container metadata, and Docker access inside Sandbox Service; it does
not introduce a second runtime interface.

Model resolution is a composition-root concern. `AGENT_MODEL` is configuration
input, not the value passed directly as `generateText.model` because AI SDK 7
expects a `LanguageModel`. Add a small resolver/factory for the selected
provider adapter, inject the resulting model into AgentRunner, and keep API
keys out of the sandbox and out of tool code. The resolver must preserve the
current configured model contract or make any required provider/model format
change explicit in `src/config.ts` and `.env.example`.

The runner must not import Express types, Prisma, or the persisted command API.
It may depend on the structural `simpleExec` seam used by the existing tools.

### Tool implementations

Each tool lives in `src/services/agent/tools/<name>.ts`. Every tool follows the
same pattern:

```typescript
import { tool } from "ai";
import { z } from "zod";
import type { SandboxRuntime } from "../../sandbox/runtime";

export const readTool = (runtime: SandboxRuntime, containerName: string) =>
  tool({
    description: "Read the contents of a file at the given path.",
    inputSchema: z.object({
      path: z.string().describe("Absolute path inside /workspace/repo"),
    }),
    execute: async ({ path }) => {
      const result = await runtime.simpleExec(
        containerName,
        `cat "${path}"`,
        "/workspace/repo",
        { timeoutMs: 10_000 },
      );
      return { content: result.stdout, truncated: result.truncated };
    },
  });
```

This pattern keeps each tool testable in isolation — pass a mock runtime.

#### read

- `cat <path>` inside container
- validate path is under `/workspace/repo`
- enforce per-file size limit (configurable, default 256KB)
- return content + truncated flag

#### write

- write content via heredoc or tee: `cat > <path> << 'EOF'`
- validate path is under `/workspace/repo`
- enforce total write size limit (configurable, default 1MB)
- return number of bytes written

#### edit

- search-and-replace on file content
- read file, find unique occurrence of old string, replace with new string
- write modified file back via `cat >`
- validate edited file path is under `/workspace/repo`
- fail if old string is not found or is not unique (same semantics as Hermes patch tool)
- return diff of changes made

#### bash

- `sh -lc "<command>"` inside container at `/workspace/repo`
- validate command against ALLOWLIST (see Section 4 — Tool Contracts)
- enforce per-command timeout (configurable, default 120s)
- enforce per-command output limit (configurable, default 50KB)
- return stdout, stderr, exit code, truncated flag

#### grep

- `grep -n "<pattern>" <path>` inside container at `/workspace/repo`
- validate path is under `/workspace/repo`
- enforce output limit (configurable, default 50KB)
- return matches with line numbers

#### find

- `find <path> -name "<pattern>"` inside container at `/workspace/repo`
- validate path is under `/workspace/repo`
- return list of matching paths

#### ls

- `ls -la <path>` inside container at `/workspace/repo`
- validate path is under `/workspace/repo`
- return directory listing

### ToolEventRelay

File: `src/services/agent/tool-event-relay.ts` (or inline in agent-runner.ts)

Responsibilities:

- capture each tool call (name, arguments, timestamp) and result (output,
  truncated flag, exit code, duration) during the agent loop
- append `agent_tool_call` and `agent_tool_result` through the injected
  `EventStore`, then invoke `publish` only after each append resolves
- use the AI SDK callback `callId` as the envelope `correlationId` for both
  events
- keep event writes ordered: the call event is durable before tool execution,
  and the result event is durable before the next model step
- sanitize tool errors and bound serialized results before they cross the
  event boundary

Use AI SDK 7's `onToolExecutionStart` and `onToolExecutionEnd` callbacks rather
than wrapping every tool's `execute` function. The start callback receives the
validated `toolCall.input`; the end callback receives either a tool result or a
tool error plus `toolExecutionMs`. A successful result may expose an
`exitCode`, `truncated`, or output field; missing values map to `null`/`false`.
Tool errors use `exit_code: null` and a generic safe `result_snippet`; never
serialize raw provider errors, environment values, or secrets.

Shape:

```typescript
type ToolCallEventPayload = {
  tool_name: string;
  args: Record<string, unknown>;
};

type ToolResultEventPayload = {
  tool_name: string;
  result_snippet: string;     // first 500 chars of output
  truncated: boolean;
  exit_code: number | null;
  duration_ms: number;
};

// Full PublicEvent envelope
{
  type: "agent_tool_call",
  producerService: "agent",
  taskId: "task_<id>",
  sandboxId: "sbox_<id>",
  correlationId: "call_<id>",
  payload: { tool_name: "read", args: { path: "/workspace/repo/src/index.ts" } }
}
```

### SandboxRuntime.simpleExec (addition to existing class)

File: `src/services/sandbox/runtime.ts`

The existing `run()` method streams output via `onOutput` callback. Agent tools
need a synchronous capture pattern. Add:

```typescript
async simpleExec(
  containerName: string,
  command: string,
  cwd: string,
  options?: {
    timeoutMs?: number;
    env?: Record<string, string>;
    signal?: AbortSignal;
  },
): Promise<{ stdout: string; stderr: string; exitCode: number | null; timedOut: boolean; truncated: boolean }>
```

Implementation: wraps `execFile`-style docker exec but captures both stdout and
stderr as strings. Reuses `COMMAND_OUTPUT_MAX_BYTES` for the truncation limit.

## 4. Tool Contracts

### Bash Command Allowlist

The bash tool checks every command against a hardcoded allowlist before
execution. The check operates on the first word of the command:

```typescript
const ALLOWED_COMMANDS = new Set([
  "cd",
  "ls",
  "cat",
  "head",
  "tail",
  "wc",
  "echo",
  "printf",
  "grep",
  "find",
  "sort",
  "uniq",
  "cut",
  "tr",
  "sed",
  "awk",
  "git",
  "node",
  "npm",
  "npx",
  "cp",
  "mv",
  "rm",
  "mkdir",
  "touch",
  "chmod",
  "chown",
  "tee",
  "diff",
  "cmp",
  "file",
  "stat",
  "du",
  "df",
  "env",
  "pwd",
  "which",
  "type",
  "sh",
  "bash",
  "true",
  "false",
  "exit",
  "sleep",
  "time",
  "date",
  "dirname",
  "basename",
  "realpath",
  "readlink",
  "xargs",
  "tar",
  "gzip",
  "gunzip",
  "unzip",
]);
```

**npm/npx restrictions:** `npm test`, `npx jest`, `npx vitest`, `npx playwright`,
`npx cypress` are blocked even though `npx` is in the allowlist. The tool parses
the full command and rejects known test invocations.

**Pipes and chaining:** the allowlist applies to the entire pipeline.
`cat file | grep foo` is allowed (both `cat` and `grep` in allowlist).
`npm test | grep FAIL` is blocked because `npm` with `test` arg is blocked.

**Builtins:** `cd`, `sh`, `bash`, pipes (`|`), redirects (`>`, `>>`, `<`),
variable assignment (`FOO=bar`) are recognized but not independently checked.
The first non-flag word that's an external command is what gets checked.

### Tool Response Size Limits

| Tool  | Max Response | Truncation Behaviour                          |
| ----- | ------------ | --------------------------------------------- |
| read  | 256 KB       | Truncate at byte boundary, set truncated=true |
| write | 1 KB         | Return "N bytes written"                      |
| edit  | 1 KB         | Return summary of changes                     |
| bash  | 50 KB        | Truncate last N bytes, set truncated=true     |
| grep  | 50 KB        | Truncate last N matches                       |
| find  | 50 KB        | Truncate last N paths                         |
| ls    | 50 KB        | Truncate last N entries                       |

### Path Validation

Every path argument must resolve under `/workspace/repo`. The existing
`isWorkspacePath` helper in `workspace.ts` handles this. Tools reject paths
outside this prefix with a clear error message.

## 5. Data Model

### New Agent Event Types

Add to the `EVENT_TYPES` array in `src/types/event.types.ts`:

```diff
+ "agent_tool_call",
+ "agent_tool_result",
```

### New Producer Service

Add to the `EVENT_PRODUCER_SERVICES` array:

```diff
+ "agent",
```

### Config additions (`src/config.ts`)

Add to the Zod schema:

```typescript
AGENT_MODEL: z.string().default("openrouter:deepseek/deepseek-v4-flash"),
AGENT_MAX_STEPS: z.coerce.number().int().min(1).max(100).default(25),
AGENT_BASH_TIMEOUT_MS: z.coerce.number().int().min(1000).default(120_000),
AGENT_BASH_OUTPUT_MAX_BYTES: z.coerce.number().int().min(1024).default(51_200),
AGENT_READ_MAX_BYTES: z.coerce.number().int().min(1024).default(262_144),
AGENT_TOOL_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30_000),
```

### Task result summary

The `TaskRunResult.summary` field is populated from the agent's final message.
In MVP this is `generateText`'s final `text`, trimmed. If the agent completes
entirely through tools, the summary is `null`; TaskService remains the owner of
the terminal `exitReason` and does not infer it from agent text.

## 6. Agent Loop Flow

```
TaskService.run() called
    |
    v
AgentRunner.run(context)
    |
    +-- Prepare system prompt (role + tool descriptions + workspace path)
    |
    +-- Resolve { containerName, runtime } for context.taskId + context.sandboxId
    |
    +-- Create AI SDK tools with runtime and container bound to this run
    |
    +-- Call generateText({
    |       model: resolvedLanguageModel,
    |       system: systemPrompt,
    |       messages: [{ role: "user", content: context.instructions }],
    |       tools: toolRegistry,
    |       stopWhen: isStepCount(config.AGENT_MAX_STEPS),
    |       abortSignal: context.signal,
    |       onToolExecutionStart: relay.onStart,
    |       onToolExecutionEnd: relay.onEnd,
    |   })
    |       |
    |       +-- Step 1: LLM calls tool X with args
    |       |       |
    |       |       +-- append + publish agent_tool_call(callId, input)
    |       |       +-- sandboxRuntime.simpleExec(container, ...)
    |       |       +-- append + publish agent_tool_result(callId, output)
    |       |       +-- result returned to AI SDK → appended to messages
    |       |
    |       +-- Step 2: LLM calls tool Y with args
    |       |       (repeat pattern)
    |       |
    |       +-- Step N: LLM produces text → loop ends (stopWhen or normal stop)
    |
    +-- Extract summary from final response text
    |
    +-- Return { summary }
```

### Cancellation

`context.signal` (AbortSignal from TaskRunContext) is passed as `abortSignal`
to `generateText`. When TaskService cancels a task:

1. TaskService calls `execution.controller.abort()`
2. `context.signal` fires
3. AI SDK's `generateText` receives the abort
4. In-progress tool execution is interrupted
5. `generateText` throws an `AbortError`
6. AgentRunner rethrows the `AbortError`
7. TaskService's existing cancellation path captures best-effort diff,
   persists `cancelled` + `task_result_ready`, and cleans up the sandbox

No separate kill path is needed in AgentRunner — cancellation flows through
the AbortSignal chain from TaskService → TaskRunContext → generateText →
tool execution.

## 7. Failure Paths

### Tool execution failure

If a tool call fails (Docker exec fails, command not found, file not found,
timeout):

- append `agent_tool_result` with a safe generic error snippet, `exit_code: null`,
  and the measured duration
- the AI SDK supplies the tool error to the model
- the LLM decides how to handle it (retry, alternative approach, report failure)
- if the LLM retries excessively, `stopWhen: isStepCount(...)` limits the total
  loop depth
- after the configured step count, the agent loop terminates with whatever partial work was
  done

### Agent loop failure (LLM API error)

If the Vercel AI SDK itself throws (network error, auth failure, rate limit):

- catch only to classify/log safely, then throw `ServiceError("agent_run_failed",
"Agent run failed", 502)` without the provider message
- TaskService's existing `runTask` catch persists `task_failed` and
  `task_result_ready` with `exit_reason: "failed"`
- do not return `{ summary: null }` for provider failure because TaskService
  would otherwise treat the run as successfully completed

### Timeout

No separate agent-level timeout in MVP. The task-level timeout and cancellation
cover it. Task cancellation propagates as described in §6.

### Abort during tool execution

When the signal fires mid-tool-execution:

- `sandboxRuntime.simpleExec` must check `signal.aborted` before starting
  the exec, and not start if already aborted
- `simpleExec` receives the same signal and kills the in-flight Docker child,
  then rejects with `AbortError`
- AgentRunner must not convert that error into a tool failure or provider
  failure; it rethrows so TaskService can complete cancellation

## 8. File Layout

```text
src/services/agent/
    agent-runner.ts         AgentRunner class (implements TaskRunner)
    tool-event-relay.ts     AI SDK callback -> EventStore event relay
    model.ts                AGENT_MODEL -> injected LanguageModel resolver

src/services/agent/tools/
    registry.ts             buildToolRegistry() — returns record of AI SDK tools
    read.ts                 read tool
    write.ts                write tool
    edit.ts                 edit tool
    bash.ts                 bash tool with allowlist
    grep.ts                 grep tool
    find.ts                 find tool
    ls.ts                   ls tool

src/services/sandbox/
    runtime.ts              simpleExec() seam already provided by Slice 1
    sandbox.ts              + task-owned getAgentToolTarget() seam

src/types/
    agent.types.ts          AgentEventPayload types (tool call/result payloads)
    event.types.ts          + "agent_tool_call", "agent_tool_result", "agent"

src/config.ts               + AGENT_MODEL, AGENT_MAX_STEPS, tool timeouts/limits

tests/
    agent-runner.test.ts    unit tests for AgentRunner
    agent-tool-relay.test.ts event relay payload/order/sanitization tests
    agent-tools.test.ts     unit tests for each tool (mock runtime)
    agent-events.test.ts    event type + schema tests
    sandbox-service.test.ts task ownership/readiness tests for agent target
```

## 9. Tests

### Unit tests (DB-independent, no Docker)

File: `tests/agent-runner.test.ts`

- AgentRunner constructs with config + model + task-owned sandbox target +
  mock EventStore/publish collaborators
- `run()` resolves the target using both task and sandbox IDs, builds exactly
  the seven-tool registry, and calls `generateText` with `system`, `messages`,
  `tools`, `abortSignal`, and `stopWhen: isStepCount(maxSteps)`
- `run()` returns the trimmed final text, or `null` when no final text exists
- an already-aborted signal does not resolve a sandbox target or call the model
- an in-flight abort propagates as `AbortError` and does not become a completed
  task result
- a provider/model error becomes the safe `agent_run_failed` ServiceError
- a model response that performs tool steps is allowed to continue until the
  configured stop condition

File: `tests/agent-tool-relay.test.ts`

- start appends a task-scoped `agent_tool_call` with `tool_name`, validated
  arguments, and the SDK `callId` as `correlationId`
- end appends a matching `agent_tool_result` after execution with bounded,
  UTF-8-safe output, duration, truncation, and exit code
- tool errors produce safe snippets and never expose the original error
- `publish` runs only after the corresponding `EventStore.append` resolves
- an append failure is surfaced to the runner rather than silently losing an
  event

File: `tests/agent-tools.test.ts`

For each tool:

- calls sandboxRuntime.simpleExec with correct arguments
- returns expected shape
- rejects paths outside /workspace/repo

Bash tool specifically:

- allows known commands
- blocks `npm test`, `npx jest`, `npx vitest`, etc.
- blocks unknown commands
- handles chained commands (pipe check applies to all participants)

File: `tests/agent-events.test.ts`

- event type schemas validate correct payloads
- event type schemas reject invalid payloads

### Integration/acceptance

The existing curl harness (`scripts/acceptance/task-service-atomic-mvp.sh`)
is extended to:

- create a task with instructions like "read the README and list the files"
- poll the task until completed
- verify agent_tool_call and agent_tool_result events appear in the stream
- verify the task diff captures the agent's changes

## 10. Acceptance Harness

The existing task-service harness in
`scripts/acceptance/task-service-atomic-mvp.sh` is extended with live agent
coverage:

```bash
# 1. Create a task that exercises the agent
curl -s -X POST "$BASE/tasks" \
  -H 'Content-Type: application/json' \
  -d '{
    "repoRef": "./repo",
    "instructions": "Read package.json and tell me the project name"
  }'

# 2. Poll task status until terminal
# 3. Fetch task events and verify agent_tool_call + agent_tool_result appear
# 4. Fetch task result and verify summary is not null
# 5. Fetch diff and verify no changes (read-only task)

# 6. Create a task with actual work
curl -s -X POST "$BASE/tasks" \
  -H 'Content-Type: application/json' \
  -d '{
    "repoRef": "./repo",
    "instructions": "Add a comment explaining the config module at the top of src/config.ts"
  }'

# 7. Poll, verify events, verify summary, verify diff is non-empty
```

## 11. Implementation Order

### Slice 1 — SandboxRuntime.simpleExec() + types + config (verifiable)

- Add `simpleExec()` to `SandboxRuntime`
- Add `AGENT_MODEL`, `AGENT_MAX_STEPS`, tool timeouts/limits to `config.ts`
- Add `agent` to `EVENT_PRODUCER_SERVICES` and agent event types to `EVENT_TYPES`
- Add `agent.types.ts` with payload schemas
- Verification: `npm run typecheck` passes, unit tests for simpleExec

### Slice 2 — Tool implementations (verifiable)

- Create all 7 tools in `src/services/agent/tools/`
- Create `registry.ts` to aggregate into AI SDK tool record
- Verification: unit tests pass for each tool with mock runtime,
  bash allowlist tests pass

### Slice 3 — AgentRunner (verifiable)

Goal: replace the placeholder runner in the in-process task lifecycle while
keeping TaskService's `TaskRunner` contract and terminal-state ownership
unchanged.

#### 3.1 Resolve the model and task-owned execution target

- Add `resolveAgentModel` (or an equivalent injected factory) that turns the
  configured `AGENT_MODEL` into an AI SDK 7 `LanguageModel`; do not pass the
  raw config string to `generateText` and do not read provider credentials from
  tool or sandbox modules.
- Add `SandboxService.getAgentToolTarget(taskId, sandboxId)` as the narrow
  internal seam for the existing `SandboxRuntime` and persisted container
  name. Query both IDs, require a ready sandbox, and return only the target
  needed by the tool registry.
- Add focused sandbox-service tests for cross-task lookup, non-ready sandboxes,
  and the ready target. Do not expose this seam as an HTTP route.

#### 3.2 Implement the runner against the AI SDK 7 contract

- Create `src/services/agent/agent-runner.ts` implementing `TaskRunner`.
- Inject `Config`, the task-owned target provider, `EventStore`, a resolved
  `LanguageModel`, and `publish`; keep the runner DB-independent except for
  the EventStore collaborator.
- Check `context.signal` before resolving the target or calling the model.
- Build the existing seven-tool registry with the target runtime, container
  name, config, and task signal.
- Call `generateText` with the system prompt, one user message containing
  `context.instructions`, the registry, `abortSignal: context.signal`, and
  `stopWhen: isStepCount(config.AGENT_MAX_STEPS)`.
- Return `{ summary: result.text.trim() || null }` on a normal model finish.
- Re-throw `AbortError`; convert non-abort provider/model failures into a safe
  `ServiceError("agent_run_failed", ...)` so TaskService persists `failed`
  rather than treating the run as completed.

#### 3.3 Relay tool lifecycle events

- Create `src/services/agent/tool-event-relay.ts` with AI SDK 7
  `onToolExecutionStart`/`onToolExecutionEnd` handlers.
- Append `agent_tool_call` before execution and `agent_tool_result` after
  execution through `EventStore.append`, always setting `taskId`, `sandboxId`,
  `producerService: "agent"`, `producerId: taskId`, and the SDK `callId` as
  `correlationId`.
- Convert `toolCall.input` to the existing snake_case payload schema, bound
  serialized result output to 500 UTF-8-safe characters, and replace tool
  errors with a stable safe snippet. Preserve `exit_code: null` for errors and
  use `toolExecutionMs` for `duration_ms`.
- Call `publish` only after each append resolves. If persistence fails, surface
  the failure to AgentRunner; never silently continue with an incomplete
  durable event stream.

#### 3.4 Wire the production runner without changing TaskService orchestration

- Construct the resolved model, AgentRunner, and TaskService together in the
  existing `src/services/task/task.ts` singleton composition path.
- Pass AgentRunner as the existing `TaskService` runner collaborator; do not
  add a coordinator, a second task state machine, or agent-specific task
  result fields.
- Leave TaskService responsible for `task_running`, diff capture, terminal
  task/result events, cancellation, and sandbox cleanup. AgentRunner only
  returns a summary or throws.
- Update `docs/modules/agent-service/README.md` from the Slice 2 boundary to
  document the runner, event relay, model resolver, cancellation behavior,
  and the new Sandbox Service seam. Update any affected task/sandbox/event
  service README contracts in the same implementation change.

#### 3.5 Verification and handoff

- Add DB-independent tests for runner options, model injection, summary
  extraction, step limit, target lookup, provider failure, and cancellation.
- Add relay tests for payload shape, correlation, UTF-8 bounds, safe errors,
  append-before-publish ordering, and append failure propagation.
- Run the narrow checks first:

  `npm test -- tests/agent-runner.test.ts tests/agent-tool-relay.test.ts tests/agent-events.test.ts tests/sandbox-service.test.ts`

  `npm run typecheck`

  `npm run lint`

- Keep real provider calls, Docker execution, and curl lifecycle verification
  for Slice 4. Slice 3 is complete only when the production composition path
  typechecks with the actual AI SDK 7 types and the existing full unit suite
  remains green.

### Slice 4 — Live acceptance harness (verifiable)

- Extend existing curl acceptance script with agent-specific tests
- Run full task lifecycle: create → provision → agent run → diff → cleanup
- Verify agent events appear in task event stream
- Verification:

  ```bash
  NODE_ENV=development BASE_URL=http://localhost:3000 \
    scripts/acceptance/task-service-atomic-mvp.sh
  ```

  The harness passes with a non-test API, real OpenRouter access, Docker, and
  Postgres.

## 12. Risks

| Risk                                                                  | Impact                                                                         | Mitigation                                                                                                                                                                        |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AI SDK cancellation does not stop an in-flight tool exec              | Cancelled task leaves a zombie docker exec                                     | Pass the same signal into `simpleExec`, test abort during a tool call in Slice 3, and require runtime child-process termination rather than relying only on model cancellation.   |
| 7 custom tools with Docker exec latency                               | Slow agent loop, especially read/edit on large files                           | Each exec is ~100ms overhead. Acceptable for MVP. If too slow, mount workspace volume for read/write paths.                                                                       |
| Bash allowlist is too restrictive                                     | Agent can't install deps or run build scripts                                  | `npm install` with restrictions, `npm run build` allowed. Review after first real use case.                                                                                       |
| LLM calls non-existent file paths                                     | Agent wastes steps on errors                                                   | Write a good system prompt that explains the workspace structure. The error feedback from tools is self-correcting.                                                               |
| Configured model string cannot be used as an AI SDK 7 `LanguageModel` | Runner fails before the first model call or uses an undocumented provider path | Keep model construction in an injected resolver, test it independently, make the provider/model format explicit in config, and avoid a raw `fetch()` fallback inside AgentRunner. |
