> Created: 2026-08-15
> Status: Valid / active planning document
> Valid for: Agent Service Atomic MVP only
> Invalid when: agent-service implementation is completed and the project moves to agent
>   memory, multi-agent coordination, or external tool providers; or this plan is
>   superseded by a newer planning document
> Scope reminder: in-process TaskRunner replacement using the Vercel AI SDK (`ai`
>   package) for the agent loop; 7 custom tools proxied through Docker exec;
>   no PI SDK, no memory, no multi-agent, no GitHub PR creation, no frontend

# Agent Service Atomic MVP Implementation Plan

## 1. Product Boundary And Non-Goals

### Goal

Build the Agent Service — the component that replaces `PlaceholderTaskRunner` with a
real LLM-driven coding agent inside the task lifecycle.

The Agent Service proves that the platform can:

- drive a Vercel AI SDK `generateText` agent loop from inside a `TaskRunner`
- define 7 sandbox-proxied tools (read, write, edit, bash, grep, find, ls) that
  operate inside the Docker container through `SandboxRuntime.exec`
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
- `maxSteps` for loop depth (default 25)
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

`PlaceholderTaskRunner` is replaced at the TaskService constructor call site
in `server.ts` or `task.ts`'s singleton construction:

```typescript
// Before
this.runner = new PlaceholderTaskRunner();

// After
import { AgentRunner } from "../agent/agent-runner";
this.runner = new AgentRunner(config, sandboxService, events, publish);
```

The `TaskRunner` interface itself (`TaskRunContext`, `TaskRunResult`) does not
change. The existing event appending in TaskService (`emitEvent`) remains the
caller; AgentRunner feeds its tool events back via a callback so TaskService
owns the append.

## 2. Architecture Diagram

```text
TaskService
    |
    +-- TaskRunner interface
    |       run(context: TaskRunContext): Promise<TaskRunResult>
    |
    +-- AgentRunner (replaces PlaceholderTaskRunner)
    |       |
    |       +-- Vercel AI SDK generateText ({ model, tools, maxSteps })
    |       |       |
    |       |       +-- tool("read")   -> sandboxRuntime.exec("cat <path>")
    |       |       +-- tool("write")  -> sandboxRuntime.exec("cat > <path>")
    |       |       +-- tool("edit")   -> sandboxRuntime.exec(edit pipeline)
    |       |       +-- tool("bash")   -> sandboxRuntime.exec(command)   [allowlisted]
    |       |       +-- tool("grep")   -> sandboxRuntime.exec("grep -n <pattern>")
    |       |       +-- tool("find")   -> sandboxRuntime.exec("find <path> <test>")
    |       |       +-- tool("ls")     -> sandboxRuntime.exec("ls -la <path>")
    |       |
    |       +-- ToolEventRelay
    |               captures tool calls + results
    |               calls publish callback with agent_tool_call / agent_tool_result
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
- call `generateText({ model, tools, systemPrompt, maxSteps })`
- wrap `generateText` with AbortSignal (the same signal from TaskRunContext)
- on completion: extract summary from the final assistant message
- relay tool call + result events via a publish callback
- handle errors as task failures, cancellation as exit

Constraints:

- never import `SandboxRuntime` or `SandboxService` directly — accept them
  as constructor-injected collaborators (same pattern as TaskService)
- the publish callback signature matches `(event: PublicEvent) => void` —

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
    parameters: z.object({
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
- call the publish callback to append `agent_tool_call` and `agent_tool_result`
  events to the task event stream through TaskService
- include a `correlationId` linking the call to its result

Shape:

```typescript
type ToolCallEventPayload = {
  toolName: string;
  args: Record<string, unknown>;
};

type ToolResultEventPayload = {
  toolName: string;
  resultSnippet: string;     // first 500 chars of output
  truncated: boolean;
  exitCode: number | null;
  durationMs: number;
};

// Full PublicEvent envelope
{
  type: "agent_tool_call",
  producerService: "agent",
  payload: { toolName: "read", args: { path: "/workspace/repo/src/index.ts" } }
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
  options?: { timeoutMs?: number; env?: Record<string, string> },
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
  "cd", "ls", "cat", "head", "tail", "wc", "echo", "printf",
  "grep", "find", "sort", "uniq", "cut", "tr", "sed", "awk",
  "git", "node", "npm", "npx", "cp", "mv", "rm", "mkdir",
  "touch", "chmod", "chown", "tee", "diff", "cmp",
  "file", "stat", "du", "df", "env", "pwd", "which", "type",
  "sh", "bash", "true", "false", "exit", "sleep", "time",
  "date", "dirname", "basename", "realpath", "readlink",
  "xargs", "tar", "gzip", "gunzip", "unzip",
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

| Tool     | Max Response | Truncation Behaviour           |
|----------|-------------|-------------------------------|
| read     | 256 KB      | Truncate at byte boundary, set truncated=true |
| write    | 1 KB        | Return "N bytes written"       |
| edit     | 1 KB        | Return summary of changes      |
| bash     | 50 KB       | Truncate last N bytes, set truncated=true |
| grep     | 50 KB       | Truncate last N matches        |
| find     | 50 KB       | Truncate last N paths          |
| ls       | 50 KB       | Truncate last N entries        |

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
In MVP the summary is the last assistant text block (before the final tool calls).
If the agent has no text output (completed entirely through tools), the summary
is the exit reason string.

## 6. Agent Loop Flow

```
TaskService.run() called
    |
    v
AgentRunner.run(context)
    |
    +-- Prepare system prompt (role + tool descriptions + workspace path)
    |
    +-- Create AI SDK tools with runtime bound to context.sandboxId
    |
    +-- Call generateText({
    |       model: config.AGENT_MODEL,
    |       system: systemPrompt,
    |       messages: [{ role: "user", content: context.instructions }],
    |       tools: toolRegistry,
    |       maxSteps: config.AGENT_MAX_STEPS,
    |       abortSignal: context.signal,
    |   })
    |       |
    |       +-- Step 1: LLM calls tool X with args
    |       |       |
    |       |       +-- emitEvent("agent_tool_call", { toolName, args })
    |       |       +-- sandboxRuntime.simpleExec(container, ...)
    |       |       +-- emitEvent("agent_tool_result", { toolName, result, ... })
    |       |       +-- result returned to AI SDK → appended to messages
    |       |
    |       +-- Step 2: LLM calls tool Y with args
    |       |       (repeat pattern)
    |       |
    |       +-- Step N: LLM produces text → loop ends (maxSteps or toolChoice stop)
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
6. AgentRunner catches it and returns a cancellation exit
7. TaskService sees the hangup and proceeds with cleanup

No separate kill path is needed in AgentRunner — cancellation flows through
the AbortSignal chain from TaskService → TaskRunContext → generateText →
tool execution.

## 7. Failure Paths

### Tool execution failure

If a tool call fails (Docker exec fails, command not found, file not found,
timeout):
- emit `agent_tool_result` with the error information in the payload
- the tool returns the error string to the LLM
- the LLM decides how to handle it (retry, alternative approach, report failure)
- if the LLM retries excessively, `maxSteps` limits the total loop depth
- after `maxSteps`, the agent loop terminates with whatever partial work was
  done

### Agent loop failure (LLM API error)

If the Vercel AI SDK itself throws (network error, auth failure, rate limit):
- catch the error in AgentRunner
- emit a `task_failed` event (relayed through TaskService's existing path)
- return `{ summary: null }` with exit reason
- TaskService marks the task as `failed` with the error code

### Timeout

No separate agent-level timeout in MVP. The task-level timeout and cancellation
cover it. Task cancellation propagates as described in §6.

### Abort during tool execution

When the signal fires mid-tool-execution:
- `sandboxRuntime.simpleExec` must check `signal.aborted` before starting
  the exec, and not start if already aborted
- If the exec is in-flight, killing the child process on abort is handled
  naturally by `generateText`'s abort signal propagating through the tool
  execution (the AI SDK calls `signal.throwIfAborted()` at the start of
  each tool call, and the wrapper checks before dispatching)

## 8. File Layout

```text
src/services/agent/
    agent-runner.ts         AgentRunner class (implements TaskRunner)
    tool-event-relay.ts     ToolEventRelay helper (or inline in runner)

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
    runtime.ts              + simpleExec() method

src/types/
    agent.types.ts          AgentEventPayload types (tool call/result payloads)
    event.types.ts          + "agent_tool_call", "agent_tool_result", "agent"

src/config.ts               + AGENT_MODEL, AGENT_MAX_STEPS, tool timeouts/limits

tests/
    agent-runner.test.ts    unit tests for AgentRunner
    agent-tools.test.ts     unit tests for each tool (mock runtime)
    agent-events.test.ts    event type + schema tests
```

## 9. Tests

### Unit tests (DB-independent, no Docker)

File: `tests/agent-runner.test.ts`

- AgentRunner constructs with config + mock runtime + mock publish
- AgentRunner.run() calls generateText with correct model/system/messages
- AgentRunner.run() returns summary from final text
- AgentRunner.run() aborts cleanly when signal fires before LLM call
- AgentRunner.run() aborts cleanly when signal fires during tool execution
- AgentRunner.run() handles generateText API error → returns null summary
- AgentRunner.run() respects maxSteps

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

Extended curl scripts in `scripts/acceptance/agent-service-mvp.sh`:

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

- Create `agent-runner.ts` implementing `TaskRunner`
- Create `tool-event-relay.ts`
- Wire into TaskService (replace PlaceholderTaskRunner at call site)
- Verification: unit tests pass, `npm run typecheck` passes

### Slice 4 — Acceptance harness (verifiable)

- Extend existing curl acceptance script with agent-specific tests
- Run full task lifecycle: create → provision → agent run → diff → cleanup
- Verify agent events appear in task event stream
- Verification: `scripts/acceptance/agent-service-mvp.sh` passes with
  real Docker + Postgres

## 12. Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Vercel AI SDK `generateText` with `abortSignal` doesn't abort in-flight tool exec | Cancelled task leaves a zombie docker exec | Test cancellation path in slice 3. If AI SDK doesn't propagate, add explicit signal check before each tool dispatch. |
| 7 custom tools with Docker exec latency | Slow agent loop, especially read/edit on large files | Each exec is ~100ms overhead. Acceptable for MVP. If too slow, mount workspace volume for read/write paths. |
| Bash allowlist is too restrictive | Agent can't install deps or run build scripts | `npm install` with restrictions, `npm run build` allowed. Review after first real use case. |
| LLM calls non-existent file paths | Agent wastes steps on errors | Write a good system prompt that explains the workspace structure. The error feedback from tools is self-correcting. |
| `@ai-sdk/openai` adapter compatibility with OpenRouter | Streaming/tool calling may have provider-specific quirks | Test with OpenRouter's `/v1/chat/completions` early in slice 3. AI SDK is provider-agnostic; if OpenRouter compatibility is an issue, raw `fetch()` fallback. |