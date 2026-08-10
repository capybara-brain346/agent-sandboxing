# Agent Sandboxing Project Context

This repository is the monorepo/root workspace for the agent-sandboxing project. It will contain a frontend and multiple backend services, with each service or component in its own module/subdirectory.

Each module must have its own `AGENTS.md` containing service-specific instructions. The root `docs/` directory is the product and architecture source of truth. Before implementation, read [docs/agent-sandboxing-project.md](docs/agent-sandboxing-project.md) and the relevant files in `docs/planning/`.

Keep module documentation under `docs/modules/<module-name>/`. Do not mix services or introduce cross-module coupling unless the coupling is explicitly documented. The current active implementation focus is `sandbox-service`.

High-level architecture: this is a cloud coding agent platform. The first slice is the Sandbox Service plus its Event Store.

All implementation is expected to meet production-level engineering standards: strict, typed TypeScript; tests; database migrations; input and schema validation; robust error handling; observability; explicit security boundaries; no secrets in logs; Docker safety; and documented development, test, and operational commands.
