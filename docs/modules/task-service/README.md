# Retired Task Runtime

## Status

The standalone task execution service and its HTTP surface have been removed.
There is no live task-scoped API or service boundary. Message processing is
owned by the Chat Session Service and the Agent and Sandbox Services.

This page remains as an index entry for historical planning documents and the
database migration that removed the old execution tables. New code must use the
session, message, processing, result, and session-event contracts documented in
the [Chat Session Service](../chat-session/README.md).

A chat session owns one sandbox and one working branch. Each user message may
trigger processing in that same workspace. There is no run resource.

## Verification

Use the repository checks from the root:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```
