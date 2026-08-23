# Repository Operating Guide

## Scope

These instructions apply to the repository. More specific `AGENTS.md` files
in subdirectories override them.

Read relevant package/config files and the applicable service guide indexed in
`docs/README.md` before changing a component:

- Before making changes, always use the project-local Ponytail skill.
- Code must not contain comments, except required interpreter or compiler
  directives.
- Documentation index: `docs/README.md`.

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
- `prompts/` — versioned system prompt YAML files, loaded via
  `src/prompts/load-prompt.ts`; not under `src/` so the same
  `process.cwd()`-relative path resolves in both `tsx` dev and the
  esbuild-bundled production build.
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

## Working method

1. Inspect the implementation, tests, and callers before editing.
2. Make the smallest coherent change that fixes the root problem.
3. Add or update tests for changed behavior.
4. Run the narrowest relevant checks first, then broader checks.
5. Review the final diff for unrelated changes.
6. When removing behavior or an abstraction, remove its dead adapters, imports,
   tests, and documentation references in the same change.

For bug fixes, reproduce the failure with a test when practical, verify the
expected failing reason, implement the fix, and run the regression checks.
Test observable behavior rather than implementation details.

## Commits

Commit messages must be specific, detailed, and production-level: describe the
intent, affected behavior or scope, important implementation decisions, and
verification. Use a precise Conventional Commit subject and a body when the
change needs context; do not use generic messages such as “update docs” or
“fix stuff.”

## Commands

Run from the repository root:

- `npm test` — DB-independent test suite, including HTTP route/API tests.
- `npm test -- tests/<file>.test.ts` — targeted test.
- `npm run test:runtime` — reserved for `tests/runtime/**/*.test.ts`; that
  directory is currently absent, so this command exits with “No test files
  found” and must not be reported as a passing check until runtime tests return.
- `BASE_URL=http://localhost:3000 scripts/acceptance/chat-session-atomic-mvp.sh`
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

Keep detailed architecture, workflows, and personal communication preferences
in their appropriate documentation, skills, or global instructions instead of
growing this file.
