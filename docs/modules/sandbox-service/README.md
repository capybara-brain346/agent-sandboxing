# Sandbox Service

## Purpose

The Sandbox Service is the first execution-plane component of the cloud coding agent platform. It provides isolated sandbox execution and a durable Event Store for the atomic MVP.

## Read first

- `docs/agent-sandboxing-project.md` — product and architecture context
- `docs/planning/sandbox-service-atomic-mvp-plan.md` — active MVP boundaries and implementation plan

## Documentation location

Put future implementation notes, operational runbooks, API documentation, contract decisions, and troubleshooting guidance in this directory.

## Status

Atomic MVP initial slice implemented. The Sandbox Service now lives in the root TypeScript application under `src/routes/sandbox-service`, `src/services/sandbox-service`, and `src/types/sandbox-service`. It uses a local fixture repository and Docker containers; GitHub, auth, queues, and Task/Agent services are intentionally excluded.

## Development commands

From the repository root:

```bash
cp .env.example .env
npm install
npm run prisma:generate
docker compose up -d postgres
npm run prisma:migrate
npm run typecheck
npm test
npm run dev
```

The root Compose file runs migrations as a one-shot service before starting the app container:

```bash
docker compose build app
docker compose up db-migrate
docker compose up app
```

The API listens on `http://localhost:3000` by default. `POST /sandboxes` returns `202` while provisioning continues asynchronously. Provisioning copies the configured local fixture (default `./repo`) into `/workspace/repo`; spawned sandbox containers never receive the host fixture bind mount or Docker socket.

## API smoke flow

Create a git fixture in the repository root, then create and poll a sandbox:

```bash
mkdir -p repo && git -C repo init
git -C repo config user.email acceptance@example.test
git -C repo config user.name acceptance
printf 'hello\n' > repo/hello.txt && git -C repo add hello.txt && git -C repo commit -m fixture
curl -sS http://localhost:3000/health
curl -sS -X POST http://localhost:3000/sandboxes -H 'content-type: application/json' -d '{}'
curl -N 'http://localhost:3000/sandboxes/<sandboxId>/events?after=0'
```

Commands execute sequentially per sandbox, with validated workspace cwd/env, bounded output, timeout handling, durable command/event snapshots, and Docker resource limits. SSE is a delivery mechanism only: replay comes from `sandbox_events`, with `after` or `Last-Event-ID` cursors.

## Database and runtime boundaries

The Prisma migrations contain the partial unique index allowing only one `running` command per sandbox and database check constraints for positive timeouts, event sequences, non-negative output, and non-empty commands. A follow-up cleanup migration removes unused artifacts left by the initial draft migration without changing the API contract. `EventStore`, `DockerSandboxRuntime`, and `SseHub` are explicit replacement boundaries for future runtimes and delivery mechanisms.
