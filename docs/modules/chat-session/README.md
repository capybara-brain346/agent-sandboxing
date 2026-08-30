# Chat Session Service

## Purpose

The Chat Session Service is the session-first public boundary for repo-scoped
chat. It owns sessions, durable messages, message processing, session events,
artifacts, and the current GitHub pull request view.

Implementation:

- [`chat-session.ts`](../../../src/services/chat/chat-session.ts) owns the
  public session and message operations.
- [`message-processing.ts`](../../../src/services/chat/message-processing.ts)
  owns asynchronous processing, cancellation, sandbox coordination, and
  terminal result persistence.
- [`message-orchestrator.ts`](../../../src/services/chat/message-orchestrator.ts)
  owns context, delegation, and user-facing response construction.

## Session invariant

A chat session owns one sandbox and one working branch. Each user message may
trigger processing in that same workspace. There is no run resource.

## Processing flow

`POST /chat-sessions/:sessionId/messages` creates a queued user message and
publishes its lifecycle events in the same transaction. The processor then:

1. Claims the session's active message lock.
2. Creates or reuses the session sandbox and makes it ready.
3. Checks out the deterministic GitHub branch `agent/<sessionId>` when needed.
4. Invokes the Agent Service with the message and session-owned runtime.
5. Captures the diff and artifacts, writes the assistant message, and marks the
   user message completed or failed.
6. Clears the active message lock without stopping the session sandbox.

Processing statuses are `queued`, `working`, `completed`, `failed`, and
`cancelled`. Only one message can be processed per session at a time.

## Public API

```text
POST   /chat-sessions
GET    /chat-sessions
GET    /chat-sessions/:sessionId
PATCH  /chat-sessions/:sessionId
GET    /chat-sessions/:sessionId/messages
POST   /chat-sessions/:sessionId/messages
GET    /chat-sessions/:sessionId/result
POST   /chat-sessions/:sessionId/cancel
GET    /chat-sessions/:sessionId/events
GET    /chat-sessions/:sessionId/pull-request
GET    /chat-sessions/:sessionId/artifacts/:artifactId
```

Session creation and all reads are scoped to the authenticated user. Repository
input is strict. Fixture repositories are restricted to explicitly enabled
test, evaluation, and acceptance environments; GitHub repository branch lookup
uses the selected repository's owner, name, and installation metadata. The
backend checks installation ownership locally before making the direct branch
request. GitHub session creation validates the selected metadata and installation
ownership locally; repository and branch access are exercised during provisioning,
where the selected base SHA is also verified when present.
Repository and branch discovery responses use short-lived in-memory caches;
explicit repository refresh and a newly connected installation invalidate them.

Messages contain user, assistant, or system content plus processing metadata.
Operational output stays in session events and artifacts. A message result
contains the diff, artifact pointers, assistant summary, exit reason, failure,
and current pull request metadata.

## Events and cancellation

The session event stream is the only public event stream. It uses numeric
sequence cursors and supports both `after` and `Last-Event-ID` replay. State
changes and lifecycle events commit together; live publication happens only
after commit.

`POST /chat-sessions/:sessionId/cancel` aborts tracked processing or performs a
direct terminal cancellation after a restart. Both paths attempt diff capture,
persist cancellation events, and release the session lock.

## Pull request publishing

For GitHub-backed sessions, `publish_pull_request` verifies the configured
remote and session branch, refuses an empty workspace, commits the changes, and
pushes `HEAD:refs/heads/agent/<sessionId>`. It creates the session's pull
request on the first publication and updates that current pull request on later
publications, always targeting the session base branch. The local commit is
reset after publication so the message result can retain its workspace diff;
later publications synchronize the session branch from its remote pull request
branch before committing new changes. GitHub and Git failures are persisted as
safe pull request metadata and session events.

GitHub API adapter calls emit structured debug timing events with operation,
duration, pagination, result counts, and safe repository context. Tokens and
other secret values are never included.

## GitHub latency verification

The response-time regression coverage is split across
`tests/github-service.test.ts`, `tests/github-routes.test.ts`,
`tests/github-api-timing.test.ts`, `tests/chat-session-service.test.ts`, and
`tests/message-processing.test.ts`. Run it with:

```bash
npm test -- tests/github-service.test.ts tests/github-routes.test.ts tests/github-api-timing.test.ts tests/chat-session-service.test.ts tests/message-processing.test.ts
```

For a deployment rollout, set `LOG_LEVEL=debug` and capture one journey through
repository discovery, branch selection, session creation, and the first
message. Compare `request_completed` durations with the `github_api_call_timing`
events for `listAppInstallations`, `listOAuthRepositories`,
`listInstallationRepositories`, `listBranches`, and
`createInstallationToken`. Session creation should have no GitHub API timing
events; provisioning should still include token creation and repository setup.

## Agent and artifacts

The chat service injects Agent Service collaborators and contains no provider
calls. The Agent Service owns model resolution, prompts, tool execution,
delegation, and summary compaction.

`ArtifactStore` keeps bounded, redacted operational output outside the chat
context. Artifact reads are scoped to the owning session. The context builder
does not read artifacts by default.

## Verification

From the repository root:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```
