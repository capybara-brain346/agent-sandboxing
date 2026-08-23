# Repo-Scoped Chat Workspace Frontend Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Replace the current task-form/run-detail dashboard with a repo-scoped chat workspace where the user selects a repository, sends messages to an attached sandbox agent, and watches responses, run status, changed files, logs, and eventual PR readiness.

**Architecture:** Keep the frontend as a standalone Vite/React/TypeScript app. Introduce a frontend domain model named around `repo`, `chat`, `run`, `event`, and `artifact`, while temporarily adapting to the existing backend `/tasks` API until backend-native repo/chat endpoints exist. Build the UI around one primary workspace route with a chat column and an inspector column for run timeline, logs, changed files, and PR placeholder state.

**Tech Stack:** Vite 8, React 19, React Router 7, TypeScript 6, existing CSS-only styling, browser `fetch`, browser `EventSource` for SSE.

---

## Current frontend context

Existing frontend files inspected:

- `frontend/src/App.tsx`
  - Routes `/` to `NewTaskPage` and `/tasks/:taskId` to `TaskDetailPage`.
- `frontend/src/pages/NewTaskPage.tsx`
  - Current form-first UX: `repoRef`, `instructions`, optional `image`, submit to `createTask`, navigate to `/tasks/:taskId`.
- `frontend/src/pages/TaskDetailPage.tsx`
  - Polls `getTask`, subscribes to `useTaskEvents(snapshot.eventsUrl)`, fetches `getTaskResult` after terminal status, renders overview, event timeline, result, diff, cancel button.
- `frontend/src/api/client.ts`
  - Thin wrapper over current `/tasks` endpoints.
- `frontend/src/api/types.ts`
  - Task-centric types and event type constants.
- `frontend/src/api/useTaskEvents.ts`
  - Task-specific `EventSource` hook; dedupes by event sequence.
- `frontend/src/components/EventTimeline.tsx`
  - Flat event list with payload snippets for command and tool events.
- `frontend/src/components/DiffView.tsx`
  - Raw unified diff renderer.
- `frontend/src/components/AppShell.tsx`
  - Topbar labels only distinguish new run vs run detail.
- `frontend/src/index.css`
  - Existing form/panel/timeline/diff styling, no chat/workspace layout yet.

Backend API currently available for first-phase compatibility:

- `POST /tasks` with `{ repoRef, instructions, image? }` -> `{ taskId, status, eventsUrl }`
- `GET /tasks/:taskId` -> task snapshot with `eventsUrl` and `resultUrl`
- `GET /tasks/:taskId/events` -> SSE event stream, supports `after` query/`Last-Event-ID`
- `GET /tasks/:taskId/result` -> terminal result with `diff`, `agentSummary`, `exitReason`, `failure`
- `DELETE /tasks/:taskId` -> cancel/cancelling response

Important repo state note: the workspace currently has unrelated modified files outside `frontend/`. Do not touch them during frontend implementation.

---

## Product and UX decisions

1. **Primary surface becomes a repo workspace, not a task detail page.**
   - The user flow is: landing -> connect GitHub later notice -> choose repo -> chat in repo workspace -> observe agent run -> review changes/logs -> PR placeholder.
   - The top-level mental model should be “repo + conversation”, not “task + instructions”.

2. **First phase does not implement GitHub auth, clone, or PR creation.**
   - Show GitHub connection as disabled/coming-soon affordance.
   - Repo selection should support a local/demo repo reference such as `./repo` or typed repo ref.
   - PR display is a disabled/placeholder panel that becomes actionable when backend support lands.

3. **Frontend model should be future-ready even if the backend stays task-based temporarily.**
   - Use UI/domain names `Run`, `ChatMessage`, `WorkspaceRepo`, `RunArtifact`, `ChangedFile`, `LogLine`.
   - Keep the task API hidden behind adapter functions so backend renames do not force UI rewrites later.

4. **One user message starts one backend run for the MVP.**
   - In first phase, `sendMessage(repoRef, content)` maps to `POST /tasks { repoRef, instructions: content }`.
   - The assistant message is created as pending, then resolved from terminal `TaskResult.agentSummary` or failure state.
   - Later phases can support multi-turn context server-side without changing the visible chat layout.

5. **SSE is the source of live run details; polling is backup for snapshots/results.**
   - Keep snapshot polling for status/result discovery while the current backend requires it.
   - Make SSE hook generic (`useRunEvents`) and capable of reconnecting with `after=<lastSequence>` to reduce duplicate/missed events.

6. **Logs and timeline should be separate views over the same events.**
   - Timeline = semantic milestones: sandbox ready, command started/completed, tool calls, result ready.
   - Logs = append-only command output/tool snippets, grouped by command when possible.

7. **Changed files are an artifact, not only a raw diff.**
   - First phase can derive changed-file names from the raw unified diff.
   - Keep `DiffView` for detail, but wrap it in `ChangedFilesPanel` with file list, stats if derivable, and empty state.

8. **Old task pages should transition cleanly.**
   - Remove `NewTaskPage` from the primary route.
   - Replace `TaskDetailPage` route with either a redirect into the workspace view or a small legacy compatibility page only if deep links matter.
   - Do not expose “Task” copy in new UX except in internal adapter names.

---

## Proposed route map

### Phase-1 routes

- `/`
  - New landing/repo selection page.
  - Shows product heading, GitHub connect placeholder, selectable/demo repo list, manual repo ref input.
- `/repos/:repoKey/chat`
  - Repo-scoped chat workspace.
  - `repoKey` can be a URL-safe encoding of the repo ref for first phase, or an opaque frontend-generated key stored in session/local state.
- `/runs/:runId` or `/tasks/:taskId`
  - Optional compatibility redirect to the chat workspace if the repo can be recovered from task snapshot.
  - If not recoverable, show “legacy run view” using the new workspace components with missing chat context.

### Future routes when GitHub is implemented

- `/github/connect` or OAuth callback route if the frontend must participate.
- `/repos`
  - Authenticated repo picker.
- `/repos/:owner/:name/chat`
  - Canonical GitHub repo workspace.
- `/repos/:owner/:name/pulls/:prNumber`
  - Optional PR details handoff, likely external GitHub link is enough for MVP.

---

## Proposed frontend state model

Create frontend types separate from backend task types.

### `WorkspaceRepo`

- `id: string`
- `displayName: string`
- `repoRef: string`
- `provider: "local" | "github"`
- `connectionStatus: "available" | "requires_auth" | "coming_soon" | "error"`

### `ChatMessage`

- `id: string`
- `role: "user" | "assistant" | "system"`
- `content: string`
- `createdAt: string`
- `status?: "sending" | "streaming" | "complete" | "failed"`
- `runId?: string`
- `error?: string`

### `RunState`

- `runId: string`
- `repoRef: string`
- `status: "created" | "provisioning" | "running" | "completed" | "failed" | "cancelled"`
- `eventsUrl?: string`
- `resultUrl?: string`
- `createdAt?: string`
- `updatedAt?: string`
- `failure?: { code: string; message: string } | null`

### `RunEvent`

Use the existing public event shape initially, but export it under run naming:

- `sequence: number`
- `type: string`
- `producerService: string`
- `commandId: string | null`
- `payload: Record<string, unknown>`
- `createdAt: string`

### `LogLine`

Derived from events:

- `id: string`
- `sequence: number`
- `commandId?: string | null`
- `source: "command" | "agent" | "system"`
- `level: "info" | "stdout" | "stderr" | "error"`
- `text: string`
- `createdAt: string`

### `ChangedFile`

Derived from result diff in phase 1:

- `path: string`
- `status: "added" | "modified" | "deleted" | "renamed" | "unknown"`
- `additions?: number`
- `deletions?: number`

### `PrState`

Placeholder in phase 1:

- `status: "not_available" | "ready" | "creating" | "created" | "failed"`
- `url?: string`
- `message?: string`

---

## API client plan

### Current compatibility layer

Modify `frontend/src/api/client.ts` and/or create `frontend/src/api/runs.ts`:

- Keep low-level `request<T>()` and `ApiError`.
- Keep task endpoint functions private or mark as legacy/internal.
- Add run/chat-facing functions:
  - `createRun(input: { repoRef: string; message: string; image?: string }): Promise<RunStartResponse>`
    - Internally calls `POST /tasks` with `{ repoRef, instructions: message, image }`.
  - `getRun(runId: string): Promise<RunSnapshot>`
    - Internally calls `GET /tasks/:runId` and maps task snapshot to run snapshot.
  - `getRunResult(runId: string): Promise<RunResult>`
    - Internally calls `GET /tasks/:runId/result`.
  - `cancelRun(runId: string): Promise<RunCancellationResponse>`
    - Internally calls `DELETE /tasks/:runId`.

### Future backend-native endpoints to design for, but not require now

- `GET /repos` -> authenticated repo list
- `POST /repos/import` or `POST /repos/select` -> prepare/validate repo workspace
- `GET /repos/:repoId/sessions` -> chat sessions
- `POST /repos/:repoId/messages` -> send message/start run
- `GET /runs/:runId` -> run snapshot
- `GET /runs/:runId/events` -> SSE stream
- `GET /runs/:runId/artifacts` -> changed files, logs, diff, PR state
- `POST /runs/:runId/pr` -> create PR

### SSE hook plan

Replace `useTaskEvents` with `useRunEvents`:

- Input: `eventsUrl: string | null`, optional `enabled`, optional `onEvent` callback.
- State returned:
  - `events`
  - `connectionState: "idle" | "connecting" | "open" | "reconnecting" | "error" | "closed"`
  - `connectionError: string | null`
  - `lastSequence: number`
- On reconnect, use `after=<lastSequence>` if the backend URL has no cursor already.
- Deduplicate by `sequence` per run.
- Sort by sequence.
- Guard JSON parse errors and expose a non-fatal stream error instead of crashing render.
- Close stream when terminal event or terminal snapshot is observed, unless later backend requires persistent chat events.

---

## Component/page plan

### New/renamed pages

1. `frontend/src/pages/RepoSelectPage.tsx`
   - Replaces `NewTaskPage` as `/`.
   - Sections:
     - Hero: “Choose a repo to work in”.
     - GitHub connect card: disabled/coming soon, explains auth will be added later.
     - Demo/local repo card: default `./repo` or manual repo ref input.
     - Recent repos placeholder if persisted locally.
   - Submit navigates to `/repos/:repoKey/chat`, not directly to a run.

2. `frontend/src/pages/RepoChatPage.tsx`
   - Main workspace page.
   - Responsibilities:
     - Decode/load repo from route/local storage.
     - Own chat message state for phase 1.
     - Send user messages by calling `createRun`.
     - Track active run ID, snapshot, result, events.
     - Render chat and side inspector.
     - On terminal result, append/update assistant message.

3. Optional `frontend/src/pages/LegacyRunRedirectPage.tsx`
   - For `/tasks/:taskId` deep links.
   - Fetch task snapshot, derive repo key, redirect to `/repos/:repoKey/chat?runId=:taskId`.
   - If fetch fails, show an error with a button back to `/`.

### New components

1. `frontend/src/components/RepoConnectCard.tsx`
   - Disabled GitHub connect state.
   - Clear copy: “GitHub connection and PR creation are not enabled in this phase.”

2. `frontend/src/components/RepoPicker.tsx`
   - Manual repo ref entry and demo repo quick-select.
   - Validation: non-empty repo ref.

3. `frontend/src/components/ChatWorkspace.tsx`
   - Layout shell for chat + inspector.
   - Props: repo, messages, activeRun, panels.

4. `frontend/src/components/ChatThread.tsx`
   - Message list, empty state, auto-scroll to latest message.
   - Distinguish user/assistant/system bubbles.
   - Show assistant pending/failed states.

5. `frontend/src/components/ChatComposer.tsx`
   - Multiline textarea and send button.
   - Enter to send, Shift+Enter for newline.
   - Disabled while no repo, empty content, or optionally while a run is active if MVP supports one run at a time.
   - Error state if send fails.

6. `frontend/src/components/RunStatusPanel.tsx`
   - Shows status badge, run ID, current phase, cancel button, timestamps.
   - Reuse/rename `StatusBadge` to accept run statuses.

7. `frontend/src/components/RunTimeline.tsx`
   - Rename/adapt `EventTimeline`.
   - Render friendly labels instead of raw event names.
   - Group noisy `command_output` away from semantic milestones.

8. `frontend/src/components/LogsPanel.tsx`
   - Derived stream of command output/tool snippets.
   - Filter tabs: All / Commands / Agent / Errors.
   - Empty state: “Logs appear when the agent starts working.”

9. `frontend/src/components/ChangedFilesPanel.tsx`
   - File list derived from diff.
   - Select file to show `DiffView` filtered to that file if feasible; otherwise show full diff below the list.
   - Empty state for no changes.

10. `frontend/src/components/ArtifactsPanel.tsx`

- Container for Changed Files, Diff, Logs, future downloadable artifacts.
- May be simple tabs or stacked sections for MVP.

11. `frontend/src/components/PrPanel.tsx`

- Placeholder now: “PR creation will be enabled after GitHub auth and clone support.”
- Future state can show create button/link.

12. `frontend/src/components/LoadingState.tsx` and `frontend/src/components/ErrorState.tsx`

- Shared loading/error primitives to avoid inconsistent page-level messages.

### Components to retire or transition

- `frontend/src/pages/NewTaskPage.tsx`
  - Remove after `RepoSelectPage` is wired.
- `frontend/src/pages/TaskDetailPage.tsx`
  - Replace primary usage with `RepoChatPage`; optionally keep a compatibility wrapper only.
- `frontend/src/api/useTaskEvents.ts`
  - Rename/rework to `useRunEvents.ts`.
- `frontend/src/components/EventTimeline.tsx`
  - Rename/rework to `RunTimeline.tsx`.
- `frontend/src/components/DiffView.tsx`
  - Keep, but make it a leaf inside `ChangedFilesPanel`.

---

## Data derivation helpers

Create `frontend/src/domain/` or `frontend/src/features/workspace/` for pure helpers. Recommended paths:

- `frontend/src/domain/runTypes.ts`
- `frontend/src/domain/repoTypes.ts`
- `frontend/src/domain/chatTypes.ts`
- `frontend/src/domain/eventDerivers.ts`
- `frontend/src/domain/diffDerivers.ts`
- `frontend/src/domain/repoKey.ts`

Helper responsibilities:

1. `repoKey.ts`
   - Encode/decode repo ref for routes.
   - Avoid raw slashes in route param.
   - Keep implementation local and replaceable when real repo IDs arrive.

2. `eventDerivers.ts`
   - `eventsToTimelineItems(events)`
   - `eventsToLogLines(events)`
   - `eventToFriendlyLabel(event)`
   - Handles unknown event types gracefully.

3. `diffDerivers.ts`
   - `parseChangedFiles(diff)`
   - Extract paths from `diff --git a/... b/...`, `+++`, `---` lines.
   - Return empty array for empty/no-change diff.

4. `taskAdapters.ts` or `runAdapters.ts`
   - Maps backend task responses to frontend run types.
   - Keeps task naming out of UI components.

---

## Loading and error-state requirements

### Repo selection

- Manual repo input empty -> inline validation, no API call.
- GitHub connect clicked in phase 1 -> non-error informational disabled state, not a broken button.
- Navigation state should preserve repo ref even if page reloads, via encoded route and optional `localStorage` recent repo list.

### Chat send

- Empty/whitespace message -> disabled send.
- During `createRun` request -> user message appears with `sending`; composer disabled or shows “Starting sandbox…”.
- `POST /tasks` failure -> user message marked failed, assistant/system error bubble explains failure, retry affordance if simple.

### Active run

- No active run -> inspector empty state with “Send a message to start an agent run.”
- Provisioning/running -> status panel and timeline visible immediately.
- SSE disconnected -> warning in status/timeline area, continue polling snapshot.
- Poll failure -> non-blocking warning if SSE is still working; blocking error if no snapshot/events are available.
- Result fetch failure -> result/artifacts error with retry button.
- Cancel failure -> inline error near cancel button; do not clear existing run state.

### Terminal states

- Completed with summary -> assistant message content uses `agentSummary`.
- Completed without summary -> assistant message says run completed and prompts user to review changed files/logs.
- Failed/cancelled -> assistant message explains terminal state and surfaces failure code/message when available.
- No diff -> changed files panel says “No files changed.”

---

## Phase plan

### Phase 0: Establish frontend domain seams

**Objective:** Introduce run/chat/repo types and adapter helpers without changing visible behavior yet.

**Files likely to change/create:**

- Create `frontend/src/domain/repoTypes.ts`
- Create `frontend/src/domain/chatTypes.ts`
- Create `frontend/src/domain/runTypes.ts`
- Create `frontend/src/domain/repoKey.ts`
- Create `frontend/src/api/runs.ts` or extend `frontend/src/api/client.ts`
- Keep `frontend/src/api/types.ts` as backend task types or split to `taskTypes.ts`

**Implementation notes:**

- Do not rename backend concepts globally in one risky commit.
- Add a thin `createRun` adapter first and switch only new UI to it.
- Keep `TaskStatus` values if identical, but export as `RunStatus` from domain types.

**Verification:**

- `npm run typecheck` in `frontend/`
- `npm run build` in `frontend/`

### Phase 1: Replace landing task form with repo selection

**Objective:** Make `/` about selecting a repo, not submitting instructions.

**Files likely to change/create:**

- Create `frontend/src/pages/RepoSelectPage.tsx`
- Create `frontend/src/components/RepoConnectCard.tsx`
- Create `frontend/src/components/RepoPicker.tsx`
- Modify `frontend/src/App.tsx`
- Modify `frontend/src/components/AppShell.tsx`
- Modify `frontend/src/index.css`
- Retire `frontend/src/pages/NewTaskPage.tsx` after route switch

**UX acceptance criteria:**

- `/` shows GitHub connect placeholder and local/manual repo choice.
- Selecting `./repo` or entering a custom repo navigates to `/repos/:repoKey/chat`.
- No instruction textarea appears on landing.
- Copy clearly says GitHub is coming later, not broken.

**Verification:**

- Manual browser QA: open `/`, select default repo, verify URL changes to chat route.
- `npm run typecheck`
- `npm run build`

### Phase 2: Build repo chat workspace shell

**Objective:** Add workspace page with chat thread, composer, and inspector empty state.

**Files likely to change/create:**

- Create `frontend/src/pages/RepoChatPage.tsx`
- Create `frontend/src/components/ChatWorkspace.tsx`
- Create `frontend/src/components/ChatThread.tsx`
- Create `frontend/src/components/ChatComposer.tsx`
- Create `frontend/src/components/RunStatusPanel.tsx`
- Modify `frontend/src/App.tsx`
- Modify `frontend/src/index.css`

**UX acceptance criteria:**

- `/repos/:repoKey/chat` displays repo identity prominently.
- Chat thread starts with helpful empty state.
- Composer accepts multi-line message.
- Inspector says no run has started yet.
- The UI is responsive: on small screens inspector stacks below chat.

**Verification:**

- Manual QA at desktop and narrow viewport widths.
- Keyboard QA: Enter sends, Shift+Enter inserts newline.
- `npm run typecheck`
- `npm run build`

### Phase 3: Wire message send to run creation

**Objective:** Make sending a chat message create a backend run through the adapter.

**Files likely to change/create:**

- Modify `frontend/src/pages/RepoChatPage.tsx`
- Modify/create `frontend/src/api/runs.ts`
- Possibly modify `frontend/src/api/client.ts`
- Modify `frontend/src/components/ChatThread.tsx`
- Modify `frontend/src/components/ChatComposer.tsx`

**UX acceptance criteria:**

- Sending a message immediately adds a user bubble.
- While `POST /tasks` is in flight, composer indicates sending/starting.
- On success, active run ID is set and status panel updates.
- On failure, message is marked failed and user can edit/resend or send again.
- Only one active run at a time unless explicitly designed otherwise.

**Verification:**

- Manual QA with backend running: send “inspect repo” against `./repo`, confirm network call `POST /tasks`.
- Manual failure QA: set bad `VITE_API_BASE_URL` or stop backend, confirm error bubble.
- `npm run typecheck`
- `npm run build`

### Phase 4: Generalize SSE and render run timeline/logs

**Objective:** Consume live events in workspace and split them into semantic timeline and logs.

**Files likely to change/create:**

- Rename/create `frontend/src/api/useRunEvents.ts`
- Create `frontend/src/domain/eventDerivers.ts`
- Create/modify `frontend/src/components/RunTimeline.tsx`
- Create `frontend/src/components/LogsPanel.tsx`
- Modify `frontend/src/pages/RepoChatPage.tsx`
- Retire `frontend/src/api/useTaskEvents.ts` after migration
- Retire/rename `frontend/src/components/EventTimeline.tsx` after migration

**UX acceptance criteria:**

- Timeline shows friendly phases, not only raw event names.
- Command output appears in Logs, not as noisy timeline rows.
- SSE connection state is visible when disconnected/reconnecting.
- Events are deduped and ordered by sequence.
- Unknown event types do not crash the UI.

**Verification:**

- Manual live run QA: confirm sandbox events, command output, tool events appear.
- Simulate SSE disconnect by stopping backend; UI should warn and keep existing events.
- Restart backend if possible; reconnect should request `after=<lastSequence>`.
- `npm run typecheck`
- `npm run build`

### Phase 5: Result, changed files, diff, and assistant response

**Objective:** Convert terminal run result into assistant chat response and artifact panels.

**Files likely to change/create:**

- Create `frontend/src/domain/diffDerivers.ts`
- Create `frontend/src/components/ChangedFilesPanel.tsx`
- Create `frontend/src/components/ArtifactsPanel.tsx`
- Modify `frontend/src/components/DiffView.tsx` only if needed
- Modify `frontend/src/pages/RepoChatPage.tsx`
- Modify `frontend/src/components/ChatThread.tsx`

**UX acceptance criteria:**

- When run completes, assistant bubble is updated from `agentSummary` or a fallback terminal-state message.
- Changed files panel shows file names parsed from diff.
- Empty diff shows clear no-change state.
- Failed/cancelled run surfaces failure code/message in chat and status panel.
- Diff remains readable for large-ish output and horizontally scrollable.

**Verification:**

- Manual QA completed run with diff.
- Manual QA completed run with no diff.
- Manual QA failed/cancelled run.
- `npm run typecheck`
- `npm run build`

### Phase 6: PR placeholder and old task route cleanup

**Objective:** Finish transition away from task UX while keeping future GitHub/PR seams visible.

**Files likely to change/create:**

- Create `frontend/src/components/PrPanel.tsx`
- Create optional `frontend/src/pages/LegacyRunRedirectPage.tsx`
- Modify `frontend/src/App.tsx`
- Modify `frontend/src/components/AppShell.tsx`
- Delete or orphan-check `frontend/src/pages/NewTaskPage.tsx`
- Delete or wrap `frontend/src/pages/TaskDetailPage.tsx`

**UX acceptance criteria:**

- No primary navigation says “New run” or “Task detail”.
- PR panel is visible but disabled with honest phase-1 copy.
- `/tasks/:taskId` either redirects gracefully or uses compatibility page.
- Removed files have no imports/references.

**Verification:**

- `npm run typecheck`
- `npm run lint`
- `npm run build`
- Manual QA: `/`, chat route, optional legacy task route.

---

## Testing strategy

Current `frontend/package.json` has no test runner beyond typecheck/lint/build. Recommended approach:

### Minimum required for this frontend change

Run after every phase:

```bash
cd /home/capybara/code/agent-sandboxing/frontend
npm run typecheck
npm run lint
npm run build
```

### Recommended test tooling addition

If allowed, add Vitest + React Testing Library in a separate setup phase:

- `vitest`
- `@testing-library/react`
- `@testing-library/user-event`
- `@testing-library/jest-dom`
- `jsdom` or `happy-dom`

Add scripts:

- `test:unit`: `vitest run`
- `test`: `vitest run`

### Unit tests to add if test tooling is introduced

1. `repoKey` helper
   - Encodes `./repo`, `owner/name`, and URL-like refs safely.
   - Decodes back to original repo ref.

2. `eventDerivers`
   - `command_output` maps to log lines.
   - `command_started`, `sandbox_ready`, `task_result_ready` map to timeline items.
   - Unknown event type maps to safe generic item.

3. `diffDerivers`
   - Empty diff -> empty file list.
   - Modified file diff -> one `ChangedFile`.
   - Added/deleted file headers produce expected statuses where possible.

4. `ChatComposer`
   - Send disabled for whitespace.
   - Enter sends.
   - Shift+Enter creates newline.
   - Disabled/submitting state prevents duplicate sends.

5. `RepoSelectPage`
   - Default demo repo navigates to chat route.
   - GitHub card is disabled/coming soon.

6. `RepoChatPage` with mocked API
   - Sending message calls `createRun` adapter with repo ref + content.
   - Failed createRun shows error bubble.
   - Terminal result updates assistant message.

### Manual QA checklist

- Landing page:
  - GitHub connect appears but is clearly unavailable.
  - Manual repo ref validation works.
  - Demo repo selection navigates correctly.
- Chat workspace:
  - Empty state is understandable.
  - Message send creates run.
  - Composer behavior is correct: Enter vs Shift+Enter.
  - UI handles long messages and narrow viewport.
- Active run:
  - Status changes from created/provisioning/running to terminal state.
  - Cancel button appears only for non-terminal runs.
  - Cancel action handles success and failure.
- SSE:
  - Timeline and logs update without refresh.
  - Disconnect warning appears when backend stops.
  - UI remains usable if SSE fails but polling works.
- Result/artifacts:
  - Assistant response appears when result is ready.
  - Changed files list matches diff.
  - Empty diff state is not alarming.
  - Failure/cancel states are clear.
- Transition:
  - No visible primary task form remains.
  - Old `/tasks/:taskId` route behavior is intentional and documented in code comments if retained.

---

## Risks and mitigations

1. **Backend is still task-centric.**
   - Risk: UI rename creates mismatch/confusion.
   - Mitigation: isolate backend naming in adapters; UI/domain names use run/chat/repo.

2. **No persistent chat sessions in backend.**
   - Risk: page reload loses chat history.
   - Mitigation: phase 1 can keep session state in memory and optionally localStorage keyed by repo; be explicit that backend persistence is future work.

3. **One message equals one run may feel unlike chat.**
   - Risk: users expect multi-turn context.
   - Mitigation: show each user request/run as a message pair now; design state to attach multiple runs to one repo thread later.

4. **SSE gaps or duplicate events.**
   - Risk: EventSource reconnect may replay events or miss events if cursor is not used.
   - Mitigation: dedupe by sequence and reconnect with `after=<lastSequence>`.

5. **Large logs/diffs can degrade rendering.**
   - Risk: command output and diffs become huge.
   - Mitigation: cap visible logs, virtualize later if needed, preserve raw full diff in scrollable container, avoid rendering command output in timeline.

6. **Route encoding for arbitrary repo refs.**
   - Risk: raw refs include slashes, colons, URLs.
   - Mitigation: use a route-safe encoded repo key helper; replace with backend repo IDs later.

7. **PR placeholder could overpromise.**
   - Risk: user thinks GitHub/PR is functional.
   - Mitigation: disabled state and exact copy: auth/clone/PR are not implemented in this phase.

8. **Old task deep links.**
   - Risk: removing `/tasks/:taskId` breaks existing manual QA links.
   - Mitigation: keep a lightweight compatibility route for one phase if needed.

---

## Open questions for parent/implementer

1. Should phase 1 preserve chat history across page reloads via `localStorage`, or is in-memory state acceptable?
2. Should the composer allow sending a new message while a run is active, queue it, or force one active run at a time? Recommendation: force one active run at a time for MVP.
3. Should `/tasks/:taskId` be supported as a compatibility route, or can it be removed outright? Recommendation: keep redirect/wrapper for one phase.
4. Is the first selectable repo always `./repo`, or should the frontend list known local repos from a backend endpoint when available? Recommendation: use `./repo` + manual input until repo listing exists.
5. Should frontend test tooling be added now, or only typecheck/lint/build? Recommendation: add Vitest/RTL if this UI will continue evolving.

---

## Definition of done

- User lands on a repo-selection page, not a task form.
- User can open a repo-scoped chat workspace.
- User can send a message that starts a sandbox-backed run using the existing backend task API adapter.
- Chat shows user message, pending/running assistant state, terminal assistant response or failure.
- Workspace shows run status, timeline, logs, changed files/diff, and honest PR placeholder.
- SSE events update the workspace live and handle disconnects without crashing.
- Old task UI is removed from primary flow or intentionally wrapped for compatibility.
- `npm run typecheck`, `npm run lint`, and `npm run build` pass in `frontend/`.
