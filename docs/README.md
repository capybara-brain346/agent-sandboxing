# Documentation Index

## Product

- [Agent Sandboxing Project](agent-sandboxing-project.md) — product direction,
  scope, and broader architecture.

## Current Chat Invariant

A chat session owns one sandbox and one working branch. Each user message may
trigger processing in that same workspace. There is no run resource.

## Module guides

- [Chat Session Service](modules/chat-session/README.md) — the product
  boundary: repo-scoped chat, messages, message processing, artifacts, the
  single-agent harness, and session SSE APIs.
- [Sandbox Service](modules/sandbox-service/README.md) — session-owned
  sandbox runtime, diff capture, and execution-plane behavior.
- [Event Service](modules/event-service/README.md) — session event persistence,
  replay, and Server-Sent Events delivery.
- [Agent Service](modules/agent-service/README.md) — message processor, tools,
  and tool-event relay.
- [Retired Task Runtime](modules/task-service/README.md) — historical execution
  runtime reference.
- [Frontend](modules/frontend/README.md) — chat workspace architecture and
  public backend contract usage.

## Planning

- [GitHub and PR flow plan](planning/github-pr-flow-plan.md)
- [GitHub PR flow component 1 plan](planning/github-pr-flow-component-1-plan.md)
- [GitHub PR flow component 2 plan](planning/github-pr-flow-component-2-plan.md)
- [GitHub PR flow component 3 plan](planning/github-pr-flow-component-3-plan.md)
- [Remove run concept plan](planning/remove-run-concept-plan.md)
- [Repo-scoped chat session agent harness Phase 0 decisions](planning/repo-scoped-chat-session-agent-harness-phase-0-decision-record.md)
- [Repo-scoped chat session agent harness plan](planning/repo-scoped-chat-session-agent-harness-plan.md)
- [Single agent harness cutover plan](planning/single-agent-harness-cutover-plan.md)
- [Container lifecycle TTL upgrade plan](planning/container-lifecycle-ttl-upgrade-plan.md)
- [Task Service Atomic MVP plan](planning/task-service-atomic-mvp-plan.md)
- [Sandbox Service Atomic MVP plan](planning/sandbox-service-atomic-mvp-plan.md)
- [Agent Service Atomic MVP plan](planning/agent-service-atomic-mvp-plan.md)
- [Task Service plan prompt](planning/task-service-plan-prompt.md)
- [Evaluating Coding Agent Harnesses](research/evaluating-coding-agent-harnesses.md) — industry patterns, failure modes, and a practical eval stack for this project.
