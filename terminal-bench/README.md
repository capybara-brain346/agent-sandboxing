# Terminal-Bench evaluator

This evaluation-only directory records reproducible Terminal-Bench 4.0.0 run
settings. It does not start the application, Prisma, Docker sandbox service, or
session persistence.

## Setup

Install the pinned Harbor CLI outside the application dependency tree. Harbor
0.23.0 is required because Terminal-Bench 4.0.0 uses separate verifier
containers:

```sh
python3 -m venv .venv-terminal-bench
. .venv-terminal-bench/bin/activate
python -m pip install -r terminal-bench/requirements.txt
```

Set `OPENROUTER_API_KEY` and retain the same `AGENT_MODEL` used by the run.

## Phase 0 compatibility spike

Build the evaluation-only Node entrypoint, then run Harbor's oracle and the
agent on the same Terminal-Bench development task. The build executes the
bundle in `node:18.20.4-alpine` before Harbor runs. Both commands require the
task's dataset task name; short names such as `bun-sourcemap-leak` are expanded
to `terminal-bench/bun-sourcemap-leak`:

```sh
npm run eval:terminal-bench:build-agent
npm run eval:terminal-bench:oracle -- <task-name>
npm run eval:terminal-bench:run -- <task-name>
```

`eval:terminal-bench:run` bundles the existing `AgentRunner`, loads
`agent:TerminalBenchAgent` through Harbor's custom-agent import path, uploads
that runner, versioned prompts, and tool profile to Harbor's task container,
installs the task image's `nodejs` package, and executes it as Harbor's
configured agent user. The local runtime
executes commands in Harbor's task working directory. It translates the
existing `/workspace/repo` tool path to that directory, applies the configured
tool timeout, and shares the configured command output byte limit between
stdout and stderr. It does not use Docker, Prisma, events, or production
session state.

The adapter uses the `main` tool profile, the versioned session-agent prompt,
and the existing OpenRouter configuration. It writes the final safe runner
result, duration, and model usage JSON to the Harbor agent log directory.
`OPENROUTER_API_KEY` is supplied only to the evaluation task agent process.

## Phase 1 manifest

Create a fresh run manifest before invoking Harbor:

```sh
npm run eval:terminal-bench:prepare
```

The command writes `terminal-bench/.data/runs/<id>/manifest.json`. Set
`TERMINAL_BENCH_RUN_ID` to choose an ID. It rejects an existing ID so a run
cannot be overwritten.

The manifest pins the dataset, repository commit, OpenRouter model route,
prompt and tool-profile SHA-256 digests, step and timeout limits, retry policy,
Harbor version and environment provider, and requested resources. Configure
resources with `TERMINAL_BENCH_CPUS`, `TERMINAL_BENCH_MEMORY_MB`,
`TERMINAL_BENCH_GPUS`, and `TERMINAL_BENCH_CONCURRENCY`. Configure the task
limit with `TERMINAL_BENCH_TASK_TIMEOUT_SECONDS`.

Generated manifests, Harbor jobs, trials, and task artifacts are ignored by
Git.

## Phase 2 reporting

After a Harbor job completes, parse its job and trial results into the run
manifest directory:

```sh
npm run eval:terminal-bench:report -- \
  --job terminal-bench/.data/jobs/<job> \
  --output terminal-bench/.data/runs/<id>/summary.json
```

The reporter reads trial `result.json`, `agent/trajectory.json`, and verifier
outputs. It records attempted, resolved, and unresolved counts, the exact
resolved ratio, separate setup/provider/agent/timeout/verifier failures, model
costs when Harbor reports them, unavailable compute cost unless the environment
provider reports billing data, and artifact paths for failed tasks. A verifier
reward of zero is unresolved, not a verifier execution failure. Infrastructure
failures remain in their own categories.

## Phase 3 validation and rollout

Run the five-task sequential smoke suite before freezing a measurement. For
each task, it runs Harbor's oracle immediately followed by the harness:
`bun-sourcemap-leak`, `cargo-flight-dispatch`, `html-js-filter`,
`nextjs-performance`, and `wal-recovery-ordering`:

```sh
npm run eval:terminal-bench:smoke
```

Inspect the resulting Harbor trajectories and verifier logs. To freeze and run
the full 66-task measurement sequentially, choose a new run ID and run:

```sh
export TERMINAL_BENCH_RUN_ID=terminal-bench-v4-<date>
npm run eval:terminal-bench:rollout
npm run eval:terminal-bench:report -- \
  --run-id "$TERMINAL_BENCH_RUN_ID" \
  --job terminal-bench/.data/jobs/<job>
```

`rollout` creates the immutable manifest and invokes Harbor without a task
filter with `-k 1`. The resulting `manifest.json` and `summary.json` are the
published measurement record. Do not change prompt, profile, model, or limits
for that run; use a new run ID for development measurements.
