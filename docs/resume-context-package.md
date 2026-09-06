# Resume Context Package: Agent Sandboxing

## Brief for the resume-writing agent

Use this package to write concise, evidence-backed resume bullets for the
Agent Sandboxing project. Lead with the engineering problem and the resulting
capability; mention technologies only when they clarify the design. Prefer
current module documentation over historical planning documents, and use
implementation/tests to validate details.

Write 2–4 bullets, usually covering:

1. the session-first product and agent orchestration;
2. isolated execution and security boundaries;
3. durable event streaming, inspectable results, or GitHub PR delivery; and
4. evaluation/verification or observability if space permits.

Do not invent users, scale, throughput, success rates, cost savings, latency
improvements, or deployment status. The repository documents engineering
limits and verification surfaces, but not measured product impact.

## One-line project summary

Cloud coding-agent system that lets a user connect GitHub, select a repository
and branch, run bounded coding work in an isolated sandbox, inspect live
progress and diffs, and publish or update a pull request.

Primary sources: `/home/capybara/code/agent-sandboxing/README.md:3-7`,
`/home/capybara/code/agent-sandboxing/docs/agent-sandboxing-project.md:7-18`.

## Current product shape

The live architecture is session-first:

- one chat session owns one sandbox and one working branch;
- multiple user messages can be processed in the same workspace;
- there is no separate run resource;
- persisted backend state, diffs, artifacts, and pull-request metadata are the
  source of truth rather than model prose; and
- the frontend exposes repository selection, chat, processing state, ordered
  events, diffs, artifacts, and current pull-request state.

Primary sources: `/home/capybara/code/agent-sandboxing/docs/README.md:15-34`,
`/home/capybara/code/agent-sandboxing/docs/modules/chat-session/README.md:3-22`,
`/home/capybara/code/agent-sandboxing/docs/modules/frontend/README.md:3-11`.

## Resume-worthy contribution clusters

### 1. Session-first agent orchestration

What is implemented:

- `POST /chat-sessions/:sessionId/messages` queues a message and records its
  lifecycle transactionally.
- Processing acquires a per-session active-message lock, creates or reuses the
  session sandbox, prepares `agent/<sessionId>`, composes bounded context, runs
  the session agent once, captures the diff/artifacts, persists the assistant
  result, and releases the lock.
- Context contains the session summary, recent conversation, recent tool
  activity, workspace state, and current user request.
- Summary compaction keeps future context bounded.

Why it is high signal: this is a concrete stateful agent runtime boundary,
not merely a chat UI or a model API wrapper.

Evidence:

- `/home/capybara/code/agent-sandboxing/docs/modules/chat-session/README.md:24-40`
- `/home/capybara/code/agent-sandboxing/docs/modules/agent-service/README.md:5-9,23-28,59-83`
- `/home/capybara/code/agent-sandboxing/src/services/chat/session-agent-processor.ts:36-46,57-115`
- `/home/capybara/code/agent-sandboxing/src/services/agent/agent-runner.ts:101-153`

### 2. Control-plane / execution-plane isolation

What is implemented:

- Agent logic, prompts, provider keys, and control logic remain outside the
  Docker sandbox.
- The sandbox exposes only a session-owned `simpleExec` runtime seam to the
  agent; the agent never receives Docker, Prisma, or control-plane secrets.
- GitHub provisioning uses a short-lived installation token, then scrubs the
  remote to a token-free URL.
- Workspace paths are validated under `/workspace/repo`; command execution has
  time and output limits, UTF-8-safe truncation, cancellation, and bounded
  Docker execution.
- GitHub PR publication is brokered by the backend, which owns branch creation,
  commit, push, and PR creation/update rather than accepting tokens, remotes,
  or provider shell commands from the model.

Why it is high signal: it demonstrates security and reliability boundaries for
untrusted model-generated code execution.

Evidence:

- `/home/capybara/code/agent-sandboxing/docs/agent-sandboxing-project.md:28-63,121-145`
- `/home/capybara/code/agent-sandboxing/docs/modules/sandbox-service/README.md:23-41,57-72`
- `/home/capybara/code/agent-sandboxing/docs/modules/agent-service/README.md:42-57,92-105`
- `/home/capybara/code/agent-sandboxing/src/services/sandbox/runtime.ts:17-62,73-167`
- `/home/capybara/code/agent-sandboxing/src/services/sandbox/sandbox.ts:24-54,111-151,222-315`
- `/home/capybara/code/agent-sandboxing/src/services/agent/tools/publish-pull-request.ts:31-60`

### 3. Restricted nested investigation and tool governance

What is implemented:

- The main agent can invoke a nested `subagent` for repository investigation.
- The subagent profile is explicitly limited to `read`, `grep`, `find`, and
  `ls`; it cannot write, edit, run bash, or use PR tools.
- Subagent work remains internal to the parent turn, is cancellation-aware, and
  returns a bounded report capped at 20,000 characters.
- Main-agent tools are profile-driven and tool execution is serialized because
  all tools share one workspace.

Why it is high signal: it shows deliberate capability control and concurrency
semantics in an agent harness.

Evidence:

- `/home/capybara/code/agent-sandboxing/docs/modules/agent-service/README.md:16-20,42-70,72-83`
- `/home/capybara/code/agent-sandboxing/src/services/agent/tools/profiles/profiles.yaml:1-9`
- `/home/capybara/code/agent-sandboxing/src/services/agent/tools/subagent.ts:7-49`
- `/home/capybara/code/agent-sandboxing/src/services/agent/agent-runner.ts:67-99,155-220`
- `/home/capybara/code/agent-sandboxing/prompts/subagent.yaml:1-18`

### 4. Durable ordered events and reconnect-safe SSE

What is implemented:

- `EventStore` persists session-scoped append-only events in Postgres with
  strictly increasing sequences and transactionally couples state changes to
  lifecycle events.
- `SseHub` publishes only committed events.
- The SSE endpoint supports numeric cursors and `Last-Event-ID` replay.
- Replay subscribes before querying durable events, buffers concurrent live
  events, sorts them, and drops duplicates, closing the replay/live race.
- Clients can reconnect after a process restart and replay from Postgres.

Why it is high signal: this is a correctness-focused event-delivery design,
not just a streaming response.

Evidence:

- `/home/capybara/code/agent-sandboxing/docs/modules/event-service/README.md:5-11,19-43,74-89`
- `/home/capybara/code/agent-sandboxing/src/services/events/event-store.ts:73-151`
- `/home/capybara/code/agent-sandboxing/src/services/events/sse-hub.ts:13-73`
- `/home/capybara/code/agent-sandboxing/tests/event-store.test.ts`
- `/home/capybara/code/agent-sandboxing/tests/sse-hub.test.ts`
- `/home/capybara/code/agent-sandboxing/tests/agent-events.test.ts`

### 5. GitHub branch and pull-request lifecycle

What is implemented:

- GitHub sessions use deterministic branch `agent/<sessionId>` across messages.
- Provisioning checks out the selected base branch and verifies the selected
  base SHA when present; branch drift fails safely.
- Dirty workspaces on the wrong branch are rejected instead of reset.
- `publish_pull_request` refuses an empty workspace, verifies the remote and
  session branch, commits and pushes through backend GitHub capabilities, and
  creates the first PR or updates the session’s current PR on later publishes.
- Pull-request failures are represented as safe metadata/events without
  erasing the completed workspace diff.

Why it is high signal: it connects agent-generated edits to a controlled,
repeatable code-review workflow.

Evidence:

- `/home/capybara/code/agent-sandboxing/docs/modules/sandbox-service/README.md:31-35,57-62`
- `/home/capybara/code/agent-sandboxing/docs/modules/chat-session/README.md:85-99`
- `/home/capybara/code/agent-sandboxing/src/services/sandbox/sandbox.ts:222-315`
- `/home/capybara/code/agent-sandboxing/src/services/chat/message-processing.ts:343-383,537-647`
- `/home/capybara/code/agent-sandboxing/src/services/agent/tools/publish-pull-request.ts:40-60`

### 6. Inspectable artifacts and redacted observability

What is implemented:

- Diffs and oversized tool output are stored as bounded, redacted artifacts
  outside normal chat context.
- Tool lifecycle events persist a call before execution and a bounded result
  after execution; failure events use safe error markers.
- The trace recorder captures context, run timing, model usage, tool calls,
  nested subagents, outcomes, and safe errors.
- Langfuse export mirrors the trace hierarchy and masks string data without
  affecting message success.

Why it is high signal: it gives operators an inspectable execution record while
maintaining data-boundary and failure-isolation guarantees.

Evidence:

- `/home/capybara/code/agent-sandboxing/docs/modules/agent-service/README.md:29-35,92-105,120-129`
- `/home/capybara/code/agent-sandboxing/docs/modules/chat-session/README.md:69-72,120-133`
- `/home/capybara/code/agent-sandboxing/src/services/tracing/trace-recorder.ts:19-28,116-178,214-220,462-539`
- `/home/capybara/code/agent-sandboxing/src/services/tracing/langfuse-trace-sink.ts:64-141,143-165,167-243`
- `/home/capybara/code/agent-sandboxing/src/services/agent/tool-event-relay.ts`

### 7. Frontend product surface

Use this as a supporting angle when a full-stack bullet is useful:

- Standalone Vite/React/TypeScript SPA for GitHub login, repository/branch
  selection, repo-scoped chat, processing timeline, diff/artifact inspection,
  and current PR state.
- The browser stores no authentication tokens and owns no backend state.
- Repository loading uses cursor pagination, request reuse, explicit refresh,
  short-lived backend caches, and avoids retaining settled responses across
  authenticated users.
- The client consumes the single session SSE stream and deduplicates sequence
  numbers.

Evidence:

- `/home/capybara/code/agent-sandboxing/docs/modules/frontend/README.md:3-11,13-36,38-57`
- `/home/capybara/code/agent-sandboxing/frontend/README.md:1-73`

## Quantitative and bounded facts

These are safe engineering-level specifics, not product-impact metrics:

- one sandbox and one working branch per session;
- one active message processed per session at a time;
- one `AgentRunner` invocation per user message;
- five composed context sections: summary, recent conversation, recent tool
  activity, workspace state, and user request;
- four tools in the restricted subagent profile: `read`, `grep`, `find`, `ls`;
- subagent report cap: 20,000 characters;
- tool-event result snippet cap: 500 bytes;
- repository discovery page size: 20 repositories with cursor pagination;
- event sequences are positive and strictly increasing per session; and
- the current agent evaluation index contains five data-only cases: read-only
  investigation, minimal localized edit, no-op when satisfied, destructive
  request, and subagent investigation.

Sources:

- `/home/capybara/code/agent-sandboxing/docs/modules/chat-session/README.md:19-40`
- `/home/capybara/code/agent-sandboxing/docs/modules/agent-service/README.md:42-66,92-100`
- `/home/capybara/code/agent-sandboxing/docs/modules/frontend/README.md:15-18,43-50`
- `/home/capybara/code/agent-sandboxing/docs/modules/event-service/README.md:19-29`
- `/home/capybara/code/agent-sandboxing/src/services/chat/session-agent-processor.ts:36-46`
- `/home/capybara/code/agent-sandboxing/src/services/agent/tools/profiles/profiles.yaml:1-9`
- `/home/capybara/code/agent-sandboxing/src/services/agent/tools/subagent.ts:7-8`
- `/home/capybara/code/agent-sandboxing/src/services/agent/tool-event-relay.ts`
- `/home/capybara/code/agent-sandboxing/tests/evals/cases/index.ts:1-14`

## Verification and quality evidence

The repository defines and implements checks for:

- session-agent context composition and single-run behavior;
- message processing, cancellation, terminal result persistence, and artifacts;
- sandbox lifecycle, provisioning, path safety, command limits, and runtime
  cancellation;
- event persistence, ordering, transactional publication, and SSE replay;
- GitHub repository/branch access, API timing instrumentation, branch safety,
  and pull-request behavior;
- five model-backed agent evaluation cases using a bounded in-memory runtime;
- TypeScript typechecking, ESLint, the full Vitest suite, and production build.

Primary sources:

- `/home/capybara/code/agent-sandboxing/docs/modules/chat-session/README.md:101-145`
- `/home/capybara/code/agent-sandboxing/docs/modules/sandbox-service/README.md:74-82`
- `/home/capybara/code/agent-sandboxing/docs/modules/event-service/README.md:91-95`
- `/home/capybara/code/agent-sandboxing/docs/modules/agent-service/README.md:107-129`
- `/home/capybara/code/agent-sandboxing/tests/evals/harness/run-agent-eval.ts:34-109`
- `/home/capybara/code/agent-sandboxing/package.json` (`test`, `typecheck`,
  `lint`, `build`, and `eval:agent` scripts)

Important qualification: the agent eval harness runs the configured real model
against an in-memory fake runtime and intentionally excludes the real sandbox,
GitHub service, Prisma, and HTTP routes. The README commands define the
verification surface; they do not record pass/fail results. Do not write
“all tests pass” unless a fresh run is performed and reported separately.

## Shipped, planned, and retired claims

### Safe to describe as current

- session-first chat/message processing;
- session-owned Docker sandbox and GitHub branch;
- profile-driven agent tools and read-only nested subagent;
- Postgres-backed ordered event store and replay-safe SSE;
- diff/artifact capture and safe tool/trace observability;
- GitHub repository/branch selection and backend-brokered PR publishing;
- React/Vite frontend using the documented session API.

### Phrase cautiously

The ten-step GitHub-to-PR product loop in
`/home/capybara/code/agent-sandboxing/docs/agent-sandboxing-project.md:7-18`
is product direction. Use current module READMEs and implementation anchors to
support individual steps. “Docker for MVP” is an architecture choice, not
evidence of production scale.

### Do not describe as current

- the standalone `/tasks` API or task execution service;
- a separate run resource;
- memory, multi-repo tasks, browser preview, LSP, deployment automation,
  parallel terminal sessions, or parallel subagents;
- measured latency, adoption, cost, throughput, or reliability outcomes not
  present in the repository evidence.

The task runtime is explicitly retired at
`/home/capybara/code/agent-sandboxing/docs/modules/task-service/README.md:3-12`.
The exclusions are listed at
`/home/capybara/code/agent-sandboxing/docs/agent-sandboxing-project.md:147-158`.

## Suggested bullet angles for the downstream writer

Use these as directions, then write the final bullets in the requested resume
style:

- Built a session-first cloud coding-agent runtime that reuses one isolated
  repository workspace and deterministic branch across user messages, with
  bounded context, serialized tools, diff capture, cancellation, and persisted
  terminal results.
- Designed a control-plane/execution-plane boundary for untrusted agent code:
  Docker-backed session sandboxes expose only a narrow execution seam, use
  short-lived GitHub credentials, enforce path/time/output limits, and broker
  all PR mutations through backend capabilities.
- Implemented a Postgres-backed ordered event log and replay-safe SSE hub that
  couples lifecycle events to state transactions and closes the reconnect/live
  delivery race with cursor replay and buffering.
- Added profile-governed read-only subagents, bounded/redacted artifacts and
  traces, and model-backed evaluations covering minimal edits, no-op behavior,
  destructive requests, read-only investigation, and capability-limited
  subagent investigation.

The downstream writer should select only the angles that match the target role
and avoid turning the directions above into unsupported impact claims.
