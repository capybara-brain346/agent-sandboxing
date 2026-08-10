# Sandbox Service

The atomic MVP is an Express/TypeScript API backed by Postgres and Prisma. It copies a local fixture repository into a resource-limited Docker container, runs one command at a time, persists ordered lifecycle/output events, and exposes durable SSE replay.

## Development

```bash
cp .env.example .env
npm install
docker compose up -d postgres
npx prisma generate
npm run prisma:migrate
npm run dev
```

The default fixture path is `./repo` relative to the process working directory. The MVP intentionally does not accept GitHub URLs or tokens; `FIXTURE_REPO_PATH` is copied into `/workspace/repo` and never bind-mounted. Containers do not receive the Docker socket or platform secrets.

## API

`GET /health`, `POST /sandboxes`, `GET /sandboxes/:id`, `GET /sandboxes/:id/events` (SSE with `after` or `Last-Event-ID`), `POST /sandboxes/:id/commands`, `GET /sandboxes/:id/commands/:commandId`, `GET /sandboxes/:id/diff`, and `DELETE /sandboxes/:id` are implemented. Sandbox creation returns `202` while provisioning proceeds asynchronously; readiness/failure is durable in the snapshot and event stream.

Command requests are restricted to `/workspace/repo`, environment names are allowlisted, output is bounded, and one active command is enforced by a Postgres partial unique index.
