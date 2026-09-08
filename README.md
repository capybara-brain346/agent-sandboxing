# Agent Sandboxing

Agent Sandboxing is a cloud coding agent system. A user connects GitHub,
selects a repository, and runs a repo-scoped coding session. The system
provisions an isolated sandbox, clones the repository, and an agent works
through sandbox-executed tools. The frontend streams progress, and the system
creates a branch, pushes changes, and opens a pull request.

## Architecture

A chat session owns one sandbox and one working branch. Each user message may
trigger processing in that same workspace.

- **Control plane** — the agent logic, prompts, and provider keys. It sits
  outside the sandbox.
- **Execution plane** — the sandbox runtime, which runs untrusted commands.
  It receives only short-lived, repo-scoped GitHub credentials.
- **SSE** — the backend streams structured events (messages, commands, logs,
  test results, diffs) to the frontend.

The agent does not run inside the sandbox. The separation protects prompts and
LLM keys, limits sandbox credentials to short-lived task tokens, and keeps
execution separable from agent internals. Docker containers provide the sandbox
for the MVP. The sandbox contract stays generic so Docker can later be replaced
by a VM, a microVM, a Kubernetes pod, or a hosted sandbox provider.

## Repository layout

- `src/` — Node.js/TypeScript service.
- `src/routes/` — HTTP and SSE adapters; delegate to services.
- `src/services/` — session, sandbox, command, and event orchestration.
- `src/db/` — Prisma client setup.
- `prisma/` — database schema and migrations.
- `prompts/` — versioned system prompt YAML files.
- `tests/` — Vitest unit and integration tests.
- `repo/` — fixture repository copied into sandboxes.
- `frontend/` — Vite/React/TypeScript chat dashboard.
- `docs/` — product direction and module documentation. See
  `docs/README.md` for the index.

## Prerequisites

- Node.js
- PostgreSQL
- Docker
- `jq`, `curl`, `git`, `timeout`, and POSIX shell tools (for the acceptance
  harness)

## Setup

Install dependencies and generate the Prisma client:

```sh
npm install
npm run prisma:generate
```

## Commands

Run from the repository root.

| Command                            | Purpose                                                                                                                                        |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                      | Development server in watch mode.                                                                                                              |
| `npm test`                         | DB-independent test suite, including HTTP route/API tests.                                                                                     |
| `npm test -- tests/<file>.test.ts` | Run a targeted test.                                                                                                                           |
| `npm run test:runtime`             | Runtime tests. Reserved for `tests/runtime/**/*.test.ts`; that directory is currently absent, so the command exits with "No test files found". |
| `npm run typecheck`                | TypeScript check.                                                                                                                              |
| `npm run lint`                     | ESLint.                                                                                                                                        |
| `npm run build`                    | Typecheck and production bundle.                                                                                                               |
| `npm run prisma:migrate:dev`       | Apply schema changes.                                                                                                                          |

## Run

Development server:

```sh
npm run dev
```

Production build:

```sh
npm run build
npm run start:prod
```

## End-to-end test

The acceptance harness requires the API, PostgreSQL, and Docker to be running,
plus `jq`, `curl`, `git`, `timeout`, and POSIX shell tools:

```sh
BASE_URL=http://localhost:3000 scripts/acceptance/chat-session-atomic-mvp.sh
```

The isolated SWE-bench Lite evaluator is documented in
[`swe-bench-lite/README.md`](swe-bench-lite/README.md). It prepares selected
development or pinned test tasks, runs the public chat-session path, and
submits persisted diffs to the official grader without changing production
code. Phase 3 test measurement records exact denominators and per-task
official outcomes.

## Documentation

Product direction, module guides, and planning documents are in `docs/`. Start
at `docs/README.md`.
