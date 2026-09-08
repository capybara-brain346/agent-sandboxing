# SWE-bench Lite evaluator

This is an evaluation-only harness. It selects tasks from the pinned
`SWE-bench/SWE-bench_Lite` `dev` or `test` split, checks out each exact base
commit, wraps the official task image, drives the public chat-session API and
SSE, and sends persisted `SessionResult.diff` values to the official grader.

The agent receives only the task ID, repository, base commit, and problem
statement. Gold patches, test patches, fail-to-pass cases, pass-to-pass cases,
and grader output are never sent through the chat session.

## Setup

Use an isolated Python environment for the pinned evaluator dependencies:

```sh
python3 -m venv .venv-swe-bench
. .venv-swe-bench/bin/activate
python -m pip install -r swe-bench-lite/requirements.txt
```

The host needs Docker with enough capacity for both the agent sandbox and the
official grader. The official guidance recommends at least 120 GB free disk,
16 GB RAM, and 8 CPU cores. The API stack must be running with PostgreSQL,
Docker socket access, fixture repositories enabled, `AUTH_COOKIE_SECRET`, and
`OPENROUTER_API_KEY`.

Start the app with the test-only Compose override after preparing the task
manifest so the dedicated fixture mount exists:

```sh
npm run eval:swe-bench-lite:prepare -- --instance-id <dev-instance-id>
docker compose -f docker-compose.yml -f docker-compose.e2e.yml up --build
```

The dataset revision is pinned in `prepare.py` and can be replaced only by an
explicit `--revision` or `SWE_BENCH_DATASET_REVISION` value. Select one or more
task IDs with repeated `--instance-id` flags or
`SWE_BENCH_INSTANCE_IDS=owner__repo-1,owner__repo-2`.

## Phase 1 commands

Prepare a scrubbed task manifest:

```sh
npm run eval:swe-bench-lite:prepare -- --instance-id <dev-instance-id>
```

Run the selected tasks sequentially. Each task gets a fresh fixture and public
session, and every task receives one attempt record and one prediction record.
The command pulls the official task image, builds and verifies the agent
wrapper, checks the session sandbox contract, and writes patches from the
persisted result:

```sh
BASE_URL=http://localhost:3000 npm run eval:swe-bench-lite:predict
```

Submit predictions with a newly generated official run ID:

```sh
npm run eval:swe-bench-lite:grade
```

Set `SWE_BENCH_PREDICTIONS_PATH` to grade a particular prediction file or
`SWE_BENCH_OFFICIAL_RUN_ID` to name a run. Reusing a run ID for a changed
prediction is rejected because the official harness caches by run ID and task.
The grader materializes the exact manifest revision into its isolated official
results directory; hidden task fields never enter the agent manifest or API.

## Artifacts and limits

Generated fixtures, predictions, attempts, manifests, Docker build output, and
official logs stay under `swe-bench-lite/.data/`:

```text
tasks/swe-bench-lite-dev.jsonl
fixtures/<attempt>/repo/
runs/<experiment-id>/manifest.json
runs/<experiment-id>/attempts.jsonl
runs/<experiment-id>/summary.json
runs/<experiment-id>/predictions.jsonl
runs/<experiment-id>/official-results/
```

The fixture is deleted after each attempt and the sandbox container is removed.
The report retains setup, API, provider, session, no-patch, and grader failures
instead of silently omitting them. Attempt status is diagnostic only; only the
official grader classifications determine resolution.

The evaluator does not modify `src/`, production prompts, Prisma, sandbox
runtime semantics, or the existing CapyNodes E2E evaluator.

## Phase 2 development cohort

Prepare the complete pinned development cohort with one manifest record per
task:

```sh
npm run eval:swe-bench-lite:prepare -- --all
```

Run the cohort with the fixed settings in the generated experiment manifest.
Without `SWE_BENCH_INSTANCE_IDS`, the predictor processes every manifest task
sequentially and records exactly one terminal attempt and one prediction for
each task, including setup, provider, session, and no-patch failures:

```sh
BASE_URL=http://localhost:3000 npm run eval:swe-bench-lite:predict
```

Each experiment retains `summary.json` beside `attempts.jsonl`. The summary
contains the task, attempt, prediction, submitted, no-patch, setup-failure,
provider-failure, and session-failure counts. Grade that prediction file only
after the complete cohort run:

```sh
npm run eval:swe-bench-lite:grade
```

Phase 2 results are diagnostic development-cohort results. They must not be
used to tune the agent before the pinned Lite test measurement in Phase 3.

## Phase 3 Lite test measurement

Freeze the model, prompt and tool digests, step limit, timeout, retry policy,
machine resources, cache condition, wrapper image digests, and complete test
task ID list in the experiment manifest. Prepare the complete pinned test
split:

```sh
npm run eval:swe-bench-lite:prepare -- --split test --all
```

Start the API with the fixed production-like settings, then run the complete
test manifest once. Test prediction rejects partial manifests and refuses to
reuse an experiment ID, so every task receives one fresh fixture and one
public chat session:

```sh
SWE_BENCH_SPLIT=test BASE_URL=http://localhost:3000 npm run eval:swe-bench-lite:predict
SWE_BENCH_SPLIT=test npm run eval:swe-bench-lite:grade
```

Do not tune the agent from the test results. The official `grade.json` reports
the pinned manifest count, submitted predictions, all recorded attempts,
no-patch count, setup/provider/session failures, official harness failures,
timeouts, per-task outcomes, and these exact ratios:

```text
resolved_pct = official_resolved / submitted_predictions
completion_yield_pct = official_resolved / all_recorded_attempts
```

The current public `SessionResult` does not expose provider cost. The report
therefore records `estimated_usd: null` and `cost_source: unavailable` instead
of inventing a cost; attach provider or trace billing data separately when
publishing the measurement.
