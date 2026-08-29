# Frontend

## Purpose

The frontend is a repo-scoped chat workspace for the Chat Session Service. It
lets users choose a repository, send messages, watch session processing through
SSE, and inspect the result, diff, artifacts, and current pull request.

The app lives in [`frontend/`](../../../frontend/) as a standalone Vite, React,
and TypeScript SPA. It owns no backend state and stores no authentication
tokens.

## Current contract

- `/login` starts GitHub OAuth.
- `/repos` selects a repository and branch, then creates a chat session.
- `/sessions/:sessionId` renders messages and the current message-processing
  inspector.
- `POST /chat-sessions/:sessionId/messages` submits a message.
- `GET /chat-sessions/:sessionId/events` provides the single session event
  stream and replay cursor.
- `GET /chat-sessions/:sessionId/result` loads the latest terminal result.
- `POST /chat-sessions/:sessionId/cancel` cancels the active message.

A chat session owns one sandbox and one working branch. Each user message may
trigger processing in that same workspace. There is no run resource.

The workspace uses session `status`, `activeMessageId`, and message
`processingStatus` to show working state and disable the composer while
processing is active. The inspector shows the processing
timeline, status, changed files, diff, and pull request. Session events are
rendered with `TimelineRow` and tool results use bounded event snippets.

## Structure

- `src/api/types.ts` mirrors the backend session, message, result, artifact, and
  event contracts.
- `src/api/client.ts` is the credentialed fetch wrapper.
- `src/api/useEventStream.ts` opens the session SSE stream and deduplicates
  sequence numbers.
- `src/pages/` contains authentication, repository selection, and chat pages.
- `src/components/ai/` contains the chat, processing, timeline, diff, and pull
  request primitives.
- `src/styles/theme.css` contains the shared visual tokens.

## Development and verification

From `frontend/`:

```bash
npm install
npm run dev
npm run typecheck
npm run build
npm run lint
```

The Vite development proxy forwards `/auth`, `/github`, `/chat-sessions`, and
`/health` to the backend. Production deployments on different origins need a
reverse proxy or backend CORS configuration.
