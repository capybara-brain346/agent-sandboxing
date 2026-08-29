# Sandbox Service

## Purpose

The Sandbox Service is the internal execution plane for chat sessions. It owns
the session sandbox, repository provisioning, Git diff capture, and sandbox
lifecycle events. It does not own message orchestration or the public HTTP API.

Implementation:

- [`sandbox.ts`](../../../src/services/sandbox/sandbox.ts) owns the sandbox
  lifecycle and session runtime seam.
- [`runtime.ts`](../../../src/services/sandbox/runtime.ts) is the only Docker
  integration.
- [`command-execution.ts`](../../../src/services/sandbox/command-execution.ts)
  retains the bounded persisted command seam for future use.

## Internal contract

The message processor uses these session-scoped operations:

- `createForSessionInTransaction` creates a session-owned sandbox row without
  invoking Docker.
- `ensureReadyForSession` provisions a fixture or GitHub repository and returns
  a ready or structured failed result.
- `prepareSessionBranchForSession` ensures GitHub sessions use
  `agent/<sessionId>`. It creates that branch only from the selected base,
  checks out an existing branch when the workspace is clean, and rejects a
  dirty workspace on the wrong branch. Existing session workspaces are never
  reset to the base branch.
- `getAgentToolTarget` validates ownership and readiness, then exposes only the
  container name and `simpleExec` runtime seam.
- `diffForSession` captures the binary Git diff.

The Agent Service never receives Docker, Prisma, or control-plane secrets.
Runtime output is bounded and cancellation uses `AbortSignal`.

## Lifecycle and provisioning

The normal lifecycle is:

```text
creating --provision--> ready
    |
    +-- provisioning/runtime failure --> failed
```

Completed message processing leaves the sandbox ready for later messages. The
stopping and stopped states remain available for a future explicit session
teardown path.

Fixture provisioning copies the configured repository into
`/workspace/repo`. GitHub provisioning clones the selected repository with a
short-lived installation token, resets the remote to a token-free URL, and
checks out the selected base branch before message processing selects the
session branch.

## Events and safety

Sandbox lifecycle, command, and diff events are appended to the owning session
stream. State changes and lifecycle events commit together, and publication
happens after commit.

Commands and agent tools validate workspace paths under `/workspace/repo`,
enforce time and output limits, preserve valid UTF-8 boundaries, and never put
provider keys or raw runtime failures into events or logs.

## Configuration and verification

Runtime configuration is loaded by `src/config.ts`, including the sandbox
image, fixture enablement, resource limits, command limits, and agent-facing
tool limits. From the repository root:

```bash
npm run typecheck
npm test -- tests/sandbox-service.test.ts tests/command-execution-service.test.ts
```
