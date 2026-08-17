# Repository Operating Guide

## Scope

These instructions apply to the repository. More specific `AGENTS.md` files
in subdirectories override them.

Read relevant package/config files and the applicable service guide before
changing a component:

- Task routes/services: `docs/modules/task-service/README.md`.
- Sandbox services/runtime: `docs/modules/sandbox-service/README.md`.
- Event store/SSE: `docs/modules/event-service/README.md`.
- Agent runner/tools: `docs/modules/agent-service/README.md`.
- Frontend dashboard: `docs/modules/frontend/README.md`.
- Product boundary and broader direction: `docs/agent-sandboxing-project.md`.

Always update the applicable service README in the same change when modifying
that service, including changes to behavior, APIs, lifecycle, configuration,
operations, or structure.

## Repository map

- `src/` — Node.js/TypeScript service.
- `src/routes/` — HTTP and SSE adapters; delegate to services.
- `src/services/` — task, sandbox, command, and event orchestration.
- `src/db/` — Prisma client setup.
- `src/shared/` and `src/types/` — cross-service errors, helpers, and types.
- `prisma/schema.prisma` — database schema; `prisma/migrations/` — migration history.
- `tests/` — Vitest unit and integration tests.
- `repo/` — fixture repository copied into sandboxes; not application source.
- `frontend/` — standalone Vite/React/TypeScript dashboard; own `package.json`
  and `tsconfig`, separate from the backend build.
- `docs/` — product direction and module documentation.

## Sources of truth

- The implementation and tests define current behavior. The user request and
  the architecture invariants below define intended behavior. If they differ,
  surface the discrepancy and resolve it explicitly; do not silently treat
  current behavior as the desired behavior.
- `src/config.ts` is the only source of runtime configuration.
- `prisma/schema.prisma` and committed migrations define database shape.
- Do not hand-edit generated files or files under `prisma/migrations/`; use the
  project’s Prisma commands.

## Architecture invariants

- Keep the dependency direction: product routes → `TaskService` →
  task/sandbox/event services → Prisma or `SandboxRuntime`. The SSE route is an
  intentional exception: it directly coordinates replay and subscription with
  `SseHub`.
- Routes must not access Prisma or sandbox internals. Domain and orchestration
  services must not import Express types; `SseHub` is the intentional
  transport-layer exception because it manages live `Response` connections.
- `SandboxRuntime` is the only module that invokes Docker.
- Task status transitions have an authoritative map in `src/services/task/task.ts`;
  update its production checks and transition tests when changing them.
- The sandbox `transitions` map is currently a helper/test contract, not the
  runtime enforcement point. When changing legal sandbox status transitions,
  update the map, the enforcing database predicates/assignments in
  `sandbox.ts`, and transition tests together. Command outcomes are handled in
  `command-execution.ts`.
- Persist a lifecycle state change and its task event in one transaction; publish
  to `sseHub` only after commit. Every event has a `taskId`.
- Avoid speculative implementation abstractions. Boundary contracts and
  deliberate seams such as `TaskRunner` and `TaskServicePort` are allowed when
  they enforce dependency direction or enable a planned replacement. Do not
  add a `SandboxRuntime` interface until a second runtime implementation exists.

## Working method

1. Inspect the implementation, tests, and callers before editing.
2. Make the smallest coherent change that fixes the root problem.
3. Add or update tests for changed behavior.
4. Run the narrowest relevant checks first, then broader checks.
5. Review the final diff for unrelated changes.

For bug fixes, reproduce the failure with a test when practical, verify the
expected failing reason, implement the fix, and run the regression checks.
Test observable behavior rather than implementation details.

## Commits

Commit messages must be specific, detailed, and production-level: describe the
intent, affected behavior or scope, important implementation decisions, and
verification. Use a precise Conventional Commit subject and a body when the
change needs context; do not use generic messages such as “update docs” or
“fix stuff.”

When Codex or Claude contributes to a commit, include the corresponding
`Co-authored-by` trailer. When both contribute, include both:

- `Co-authored-by: Codex <codex@openai.com>`
- `Co-authored-by: Claude Sonnet 5 <noreply@anthropic.com>`

## Commands

Run from the repository root:

- `npm test` — DB-independent test suite, including HTTP route/API tests.
- `npm test -- tests/<file>.test.ts` — targeted test.
- `npm run test:runtime` — reserved for `tests/runtime/**/*.test.ts`; that
  directory is currently absent, so this command exits with “No test files
  found” and must not be reported as a passing check until runtime tests return.
- `BASE_URL=http://localhost:3000 scripts/acceptance/task-service-atomic-mvp.sh`
  — end-to-end acceptance harness. It requires the API, Postgres, and Docker
  to be running, plus `jq`, `curl`, `git`, `timeout`, and POSIX shell tools.
- `npm run typecheck` — TypeScript check.
- `npm run lint` — ESLint.
- `npm run build` — typecheck and production bundle.
- `npm run dev` — development server in watch mode.

Run `npm run prisma:migrate:dev` for schema changes; do not substitute a
different command without explaining why the documented command failed.

## Safety boundaries

Do not read, expose, or commit secret values; do not modify secret-bearing
`.env` files. `.env.example` is a tracked public template and should be updated
when the public configuration contract changes. Do not weaken tests/lint/type
checks, rewrite Git history, or commit, push, merge, or publish unless asked.
Ask before adding production dependencies or running destructive database or
infrastructure commands.

## Out of scope

Unless a task explicitly says otherwise, this service does not implement the
agent loop, GitHub integration, LLM/provider credentials, authentication, or
queues. The dashboard frontend is a separate app in `frontend/`; see
`docs/modules/frontend/README.md`.

## Definition of done

A task is complete when the requested behavior is implemented, relevant tests
and checks pass, required documentation is updated, and the final report states
what changed, commands actually run, and any remaining risks or skipped checks.

Keep detailed architecture, workflows, and personal communication preferences
in their appropriate documentation, skills, or global instructions instead of
growing this file.
