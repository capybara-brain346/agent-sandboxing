# Master Plan: Repo-Scoped Chat Session Agent Harness

## Goal

Replace the current one-shot task model with a repo-scoped chat workspace.

The new product primitive is:

- `ChatSession`: durable user-facing repo thread, conversation owner, and owner of one attached sandbox workspace.
- `TaskRun`: one agent execution turn triggered by a user message inside that session.
- `Orchestrator`: controls context, planning, user interaction, worker delegation, and future PR tool use. It never edits code.
- `CodeWorker`: receives a focused brief from the orchestrator and performs code inspection, edits, commands, and verification in the session sandbox.

GitHub auth, cloning, and PR creation are intentionally not part of this implementation. The design must leave clean seams for them.

## Non-negotiable decisions

1. The product becomes session-first, not task-first.
2. One chat session maps to one repo/workspace/sandbox.
3. One task run maps to one execution turn.
4. The sandbox is session-owned and reused across runs.
5. Only one active mutating run is allowed per session initially.
6. Raw command logs, tool outputs, and Docker output are not chat history and must not become default model context.
7. The orchestrator never edits code.
8. The CodeWorker never receives full session history.
9. Existing `Task` should be treated as future `TaskRun`, not repurposed as `ChatSession`.
10. Old `/tasks` behavior should not live forever. Keep only as a short compatibility bridge if implementation needs it.

## Target architecture

```text
Frontend Chat Workspace
  -> ChatSession API
    -> ChatSessionService
      -> RunOrchestrator
        -> ContextBuilder
        -> CodeWorkerRunner
          -> SandboxService / AgentRunner / command tools
        -> SessionSummaryService
        -> future scoped GitHub PR tool
      -> EventStore / SseHub
```

Ownership:

```text
ChatSession
  owns repo scope
  owns messages
  owns durable summary
  owns current sandbox/workspace
  owns session event stream
  owns activeRunId lock

TaskRun
  belongs to ChatSession
  owns one execution lifecycle
  owns result, diff snapshot, failure, verification metadata
  owns run event stream

Sandbox
  belongs to ChatSession
  can be used by many TaskRuns
  is not stopped after every run

Artifacts
  belong to session/run
  store raw logs, command output, diffs, tool outputs
  are fetched on demand, not injected by default
```

## Context model

### Orchestrator receives

- Small system contract.
- Session metadata: repo, sandbox, active run state.
- Durable session summary.
- Recent chat messages only.
- Current user message verbatim.
- Compact workspace snapshot: git status, changed file list, latest run/check status.
- High-level tools: start worker, inspect artifacts, open PR later, ask/respond.

### Orchestrator does not receive by default

- Full session transcript.
- Full event history.
- Full command logs.
- Full Docker output.
- Full diffs unless requested.
- Raw tool traces.

### Session summary contains

A bounded rewritten working-state document, not append-only history.

Include:

- Project identity.
- Current objective.
- Durable architecture/product decisions.
- Active implementation state.
- Files/areas known to be touched.
- Open blockers/questions.
- Current PR/diff/check status later.

Exclude:

- Message-by-message summaries.
- Long logs.
- Raw diffs.
- Old failed attempts unless still relevant.
- Full tool outputs.

Budget: start around 1-2 KB, hard cap around 4 KB. Rewrite after runs; do not append forever.

### CodeWorker receives

- Coding system rules.
- Repo/workspace facts.
- Specific task brief authored by orchestrator.
- Relevant session decisions only.
- Target files/areas if known.
- Current workspace status.
- Verification contract.
- Structured output schema.

CodeWorker does not receive:

- Full chat history.
- GitHub credentials.
- PR permissions by default.
- Unrelated old logs.
- Every prior run result.

Expected worker result:

```json
{
  "status": "completed | blocked | failed",
  "summary": "short human summary",
  "changedFiles": ["path"],
  "testsRun": [
    {
      "command": "npm test -- tests/x.test.ts",
      "status": "passed | failed",
      "outputSummary": "..."
    }
  ],
  "blockers": [],
  "suggestedNextStep": "..."
}
```

## Phase-wise implementation

### Phase 0: Kill ambiguity before code

Output: implementation decision record.

Decide and document:

- Public route prefix: prefer `/chat-sessions`.
- Internal name: `TaskRun` for execution attempts.
- Session sandbox provisioning: prefer first run, not empty session creation, unless frontend needs draft sessions.
- Concurrency: reject second active run with `409 session_run_in_progress` for MVP.
- Compatibility: old `/tasks` only as temporary adapter, not parallel product surface.
- Event model: session stream for chat milestones, run stream for detailed harness events.
- Artifact storage MVP: DB text/blob pointer vs filesystem. Prefer DB/text for short MVP if existing output storage is DB-centric; move later if large.

Acceptance:

- One architecture note exists in docs/planning or `.hermes/plans`.
- Product and code terms are consistent: Session, Message, Run, Artifact.

### Phase 1: Data model foundation

Goal: add the database primitives without changing the whole runner yet.

Add/modify:

- `ChatSession`
- `ChatMessage`
- `TaskRun` or transitional `Task` with `sessionId`
- session-owned `Sandbox`
- `Artifact` or minimal `RunArtifact`
- `Event` fields for `sessionId`, `runId`, `messageId`, `artifactId`, `streamScope`, `streamId`, `domain`

Recommended model choices:

- Add `ChatSession.activeRunId`, `lockedAt`, `lockVersion`.
- Move `Sandbox.taskId` ownership to `Sandbox.sessionId`.
- Keep legacy task id compatibility only if tests/frontend need it.
- Add indexes for session messages, session runs, event stream sequence.

Acceptance:

- Prisma schema represents session-owned workspace and run-owned execution.
- Migration is generated with project Prisma command.
- Existing DB-independent tests are adjusted or still pass.

Verification:

- `npm run prisma:generate`
- targeted schema/service tests once added

### Phase 2: Event service v2

Goal: make events session/run-aware before the new harness depends on them.

Implement:

- Scoped stream key: `{ streamScope: "session" | "run", streamId }`.
- Session event append with `ChatSession.nextEventSequence`.
- Run event append with `TaskRun.nextEventSequence`.
- Compatibility wrappers for old task event append if kept.
- `SseHub` keyed by scope/id instead of task id.
- Publish only after transaction commit.
- Small event payloads with artifact pointers for large outputs.

Session events:

- `session_created`
- `message_created`
- `run_requested`
- `run_created`
- `run_completed`
- `run_failed`
- `run_cancelled`
- `run_result_ready`

Run events:

- sandbox lifecycle
- command lifecycle
- agent tool lifecycle
- artifact pointer events
- diff/check/result details

Acceptance:

- Session stream can replay chat/milestone events.
- Run stream can replay detailed harness events.
- Event ordering is monotonic per stream.
- Raw logs are not stored in session messages.

Verification:

- event store tests
- SSE hub tests
- rollback test proving no publish after failed transaction

### Phase 3: Chat/session API

Goal: introduce the public product API.

Endpoints:

```text
POST   /chat-sessions
GET    /chat-sessions
GET    /chat-sessions/:sessionId
PATCH  /chat-sessions/:sessionId
GET    /chat-sessions/:sessionId/messages
POST   /chat-sessions/:sessionId/messages
GET    /chat-sessions/:sessionId/runs
GET    /chat-sessions/:sessionId/runs/:runId
GET    /chat-sessions/:sessionId/runs/:runId/result
DELETE /chat-sessions/:sessionId/runs/:runId
GET    /chat-sessions/:sessionId/events
GET    /chat-sessions/:sessionId/runs/:runId/events
```

Rules:

- `POST /chat-sessions` creates repo-scoped session metadata.
- `POST /chat-sessions/:id/messages` persists a user message and starts one run by default.
- If active run exists, return `409 session_run_in_progress`.
- Messages API returns chat messages only, not run logs.
- Run result returns diff, summary, failure, and artifact pointers.
- GitHub-shaped repo fields can exist but `github` execution returns `501` until implemented.

Acceptance:

- Frontend can create/load session, send message, subscribe to events, inspect run, cancel run.
- API validates unknown fields strictly.
- Errors use existing error envelope.

Verification:

- new chat route tests
- old task route tests if compatibility remains
- API integration tests for active-run conflict, cancel, result-not-terminal, SSE replay

### Phase 4: Session-owned sandbox and run-owned execution

Goal: move lifecycle ownership from task-owned sandbox to session-owned workspace.

Implement:

- `ChatSessionService.createSession`
- `RunService.createRunForMessage`
- `RunService.claimSessionLock`
- `RunService.releaseSessionLock`
- `SandboxService.createForSessionInTransaction`
- `SandboxService.ensureReadyForSession`
- `SandboxService.getAgentToolTarget(sessionId, runId, sandboxId)`
- runner context includes `sessionId`, `runId`, `messageId`, `sandboxId`

Lifecycle:

```text
message_created
run_created
claim session lock
ensure sandbox ready
run worker/agent
capture diff/result
create assistant message
mark run terminal
release lock
keep sandbox alive
```

Cancellation:

- Cancel active run only.
- Abort in-flight tool/command if possible.
- Best-effort diff capture if useful.
- Release lock.
- Keep sandbox unless corrupt/unusable.

Acceptance:

- First run creates/provisions session sandbox.
- Later run reuses same sandbox.
- Completed run does not stop sandbox.
- Concurrent run is rejected.
- Cancelled run releases lock.
- Wrong session/run cannot access sandbox tool target.

Verification:

- task/run service tests
- sandbox service tests
- cancellation tests
- command execution tests

### Phase 5: Harness implementation

Goal: replace one-shot instruction execution with orchestrator-worker harness.

Components:

- `SessionContextBuilder`
- `SessionSummaryService`
- `RunOrchestrator`
- `CodeWorkerRunner`
- `WorkerResultSchema`
- `ArtifactSelector` or artifact retrieval helpers

Orchestrator loop:

```text
load session metadata
load bounded summary
load recent chat messages
load current workspace snapshot
classify current user message
if clarification needed: write assistant message, no run or terminal no-op run
if code needed: create/continue TaskRun, build worker brief, invoke CodeWorker
review worker result and workspace diff/checks
if more work needed: invoke worker again with narrow correction, bounded attempts
write assistant message
update session summary
later: call scoped PR tool when appropriate
```

Worker loop:

```text
receive focused brief
inspect relevant files/docs
edit code
run narrow checks
fix obvious failures within attempt budget
return structured result
```

Anti-bloat rules:

- Orchestrator sees recent chat + summary.
- Worker sees brief, not chat history.
- Raw logs live in artifacts.
- Prompt builder explicitly selects context; it never replays event history blindly.
- Session summary is rewritten under budget after each run.

Acceptance:

- User message causes a run with a worker brief, not raw one-shot instructions only.
- Assistant response is persisted as chat message.
- Session summary updates without growing unbounded.
- Worker output is schema-validated.
- Failed worker result becomes visible and actionable, not swallowed.

Verification:

- harness unit tests with fake worker
- context builder budget tests
- summary rewrite tests
- worker-result schema tests
- integration test: message -> run -> worker -> assistant message -> summary update

### Phase 6: Artifact handling

Goal: separate operational output from prompt/chat context.

Implement:

- `ArtifactStore`
- artifact rows for command output, tool output, diffs, test output, worker reports
- event payloads carry artifact id, preview, byte size, redaction status
- APIs to fetch artifacts as needed

Rules:

- Session messages are prompt candidates.
- Artifacts are not prompt context unless selected by context builder.
- Previews are bounded.
- Secrets/log redaction must be considered before UI display and model reuse.

Acceptance:

- Large command output is not embedded in event payload or message content.
- UI can fetch full logs/diffs on demand.
- Context builder can select only relevant artifact excerpts.

Verification:

- artifact store tests
- large-output event payload tests
- prompt builder tests proving artifacts are not included by default

### Phase 7: Frontend migration

Goal: replace task form/detail UX with repo-scoped chat workspace.

Frontend phases:

1. Domain seams
   - add repo/chat/run/event/artifact frontend types
   - hide backend task terms behind adapters if backend transition is not complete

2. Repo selection page
   - `/` becomes repo selection
   - GitHub connect placeholder
   - local/demo repo selection

3. Chat workspace page
   - `/repos/:repoKey/chat` or session route equivalent
   - chat thread
   - composer
   - inspector panel

4. Message send
   - calls session message API once backend exists
   - one active run at a time
   - user bubble appears immediately

5. SSE and run timeline
   - generic `useEventStream`
   - session stream for chat/milestones
   - run stream for detailed logs/timeline
   - reconnect with cursor

6. Results/artifacts
   - assistant message from run result
   - changed files panel
   - logs panel
   - diff view
   - PR placeholder

7. Old task UI cleanup
   - remove primary `NewTaskPage`
   - remove or wrap `TaskDetailPage`
   - no visible product copy says “task” unless legacy route

Acceptance:

- User lands on repo selection, not task form.
- User opens a repo chat workspace.
- User sends message and sees active run status.
- Timeline/logs update live.
- Terminal result becomes assistant response.
- Changed files/diff are visible.
- PR panel is honest placeholder.

Verification:

- frontend typecheck/lint/build
- manual QA for landing, chat, send, SSE, terminal states, cancel, narrow viewport

### Phase 8: Compatibility removal and docs

Goal: finish the conceptual migration and prevent two product systems from surviving.

Do:

- Remove old `/tasks` routes or mark as tested deprecated adapters with a clear removal point.
- Remove old frontend task form/detail primary routes.
- Update docs:
  - task/run service README
  - event service README
  - frontend README
  - API docs if present
- Update acceptance harness from task service flow to chat-session flow.

Acceptance:

- There is one primary product path: session -> message -> run -> result.
- Old task terminology is not exposed in new frontend/API docs except migration notes.
- Required docs are updated in same change.

Verification:

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- frontend checks from `frontend/`

## Future GitHub/PR seam

Do not implement in this plan, but preserve these hooks:

- `ChatSession.repoSource`, `repoProvider`, `repoOwner`, `repoName`, `repoId`, `repoDefaultBranch`, `repoInstallationId`.
- `GitHubService` later owns auth, repo listing, permission validation, token minting, PR operations.
- `SandboxRuntime` later performs clone/fetch/push using short-lived backend-provided auth material.
- `open_pull_request` later is an orchestrator tool bound to current session/run context.
- Tool input should be narrow: title/body/draft maybe branch suggestion.
- Token never enters model prompt, sandbox logs, events, or tool args.

## Main risks

1. Dual-system drift if `/tasks` and `/chat-sessions` both remain first-class.
2. Workspace corruption without DB-backed session lock.
3. Prompt bloat if event history/logs are treated as chat context.
4. Event migration complexity from required `taskId` to session/run streams.
5. Dirty diff semantics across multiple runs in one workspace.
6. Sandbox lifecycle confusion between “cancel this run” and “destroy this PC”.
7. Frontend rename without backend persistence causing reload/history surprises.
8. Artifacts/logs leaking secrets or overwhelming UI/model context.

## Implementation order recommendation

Do not start with frontend.

Recommended order:

1. Phase 0 decisions.
2. Phase 1 data model.
3. Phase 2 events.
4. Phase 3 API contract/tests.
5. Phase 4 session-owned sandbox/run service.
6. Phase 5 harness orchestrator-worker.
7. Phase 6 artifacts.
8. Phase 7 frontend.
9. Phase 8 compatibility removal/docs.

Reason: frontend can mock the shape, but the real product boundary is backend session/run ownership. If that remains task-shaped, the UI becomes cosmetic and the architecture stays wrong.

## First concrete implementation PR

The first PR should be backend-only and should not touch GitHub or frontend.

Scope:

- Add `ChatSession`, `ChatMessage`, and `TaskRun` persistence shape or transitional equivalent.
- Add `sessionId`/`runId` event support.
- Add route tests for `POST /chat-sessions`, `POST /chat-sessions/:id/messages`, `GET /chat-sessions/:id/messages`, `GET /chat-sessions/:id/runs/:runId`.
- Implement enough service logic to create a session, append a message, create a run record, reject concurrent runs.
- Do not yet run the full agent loop if that makes the first PR too large.

But if the user wants no dual system at all, then make this an atomic migration branch and accept that it will be a large PR. In that case, do not ship partial frontend compatibility as “done”.

## Source planning docs

Generated from five domain plans:

- Agent harness implementation plan from subagent task 1.
- `.hermes/plans/2026-08-18_160547-repo-scoped-chat-api-plan.md`
- `.hermes/plans/2026-08-18_160553-event-service-chat-session-run-plan.md`
- Task service/sandbox domain plan from subagent task 4.
- `.hermes/plans/2026-08-18_160558-repo-scoped-chat-frontend-plan.md`
