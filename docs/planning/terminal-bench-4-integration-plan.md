# Terminal-Bench 4.0 integration plan

## Decision and scope

Benchmark the agent harness: the session-agent prompt, `AgentRunner`, tool
profile, step limit, model, and command semantics.

Do not initially benchmark the Express API, Prisma, session persistence, or
Docker sandbox lifecycle. Harbor owns the task container; nesting the
production sandbox inside it would measure an adapter failure more than agent
capability.

Use `terminal-bench/terminal-bench@4.0.0`, DeepSeek V4 Flash through the
existing OpenRouter configuration, and one attempt per task.

## Phase 0: compatibility spike

1. Add an evaluation-only `terminal-bench/` directory and README.
2. Implement a Harbor `BaseInstalledAgent` adapter.
3. Install the smallest required Node runtime and bundled agent entrypoint into
   one Terminal-Bench development task container.
4. Add an evaluation-only local-process implementation of the existing
   `AgentToolRuntime` contract. It must execute as Harbor's agent user, use the
   task working directory, preserve tool timeout and output limits, and not use
   Docker or production session state.
5. Invoke the existing `AgentRunner` with the session-agent prompt, `main` tool
   profile, OpenRouter model configuration, no-op event persistence and
   publishing, and the Harbor task instruction.
6. Run Harbor's oracle once to validate the task, then run the adapter on one
   task and confirm that the agent changes the task workspace, Harbor's
   verifier scores the changes, and the adapter records result, duration,
   token usage, and safe failure output.

Stop if Terminal-Bench task environments cannot support the entrypoint without
changing production sandbox behavior. Do not change the production sandbox to
fit the benchmark.

## Phase 1: reproducible runs

Pin the following in one run manifest per job under
`terminal-bench/.data/runs/<id>/`:

- Terminal-Bench dataset and version
- repository commit
- model identifier and provider route
- prompt and tool-profile SHA-256 digests
- `AGENT_MAX_STEPS`, task timeout, tool timeout, and retry policy
- Harbor version and environment provider
- CPU, memory, GPU, and concurrency settings

Persist one record per task attempt with its task ID, attempt ID, verifier
reward and status, wall-clock duration, model input/output/cache token usage,
reported model cost, Harbor job and trial paths, and categorized setup,
provider, agent, timeout, and verifier failures.

Keep generated runs and task artifacts ignored by Git.

## Phase 2: reporting

Parse Harbor's job and trial `result.json`, trajectory, and verifier output.
Write `summary.json` containing:

- attempted, resolved, and unresolved task counts
- `resolved_pct = resolved / attempted`
- setup, provider, agent, timeout, and verifier failure counts
- total and per-task model cost where available
- compute cost as unavailable unless the environment provider returns billing
  data
- paths to failed trajectories and verifier logs

Do not collapse infrastructure failures into model failures.

## Phase 3: validation and rollout

1. Unit-test manifest validation, cost aggregation, result parsing, and failure
   classification.
2. Run Harbor oracle smoke tests on a small task set.
3. Run the harness on five representative tasks sequentially. Inspect
   trajectories, validate verifier delivery, and measure actual token and
   compute spend.
4. Freeze settings and run all 66 tasks with `-k 1`.
5. Publish the run manifest and summary. Do not tune against the frozen
   measurement; use a separate development run for prompt or tool changes.

## Expected changes

- Add `terminal-bench/README.md`, Harbor adapter, local runtime bridge, result
  parser and reporter, tests, and `.gitignore`.
- Add `eval:terminal-bench:*` commands to `package.json`.
- Update the root README and `docs/README.md`.
- Update `docs/modules/agent-service/README.md`, because `AgentRunner` gains
  an evaluation execution path.

The one-task compatibility spike is the first deliverable. It determines
whether Harbor can execute the runner faithfully before reporting work or a
66-task run.
