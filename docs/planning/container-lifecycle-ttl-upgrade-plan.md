# Container Lifecycle TTL Upgrade Plan

## Problem

The current run flow treats a chat session sandbox as reusable for the full
session. If the backing Docker container exits or is removed while the database
row remains attached, later messages reuse the stale sandbox row and fail during
agent execution or diff capture with `diff_failed: Sandbox runtime operation
failed`.

Dead sandboxes also remain attached and are not consistently stopped or removed.

## Target Behavior

- A sandbox container is not reused after an agent run reaches a terminal state.
- A new chat run gets a fresh sandbox when the previous one is stopped, failed,
  detached, or past its TTL.
- Terminal run paths retire their sandbox after best-effort diff capture.
- A background TTL cleanup removes leaked or abandoned managed containers.
- Cleanup is idempotent so terminal paths and the TTL sweeper can safely overlap.

## Implementation Plan

1. Add a sandbox retirement method to `SandboxService`.
   - Transition `ready` or `creating` sandboxes to `stopping`.
   - Detach the sandbox from the session by clearing `sessionId` before the
     session run lock is released.
   - Emit `sandbox_stopping` on the run stream when a run context is available.
   - Call `SandboxRuntime.stop(containerName, SANDBOX_STOP_GRACE_MS)`.
   - Mark the row `stopped` with `stoppedAt` and emit `sandbox_stopped`.
   - Treat missing containers as successful cleanup.

2. Use retirement from `RunService` terminal paths.
   - On completion, keep the current order: worker result, diff capture, result
     persistence, then sandbox retirement.
   - On cancellation, keep best-effort diff capture and then retire the sandbox.
   - On failure after sandbox allocation, retire the sandbox best-effort.
   - Ensure detach happens before `activeRunId` is cleared, so the next message
     cannot select the retiring sandbox.

3. Stop blind sandbox reuse in `RunService.ensureSandbox`.
   - Select the session sandbox status when loading a session.
   - Reuse only an attached `creating` or `ready` sandbox for the current
     in-flight run setup.
   - Ignore `stopping`, `stopped`, `failed`, and `deleted` rows and create a new
     sandbox instead.

4. Add TTL cleanup configuration.
   - Add `SANDBOX_TTL_MS`, default `1800000`.
   - Add `SANDBOX_CLEANUP_INTERVAL_MS`, default `60000`.
   - Validate both in `src/config.ts` and document them in `.env.example`.

5. Add a small TTL sweeper.
   - Periodically find managed sandboxes in `creating`, `ready`, `stopping`, or
     `failed` whose `updatedAt` is older than the TTL and whose session has no
     matching active run.
   - Retire each candidate through the same idempotent service method.
   - Start it from the application composition path in development and
     production, not in tests.
   - Stop the interval during process shutdown.

6. Update tests.
   - Replace assertions that expect same-session sandbox reuse after a completed
     run.
   - Cover new-sandbox selection when the existing row is stopped or failed.
   - Cover retirement on completed, failed, and cancelled runs.
   - Cover idempotent cleanup and TTL candidate cleanup in `sandbox-service`
     tests.
   - Cover new config defaults and invalid TTL values.

7. Update module docs.
   - `docs/modules/sandbox-service/README.md`
   - `docs/modules/chat-session/README.md`
   - `docs/modules/agent-service/README.md`
   - Any acceptance harness text that currently says sandboxes are reused.

## Verification

Run focused checks first:

```bash
npm test -- tests/run-service.test.ts tests/sandbox-service.test.ts tests/config.test.ts
npm run typecheck
```

Then run the broader suite before merging:

```bash
npm test
npm run lint
npm run build
```

If Docker and Postgres are available, run the chat acceptance harness and update
its expectations from sandbox reuse to sandbox retirement plus fresh sandbox
creation on the next run.
