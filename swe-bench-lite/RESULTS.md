# Exploratory SWE-bench Lite result

## Observed result

The direct official SWE-bench harness resolved 9 of 24 submitted patches:

| Metric                         | Value |
| ------------------------------ | ----: |
| Submitted predictions          |    24 |
| Completed official evaluations |    24 |
| Resolved                       |     9 |
| Unresolved                     |    15 |
| Resolved rate                  | 37.5% |
| Completion yield               | 37.5% |
| Infrastructure failures        |     0 |
| Timeouts                       |     0 |

The evaluator used `openrouter:deepseek/deepseek-v4-flash`, the pinned
`SWE-bench/SWE-bench_Lite` test revision
`b0dde1093fe417d83b7184254edf8199c1f0dff5`, and the official
`swebench.harness.run_evaluation` Docker harness.

The direct harness report is written outside the repository at
`/tmp/swe-bench-direct-batch-1789029504872/openrouter:deepseek__deepseek-v4-flash.direct-1789029504872.json`.

## Interpretation

This is an exploratory partial test-subset result, not a SWE-bench Lite
leaderboard result. The intended 23-task development cohort was not run.
Instead, a 50-task test manifest was started and stopped after 24 completed
tasks. The manifest was then narrowed to those completed task IDs before
grading. The tasks are an alphabetical, Django-heavy slice rather than a
pre-registered random or full 300-task Lite sample.

Do not extrapolate this result to 300 tasks or report it as a full SWE-bench
Lite score. The defensible claim is: "Resolved 9 of 24 exploratory SWE-bench
Lite test tasks with the official harness."

## Resume-safe framing

This is appropriate evidence of evaluation and harness engineering, not a
competitive SWE-bench score. A resume may say: "Built and officially evaluated
a coding-agent system on 24 exploratory SWE-bench Lite test tasks, resolving 9
end-to-end with zero infrastructure failures or timeouts." It must retain the
"exploratory" qualifier and must not be presented as a full 300-task Lite
measurement or leaderboard result.

## Grading note

The repository `grade.ts` wrapper first classified every task as an official
harness failure without retaining a usable subprocess error. Replaying the
same predictions directly through the official harness completed all 24 tasks
and produced the result above.
