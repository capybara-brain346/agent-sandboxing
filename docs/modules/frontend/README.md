# Frontend

## Purpose

A repo-scoped chat workspace for the [Chat Session Service](../chat-session/README.md)
product boundary: pick a repo, send a message, watch the resulting run
execute through a live event stream, and inspect the terminal result, diff,
and artifacts. It is a plain client of the public HTTP API documented in
[Chat Session Service](../chat-session/README.md) and
[Event Service](../event-service/README.md); it owns no state the backend
doesn't already expose.

The app lives in [`frontend/`](../../../frontend/) as a standalone Vite +
React + TypeScript SPA, separate from the backend's `tsconfig`/build.

## Read first

- [`docs/agent-sandboxing-project.md`](../../agent-sandboxing-project.md) — product direction
- [Chat Session Service](../chat-session/README.md) — public HTTP contract, run lifecycle, and harness
- [Event Service](../event-service/README.md) — SSE delivery, replay cursor, and event taxonomy

## Status and scope

MVP only, matching the current session API surface:

- **Login** (`/login`) — starts GitHub OAuth and redirects authenticated users to
  repository selection.
- **Repo select** (`/repos`) — loads the authenticated user, GitHub App
  installations, personal repositories shared by OAuth and the App, and recent
  user-owned sessions. Branch metadata loads for the selected repository only;
  selecting a branch immediately creates a GitHub-backed chat session. The page
  distinguishes first-time repository setup, installed-with-no-shared-repos, and
  ready states, and includes a refresh action after GitHub access changes.
- **Root** (`/`) — redirects logged-out users to `/login` and logged-in users to
  `/repos`.
- **Chat workspace** (`/sessions/:sessionId`) — the primary route. The thread
  and prompt bar sit in the primary column; a pointer-drag resizable run
  inspector sits on the right with a sticky header and Timeline/Changed
  files/Diff/Pull request tabs:
  - The thread renders the session's chat history
    (`GET /chat-sessions/:sessionId/messages`) as `MessageBubble`s; the user
    bubble for a new message appears immediately, before the server confirms
    it, and a `ThinkingBlock` stands in for the pending assistant turn while a
    run is active.
  - `PromptBar` posts a new message (`POST
/chat-sessions/:sessionId/messages`); while a run is active, sending is
    blocked client-side to match the backend's one-active-run-per-session
    lock (`409 session_run_in_progress`).
  - The run inspector shows the latest run's status
    (`GET /chat-sessions/:sessionId/runs/:runId`) via `StatusPill`, a cancel
    action while non-terminal (`DELETE .../runs/:runId`), the terminal result
    (`GET .../runs/:runId/result`) with exit reason/summary/failure, and the
    unified diff via `DiffTable`. The pull request tab renders `ApprovalCard`
    disabled — pull request creation isn't wired up yet.
  - The Timeline tab renders the live run event stream as `TaskRow`s (with
    `ToolChip` for agent tool calls/results).

The app sends same-origin cookie credentials on API requests. The backend owns
authentication and user scoping; the frontend does not store tokens.

## Structure

- `frontend/src/api/types.ts` — hand-ported response/request types mirroring
  `src/types/chat.types.ts`/`src/types/task.types.ts` and `EVENT_TYPES` from
  `src/types/event.types.ts`. Field names must stay identical to the backend
  contract; update both sides together when the backend contract changes.
- `frontend/src/api/client.ts` — thin fetch wrapper for auth, GitHub, and
  chat-session REST endpoints; requests include same-origin cookie credentials.
- `frontend/src/api/useEventStream.ts` — generic hook that opens an
  `EventSource` against a session or run's events URL. Reconnect/replay uses
  the browser's native `Last-Event-ID` behavior, matching the cursor contract
  in the Event Service; no manual cursor bookkeeping is implemented
  client-side.
- `frontend/src/pages/` — route components (`LoginPage`, `AuthRedirectPage`,
  `RepoSelectPage`, `ChatWorkspacePage`).
- `frontend/src/components/AppShell.tsx` — the persistent shell: a sessions
  sidebar, and a global header with the repo/branch switcher, live run status,
  theme toggle, and user menu.
- `frontend/src/components/ai/` — the AI-native primitive set the chat
  workspace and run inspector are built from (`PromptBar`, `MessageBubble`,
  `StreamingText`, `ThinkingBlock`, `TaskRow`, `ToolChip`, `CodeBlock`,
  `DiffTable`, `StatusPill`, `ContextCard`, `ApprovalCard`, `Skeleton`). Each
  is driven only by data the existing API already returns.
- `frontend/src/components/ui/` — shadcn/ui-generated and shadcn-style
  primitives (`Button`, `Alert`), styled through the token system below.
- `frontend/src/styles/theme.css` — the app's only stylesheet, imported once
  from `main.tsx`. Tailwind v4 `@theme`/`@theme inline` blocks define a
  dark-first token system (surface/border/content ramps, a single accent hue,
  status and diff color families, a seven-step type scale on Geist Variable,
  and two density scales) with light as the derived `:root` mode and dark as
  `.dark`. It also aliases shadcn/ui's expected token names (`--color-primary`,
  `--color-muted`, etc.) onto the same ramps, so `components.json` points
  `shadcn add` at this file instead of a separate palette.

## Compatibility

The legacy `NewTaskPage`/`TaskDetailPage` routes and the `/tasks` API client
were removed once the chat workspace reached equivalent coverage (Phase 7/8
of the [master plan](../../planning/repo-scoped-chat-session-agent-harness-plan.md)).
There is no task list/history page or task-shaped route left in the frontend.

## Dev-time cross-origin

The backend has no CORS middleware. `frontend/vite.config.ts` proxies `/auth`,
`/github`, `/chat-sessions`, and `/health` to `http://localhost:3000` in dev,
including full-page navigations such as `/auth/github/start`, so the SPA calls
same-origin paths and no backend change is needed locally. Backend OAuth and
GitHub App callbacks redirect browser users back to frontend routes through
`APP_BASE_URL`. A production deploy where the frontend and backend are on
different origins will need CORS (or a reverse proxy) added to the backend — not
yet implemented.

For local GitHub auth, `APP_BASE_URL` must be `http://localhost:5173`. The
GitHub OAuth callback URL and GitHub App Setup URL stay on the backend:
`http://localhost:3000/auth/github/callback` and
`http://localhost:3000/github/install/callback`.

## Development and verification

From `frontend/`:

```bash
npm install
npm run dev        # requires the backend running locally
npm run typecheck
npm run build
npm run lint
```

See [`frontend/README.md`](../../../frontend/README.md) for local setup
details.

`npm run dev` also runs `@axe-core/react` against the live tree (dev builds
only, wired in `main.tsx`) and logs any accessibility violation it finds to
the browser console.
