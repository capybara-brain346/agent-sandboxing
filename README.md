# Agent Sandboxing

The public product boundary is the task API (`/tasks`). Each task owns one
internal Docker sandbox; sandbox lifecycle and command events are delivered on
the task SSE stream. Standalone `/sandboxes/*` endpoints are intentionally not
registered.
