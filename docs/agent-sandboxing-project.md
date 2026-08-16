# Agent Sandboxing Project

## Product Direction

Build a cloud coding agent system, not a standalone memory layer.

Core loop:

1. User connects GitHub.
2. User selects one repository.
3. User creates a bounded repo-scoped coding task.
4. System provisions an isolated sandbox.
5. Repo is cloned inside the sandbox from a known base branch/commit.
6. Agent works through sandbox-executed tools.
7. Frontend streams progress: messages, commands, logs, test results, diffs.
8. Agent verifies changes.
9. System creates a branch, pushes changes, opens a PR.
10. User sees final PR or a clear failed/blocked/cancelled state.

## Current Focus

Start with the task product boundary and its internal Sandbox Service.

Do not start with the full agent loop, memory, frontend polish, or GitHub auth flows. The key primitive is controlled execution: creating an isolated repo workspace, running commands, streaming output, and producing a diff.

## First Component: Sandbox Service

The Sandbox Service is the untrusted execution plane. The agent/control plane
stays outside the sandbox, and all supported sandboxes are owned by a task.

Responsibilities:

- create one Docker container per task
- inject task-scoped environment only
- clone the repo inside the container
- checkout selected base branch/commit
- create generated task branch
- expose task-level execution tools to Agent Service
- stream command output and structured events
- preserve working tree until result capture is complete
- clean up/expire container after terminal state

Sandbox receives only short-lived task-scoped GitHub installation tokens.

Sandbox must not receive:

- GitHub App private key
- LLM provider keys
- long-lived user credentials
- global backend secrets

## MVP Tool API

Expose narrow sandbox tools to the agent/platform:

- `run_command`
- `get_status`
- `get_diff`
- `read_file` if required by agent protocol
- `write_file` / `apply_patch` if required by agent protocol
- `stop_sandbox`

Do not expose raw Docker control to the agent.

## First API Slice

Task creation is the only public creation path. The public routes are:

- `POST /tasks`
- `GET /tasks/:taskId`
- `GET /tasks/:taskId/events`
- `GET /tasks/:taskId/result`
- `DELETE /tasks/:taskId`

Task creation atomically creates the task and its linked sandbox, then the
internal Sandbox Service provisions the container after commit. Sandbox and
command events are persisted on the task stream. There are intentionally no
public `/sandboxes/*` routes; future Agent Service tools call the internal
task-scoped Sandbox Service seam.

## Minimum Event Types

- `sandbox_created`
- `repo_clone_started`
- `repo_clone_completed`
- `repo_checkout_completed`
- `task_branch_created`
- `command_started`
- `command_output`
- `command_completed`
- `git_diff_updated`
- `sandbox_failed`
- `sandbox_stopped`

Structured events are required. Raw logs alone are insufficient for reliable frontend state, reconnect, debugging, and task lifecycle ownership.

## Sandbox Limits

MVP containers should enforce:

- maximum task runtime
- per-command timeout
- memory limit
- CPU limit if practical
- disk/workspace limit if practical

Network can remain enabled in MVP because installs/tests often need it. Later, make network policy configurable.

## Failure States

Sandbox failure includes:

- container could not start
- repo clone failed
- base commit could not be checked out
- command timed out
- container exited unexpectedly
- workspace unavailable
- git push failed due to auth/permission

## Important Architecture Decisions

### Agent outside sandbox

The agent is control plane. The sandbox is execution plane.

Reasons:

- protects prompts, LLM keys, and control logic
- limits sandbox secrets to short-lived task credentials
- improves event streaming and observability
- allows cancellation, timeouts, and future restart/resume
- keeps user-accessible execution separate from agent internals

### Docker for MVP

Use Docker containers for MVP, not VMs.

Docker is enough to prove the product loop with less infra cost and complexity. Keep the Sandbox Service contract generic so Docker can later be replaced by VM, microVM, Kubernetes pod, or hosted sandbox provider.

### Platform-managed clone

Initial clone, checkout, and task branch creation are platform-managed, not agent-managed.

Clone is deterministic environment setup, not agent work. The platform needs known repo, base branch, base commit, workspace path, and task branch before agent execution starts.

## MVP Exclusions

- memory
- multi-repo tasks
- persistent per-user VM
- browser preview
- LSP tools
- deployment automation
- parallel terminal sessions
- parallel subagents
- autonomous production monitoring
- arbitrary global chatbot mode

## Next Discussion Point

Define the Sandbox Service data model and lifecycle:

- sandbox states
- command states
- event schema
- container naming
- workspace path convention
- cleanup policy
- what gets persisted vs kept in memory
