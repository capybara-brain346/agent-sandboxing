# Documentation Index

## Product

- [Agent Sandboxing Project](agent-sandboxing-project.md) — product direction,
  scope, and broader architecture.

## Module guides

- [Chat Session Service](modules/chat-session/README.md) — the product
  boundary: repo-scoped chat, messages, runs, the orchestrator-worker
  harness, artifacts, and session/run SSE APIs.
- [Sandbox Service](modules/sandbox-service/README.md) — session-owned
  sandbox runtime, diff capture, and execution-plane behavior.
- [Event Service](modules/event-service/README.md) — event persistence,
  replay, and Server-Sent Events delivery.
- [Agent Service](modules/agent-service/README.md) — agent runner, tools, and
  tool-event relay.
- [Task Run Runtime](modules/task-service/README.md) — shared execution
  runtime consumed by the chat-session harness, and the retired `/tasks` API
  history.
- [Frontend](modules/frontend/README.md) — chat workspace architecture and
  public backend contract usage.

## Planning

- [GitHub and PR flow plan](planning/github-pr-flow-plan.md)
- [Repo-scoped chat session agent harness Phase 0 decisions](planning/repo-scoped-chat-session-agent-harness-phase-0-decision-record.md)
- [Repo-scoped chat session agent harness plan](planning/repo-scoped-chat-session-agent-harness-plan.md)
- [Orchestrator and subagent eval plan](planning/orchestrator-subagent-eval-plan.md)
- [Container lifecycle TTL upgrade plan](planning/container-lifecycle-ttl-upgrade-plan.md)
- [Task Service Atomic MVP plan](planning/task-service-atomic-mvp-plan.md)
- [Sandbox Service Atomic MVP plan](planning/sandbox-service-atomic-mvp-plan.md)
- [Agent Service Atomic MVP plan](planning/agent-service-atomic-mvp-plan.md)
- [Task Service plan prompt](planning/task-service-plan-prompt.md)
