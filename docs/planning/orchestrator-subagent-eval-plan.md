# Orchestrator and CodeWorker Eval Plan

## High-level summary

Build local, repo-owned LLM evals before adding any external evaluation platform.
The first version should answer one question: did the model make the right
decision and, when delegated, did it produce the right code change with a useful
final answer?

Use two eval families:

- Dataset-based evals for isolated orchestrator decisions that do not need a
  sandbox or repository.
- Repo-based evals for real CodeWorker behavior against small fixture
  repositories.

Omit Langfuse for the first implementation. Write JSONL results locally, print a
small terminal report, and fail the command when agreed thresholds are not met.
Langfuse can be added later as a reporting and comparison sink after the local
loop is stable.

## First principles

### Evaluate the LLM, not the platform

These evals should measure model behavior: routing, delegation, task success,
tool-use judgment, minimality, verification, blocker honesty, and final response
quality. Sandbox provisioning, SSE replay, database transactions, route status
codes, artifact persistence, and Docker lifecycle remain normal unit,
integration, or acceptance tests.

### Keep failures diagnosable

Each eval case should have one primary intent. A failing routing case should
point to the orchestrator prompt/model. A failing repo case should point to the
worker prompt/model, tool strategy, or task difficulty. Avoid mixing platform
assertions into LLM scorecards because they make failures ambiguous.

### Prefer deterministic scoring first

Use exact, reproducible checks wherever possible: expected delegation count,
terminal status, changed files, required diff content, forbidden diff content,
required commands, and blocked/completed classification. Add LLM-as-judge only
after deterministic scoring leaves important subjective gaps.

### Start with a small real repo

The first repo fixture should be a small Python package, not a collection of
unrelated scripts. A package gives realistic coding tasks, test commands, docs,
CLI behavior, imports, and edge cases while staying cheap enough for repeated
runs.

### Local first, portable later

The eval runner should work from the repository with npm scripts and local JSONL
output. It should not require hosted services, dashboards, or credentials beyond
the model key already needed for live agent runs.

## Eval families

### Dataset-based evals

Dataset evals exercise the orchestrator without a real sandbox. They provide a
synthetic `OrchestratorContext`, a user message, and, when needed, a fake worker
result. They measure whether the orchestrator should answer directly, ask for
clarification, delegate, retry a blocked worker, or stop after failure.

Initial dataset categories:

- Direct answer: questions about prior work or repo context that should not edit
  files.
- Clarification: ambiguous requests that should ask a follow-up question instead
  of delegating.
- Delegation: concrete code requests that should delegate exactly once.
- Blocked retry: first worker attempt returns `blocked`; orchestrator retries
  once with a narrower correction brief.
- Failed terminal: worker returns `failed`; orchestrator does not retry and the
  run fails safely.
- Context use: orchestrator uses summary, recent messages, tool activity, and
  workspace hints without dumping raw history into the worker brief.

Dataset scoring criteria:

- `routing_correct`: expected direct, clarify, delegate, blocked, or failed
  behavior occurred.
- `delegation_count_ok`: actual delegations matched the expected range.
- `clarification_present`: clarification cases contain a concrete question.
- `brief_contains_task`: delegated brief includes the actionable task.
- `brief_uses_context`: delegated brief includes relevant summary or workspace
  hints when expected.
- `brief_omits_raw_transcript`: delegated brief does not copy the full chat
  transcript.
- `response_grounded`: direct responses do not claim edits, tests, or file facts
  not present in context.

### Repo-based evals

Repo evals run the real chat-session, orchestrator, CodeWorker, and sandbox path
against a copied fixture repository. They measure whether the worker can inspect,
edit, verify, and summarize code changes.

The first fixture should be `python-mini`, a small package with this shape:

```text
pyproject.toml
README.md
src/acme_tools/__init__.py
src/acme_tools/math_utils.py
src/acme_tools/text_utils.py
src/acme_tools/config.py
src/acme_tools/cli.py
tests/test_math_utils.py
tests/test_text_utils.py
tests/test_config.py
tests/test_cli.py
```

Initial repo categories:

- Simple edit: append exact README text, change CLI help, change a default, or
  add a small utility.
- Bug fix: off-by-one math bug, bad string normalization, wrong exception type,
  environment precedence bug, or CLI parsing bug.
- Verification: fix a failing test and report the command used.
- Follow-up: use prior session context and changed-file hints to continue work.
- Blocked or impossible: missing external API key, contradictory request, or
  request outside the available repo.

Repo scoring criteria:

- `status_correct`: terminal run status matches expectation.
- `routing_correct`: delegation expectation matches actual behavior.
- `changed_files_correct`: changed files are exactly or safely within the
  expected allowlist.
- `diff_contains_required`: required diff snippets are present.
- `diff_avoids_forbidden`: forbidden files or snippets are absent.
- `tests_run`: required verification commands were run or an acceptable blocker
  was reported.
- `task_success`: deterministic case-specific checks passed.
- `minimality`: no unrelated churn, generated files, formatting-only rewrites,
  or broad refactors.
- `final_response_quality`: final answer accurately states what changed, what
  was verified, and any blockers.
- `blocker_honesty`: blocked cases identify a real blocker and do not pretend
  success.

## Proposed local structure

```text
tests/evals/
  cases/
    dataset.jsonl
    repo.jsonl
  fixtures/
    python-mini/
  results/
  run-dataset-evals.ts
  run-repo-evals.ts
  subjective-judge.ts
  scorers.ts
  types.ts
```

Suggested npm scripts:

```json
{
  "eval:dataset": "tsx tests/evals/run-dataset-evals.ts",
  "eval:dataset:judge": "tsx tests/evals/run-dataset-evals.ts --judge",
  "eval:repo": "tsx tests/evals/run-repo-evals.ts",
  "eval:repo:judge": "tsx tests/evals/run-repo-evals.ts --judge",
  "eval": "npm run eval:dataset && npm run eval:repo",
  "eval:judge": "npm run eval:dataset:judge && npm run eval:repo:judge"
}
```

## Case schemas

Dataset case:

```json
{
  "id": "routing-ambiguous-make-it-better",
  "suite": "routing",
  "input": {
    "summary": "",
    "recentMessages": [{ "role": "user", "content": "Make it better." }],
    "recentToolActivity": [],
    "workspace": {
      "hasPriorRun": false,
      "lastRunStatus": null,
      "lastRunSummary": null,
      "changedFilesHint": []
    },
    "message": "Make it better."
  },
  "expect": {
    "decision": "clarify",
    "shouldDelegate": false,
    "maxDelegations": 0
  }
}
```

Repo case:

```json
{
  "id": "python-mini-fix-normalize-slug",
  "suite": "python-mini",
  "fixture": "python-mini",
  "messages": [
    {
      "role": "user",
      "content": "Fix normalize_slug so repeated spaces collapse to a single dash. Verify it."
    }
  ],
  "expect": {
    "runStatus": "completed",
    "shouldDelegate": true,
    "changedFiles": [
      "src/acme_tools/text_utils.py",
      "tests/test_text_utils.py"
    ],
    "diffMustContain": ["normalize_slug", "pytest"],
    "diffMustNotContain": ["pyproject.toml"],
    "requiredTests": ["pytest"],
    "maxDelegations": 1
  }
}
```

## Output schema

Each eval run should append one JSON object per case:

```json
{
  "caseId": "python-mini-fix-normalize-slug",
  "suite": "python-mini",
  "status": "passed",
  "scores": {
    "status_correct": 1,
    "routing_correct": 1,
    "changed_files_correct": 1,
    "diff_contains_required": 1,
    "diff_avoids_forbidden": 1,
    "tests_run": 1,
    "task_success": 1,
    "minimality": 1,
    "final_response_quality": 1
  },
  "observed": {
    "runStatus": "completed",
    "delegationCount": 1,
    "changedFiles": ["src/acme_tools/text_utils.py"],
    "testsRun": ["pytest"],
    "finalMessage": "Fixed normalize_slug and verified with pytest."
  }
}
```

## Phase 1: dataset eval smoke suite

Goal: prove the local eval runner can call the orchestrator model, capture its
decision, and score routing behavior without Docker or a real repo.

Implementation steps:

1. Add `tests/evals/cases/dataset.jsonl` with 10 cases.
2. Add a small runner that constructs `ModelOrchestratorAgent` inputs directly.
3. Use a fake `delegate` callback that records briefs and returns configured
   `WorkerResult` objects.
4. Score routing, delegation count, clarification presence, and brief content.
5. Write `tests/evals/results/dataset-<timestamp>.jsonl`.
6. Print a compact pass/fail table and exit nonzero on threshold failure.

Initial threshold:

```text
dataset suite passes when every case passes routing_correct and delegation_count_ok
```

## Phase 2: python-mini fixture repo

Goal: create one realistic but small Python package fixture for repo-based evals.

Implementation steps:

1. Add `tests/evals/fixtures/python-mini` as a normal Python package.
2. Include intentional, documented bugs only through eval cases, not comments in
   source files.
3. Keep tests fast and runnable with `python -m pytest`.
4. Ensure the fixture is a git repository when copied into the sandbox path used
   by existing session provisioning.
5. Add 10 repo cases that cover simple edits, bug fixes, verification,
   follow-up, and blocked behavior.

Initial repo case mix:

- 2 routing or explanation tasks over the repo.
- 3 simple edits.
- 3 bug fixes.
- 1 follow-up task.
- 1 blocked or impossible task.

## Phase 3: repo eval runner

Goal: run the real chat-session path against copied fixture repositories and
score model behavior from run results, diffs, worker reports, and tool events.

Implementation steps:

1. For each case, copy the fixture to a temporary directory.
2. Create a chat session that points at the copied fixture repo.
3. Send case messages through the public chat-session API or service seam.
4. Poll until the run reaches a terminal state.
5. Fetch run result, diff artifact pointer or stored diff, assistant message,
   and run events.
6. Derive changed files from the diff.
7. Score deterministic criteria.
8. Append one JSONL result per case and print a suite summary.

Initial threshold:

```text
repo suite passes when at least 8 of 10 cases pass and no case fails diff_avoids_forbidden
```

## Phase 4: score hardening

Goal: make scores harder to game and easier to debug.

Implementation steps:

1. Add case-specific post-run commands where needed, such as focused pytest
   invocations against the modified repo.
2. Add per-case file allowlists and forbidden snippets.
3. Add final response checks for test reporting and blocker honesty.
4. Add retry-safe result files that include enough observed data to debug a
   failure without rerunning immediately.
5. Keep all scorer logic deterministic.

Expanded threshold:

```text
dataset pass rate >= 95%
repo pass rate >= 90%
required deterministic safety checks = 100%
```

## Phase 5: subjective judge, optional (implemented)

Goal: add model-judged scores only for dimensions deterministic checks cannot
cover well.

Candidate judge scores:

- `task_success_1_to_5`
- `minimality_1_to_5`
- `verification_quality_1_to_5`
- `response_quality_1_to_5`
- `blocker_honesty_1_to_5`

Do not gate on these until a small human-labeled calibration set exists. The
first judge implementation should report scores only.

The report-only implementation is available through `--judge` on either eval
runner, or through `npm run eval:dataset:judge`, `npm run eval:repo:judge`, and
`npm run eval:judge`. It reuses `AGENT_MODEL`, sends only task/context/outcome
evidence to a strict structured-output judge, appends `subjectiveJudge` scores
to each result record, and never changes deterministic status or suite gating.
Judge failures are recorded as report errors so they can be retried with
`--resume` without turning subjective scores into a gate.

## Phase 6: larger repos

Goal: add size and complexity after the Python mini suite is useful.

Progression:

1. Medium Python package with nested modules, fixtures, and typing.
2. JavaScript or TypeScript package to exercise a second ecosystem.
3. Larger repo snapshot with many files to test search, context selection, and
   minimality under noise.

Do not add a large repo before the small suite has stable scoring. A large repo
without reliable scoring only makes failures slower and less actionable.

## Out of scope for the first implementation

- Langfuse datasets, experiments, evaluators, or hosted dashboards.
- CI gating for full live repo evals.
- Multi-repo tasks.
- Browser/UI evals.
- Performance benchmarking.
- Scoring sandbox, SSE, database, or artifact implementation details as LLM
  quality.

## Definition of done for MVP

- `npm run eval:dataset` runs 10 local dataset cases and fails on routing
  regressions.
- `npm run eval:repo` runs 10 repo cases against `python-mini` and writes JSONL
  results.
- The terminal report shows case ID, pass/fail, failed score names, delegation
  count, changed files, and tests run.
- At least one failed case can be debugged from its JSONL result without reading
  platform logs.
- No external evaluation service is required.
