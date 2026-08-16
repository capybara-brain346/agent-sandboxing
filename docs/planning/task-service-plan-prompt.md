# Prompt: Task Service Atomic MVP — Implementation Plan

Give this to a coding/planning agent. It must produce ONLY a plan document — no implementation, no schema changes, no code.

---

You are writing a technical implementation plan for the next component of a cloud coding agent system.

WORKING DIRECTORY: /home/capybara/code/agent-sandboxing

## Step 0 — Read these files first (mandatory)

- AGENTS.md (architecture, conventions, solid coding principles)
- docs/agent-sandboxing-project.md (product direction)
- docs/planning/sandbox-service-atomic-mvp-plan.md (FORMAT TEMPLATE — your output must mirror its structure and tone)
- docs/modules/sandbox-service/README.md
- prisma/schema.prisma (Sandbox / Command / SandboxEvent models)
- src/services/sandbox/sandbox.ts (state machine + transitions pattern)
- src/services/sandbox/command-execution.ts
- src/services/sandbox/event-store.ts (appendInTransaction pattern)
- src/services/sandbox/sse-hub.ts
- src/services/sandbox/runtime.ts (SandboxRuntime — the only place that spawns docker)
- src/types/sandbox.types.ts (zod schemas, EventType union, PublicEvent)
- src/routes/sandbox.routes.ts (thin route layer pattern)
- src/config.ts (zod-validated env config pattern)

## Goal

Produce a complete, atomic-MVP implementation plan for a **Task Service** and write it to:

    docs/planning/task-service-atomic-mvp-plan.md

Mirror the structure of the sandbox plan: header blockquote (Created/Status/Valid for/Invalid when/Scope reminder), then numbered sections Product Boundary And Non-Goals, Architecture Diagram, Components And Responsibilities, Data Model, API Surface, State Machine And Events, Failure Paths, Cancellation, Event Stream And Replay, Tests, Acceptance Harness, File Layout, Implementation Order, Risks.

## Context: what already exists

The Sandbox Service is implemented and working. It creates one Docker container per sandbox from a local fixture repo, runs sequential commands inside it, persists sandbox/command/event rows in Postgres, streams ordered events over SSE, and returns git diffs. Its HTTP routes (POST /sandboxes, POST /sandboxes/:id/commands, GET /sandboxes/:id/diff, GET /sandboxes/:id/events, DELETE /sandboxes/:id) exist today as direct call surface.

## The architectural decision that frames this plan

- The Task Service is the PRODUCT BOUNDARY. The frontend talks ONLY to task APIs. All current sandbox HTTP APIs will eventually be owned/replaced by task APIs — the sandbox becomes an internal execution plane.
- The Sandbox Service is consumed IN-PROCESS by the Task Service (constructor-injected class, same Node process), NOT over HTTP. The plan must design the Task Service around calling SandboxService methods directly.
- The existing sandbox HTTP routes are NOT removed in this phase; they remain as internal dev tools during the transition. State this explicitly in the plan and the conditions for their later removal.
- The Agent Service does NOT exist yet and is OUT OF SCOPE for this plan — BUT the plan must leave a clearly defined seam where an agent runner plugs in later (the "running" step of the task lifecycle). Design the seam; do not build the agent.

## The Task Service black-box contract (agreed, do not redesign)

INPUTS (commands the caller can send):
- Create task: repoRef (fixture repo path today; repo URL later), instructions, optional image
- Cancel task
- Read: get task, subscribe to events, get result/diff

OUTPUTS:
- Sync: create response with taskId, initial status, events stream URL
- Async: task-scoped, ordered, replayable event stream (SSE fanout over the persisted event log — SSE is never the source of truth; reconnect replays from a cursor)
- Terminal: result payload — git diff, agent summary (null in MVP), exit reason (completed / failed / cancelled / timed_out), timestamps

EXPLICITLY NOT EXPOSED: container handles, sandbox IDs, arbitrary command execution, sandbox internals. The sandbox is invisible behind the task.

## Technical requirements the plan must satisfy

1. **State machine**: Task statuses created -> provisioning -> running -> completed | failed | cancelled. A single transitions map is the only place encoding legal transitions (mirror sandbox.ts). Task and its sandbox lifecycle must be linked: no orphan sandbox window (recommend creating task row + sandbox row in the same transaction; decide exact flow).
2. **Events**: every state change is appended to the persisted event log in the same DB transaction as the mutation, then published after commit (mirror EventStore.appendInTransaction + publish pattern). Extend the EventType union with task lifecycle types (task_created, task_provisioning_started, task_running, task_completed, task_failed, task_cancelled, task_result_ready — refine names). DECIDE AND JUSTIFY: reuse the existing sandbox_events table (add taskId / relax sandboxId) so a task gets ONE ordered stream including its sandbox/command events, versus a separate task_events table. Prefer the single-stream answer; pick whichever is cleanest with the current schema and say why.
3. **Failure paths are explicit states**: provision_failed, sandbox_died, command_failed, cancelled, (future: agent_timed_out). Each lands the task terminal with a reason event. No dangling "running" tasks.
4. **Cancellation is async**: abort the run step, kill in-flight command, stop container, THEN emit task_cancelled. Shape it like the existing stop path.
5. **The run seam**: define a narrow runner contract (e.g., TaskRunner interface or a run() method) whose MVP implementation is a placeholder that completes immediately (or runs nothing) while exercising the full diff-capture + cleanup path. The future AgentService implements this seam. No speculative abstractions beyond what both concrete implementations will need — note that the sandbox plan's precedent: no interface until a second implementation lands; if a thin seam is needed for the stub, keep it minimal.
6. **Prisma**: Task model (id with task_ prefix, status, repoRef, instructions, result refs: diff/summary/exitReason, timestamps). Migration via npm run prisma:migrate:dev — never hand-edit prisma/migrations/.
7. **Conventions from AGENTS.md**: ServiceError for boundary errors; zod .strict() schemas parsed at route boundary; services get constructor-injected collaborators; no Express types in services; runQuery/logQueryFailure for Prisma; logger event-name-first; randomUUID/cuid IDs; fail closed, log once; no new config that bypasses config.ts.

## Constraints

- Additive only: do not plan removal or renaming of existing sandbox routes/services in this phase.
- No GitHub integration, no auth, no frontend, no agent loop, no queue workers, no parallel sandboxes per task, no task retry logic in MVP (state the boundary; allow a deliberate "create new task" retry path only).
- Plan must include vitest unit tests (DB-independent, mirroring tests/ structure) and a curl-based acceptance harness description.
- The plan must state an explicit IMPLEMENTATION ORDER of atomic slices ending in a verifiable state.

## Deliverable

Write ONLY docs/planning/task-service-atomic-mvp-plan.md. Do not modify any source files, schema, or configuration. Do not run migrations. Verify the file reads cleanly, then report: the path, the section list, and any decisions you had to make that were left open (especially the event-table decision and the same-transaction task+sandbox flow).