# Sandbox Service Instructions

## Scope and source documents

This module uses Express, TypeScript, Postgres, Prisma, Docker as the sandbox runtime, and SSE for event streaming. Read `docs/planning/sandbox-service-atomic-mvp-plan.md` before making implementation changes. Document module-specific implementation notes, runbooks, and behavior decisions under `docs/modules/sandbox-service/`.

This module implements only the Sandbox Service and Event Store. Do not implement or broaden into Task Service, GitHub integration, Agent Service, authentication, frontend work, or PR creation. Keep future-service boundaries narrow and documented.

## Repository and runtime boundaries

- Use a local fixture repository copy only: `./repo`, copied into the sandbox/container workspace at `/workspace/repo`.
- Keep the Docker adapter behind a safe, narrow boundary; never expose arbitrary Docker control to callers.
- Do not place the Docker socket inside sandbox containers.
- Run containers as non-root where practical, with explicit resource and time limits.
- Bound command output and protect the host and service from untrusted commands and input.

## Coding requirements

- Use strict TypeScript. Avoid `any` unless the use is justified and documented.
- Validate request, command, configuration, and persisted data schemas at boundaries.
- Apply Prisma migrations for every database schema change; do not rely on ad hoc production schema edits.
- Update state and durable events transactionally where they represent one operation.
- Preserve per-sandbox event sequence invariants and deterministic ordering.
- SSE replay must read persisted events from the database, never process memory as the source of truth.
- Return structured, safe errors and add structured observability without logging secrets or sensitive command data.
- Add or update tests and run the relevant verification commands for every behavior or contract change.
- Update the appropriate documentation under `docs/modules/sandbox-service/` when behavior or contracts change, and document useful commands.

Do not implement future services or expand this module's scope without an explicit, documented architecture decision.
