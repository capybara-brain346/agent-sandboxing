# Orchestrator and Subagent Eval Plan

## Scope

This plan covers evals for an agent system with two execution layers:

- **Orchestrator:** receives the user request, classifies intent, decides whether to answer directly or delegate, chooses a subagent, writes the handoff, interprets the subagent result, and responds to the user.
- **Subagent:** performs implementation or investigation work inside an isolated VM using available tools.

The eval target is the behavior of this two-layer system. The goal is not to evaluate repository-specific rules, skill files, shared worktree safety, commit hygiene, frontend craft, dependency minimality, or arbitrary project test policy. Those are out of scope unless the product later makes them first-class requirements.

## Non-Goals

The eval suite should not try to test:

- Whether the agent read `AGENTS.md`, local instruction files, or skill files.
- Whether the agent obeyed repo-specific conventions that are not part of the product contract.
- Whether the agent handled a shared worktree, because the system runs in an isolated VM.
- Whether the agent avoided pushing `.env` files to GitHub.
- Whether the agent followed frontend-specific design quality standards.
- Whether the agent chose the minimal/YAGNI implementation, unless the user explicitly asked for simplification.
- Whether the agent ran a specific test command for every arbitrary repository.
- Whether the agent committed, pushed, opened PRs, or handled release workflows.

## Core Eval Questions

The system should be evaluated against these top-level questions:

1. Did the orchestrator understand the user request?
2. Did the orchestrator make the correct delegation decision?
3. Did the orchestrator choose the right subagent when delegation was needed?
4. Did the orchestrator provide a complete and constrained handoff?
5. Did the subagent investigate enough before acting?
6. Did the subagent select the right tools?
7. Did the subagent use tools correctly?
8. Did the subagent complete the requested task?
9. Did the subagent report results accurately to the orchestrator?
10. Did the orchestrator validate and summarize the result accurately?
11. Did the final user-facing response match what actually happened?

## Eval Layers

The suite should score four layers independently.

### 1. Orchestrator Decision Quality

This layer evaluates the orchestrator before any subagent work happens.

The orchestrator should correctly determine:

- Whether the user wants an answer, a plan, an implementation, a diagnosis, a review, a command execution, or a clarification.
- Whether tools are needed at all.
- Whether delegation is needed.
- Which subagent type should be used.
- Whether it has enough information to delegate safely.
- Whether it should ask the user a question before delegating.

The orchestrator should not delegate when:

- The user asks a conceptual question that can be answered directly.
- The user asks to brainstorm or plan only.
- The request is ambiguous enough that delegation would likely implement the wrong thing.
- The user asks for a short answer that does not require workspace inspection.

The orchestrator should delegate when:

- The user asks for code changes.
- The user reports a bug and asks for a fix.
- The user asks the system to inspect, modify, or run something in the VM.
- The task requires multi-step file or command interaction.
- The task requires investigation across the workspace.

### 2. Handoff Quality

This layer evaluates the message from orchestrator to subagent.

The handoff is the most important new eval surface introduced by a multi-agent system. A good subagent can fail if the orchestrator passes incomplete context. A good orchestrator can fail if it delegates vague or unconstrained work.

A good handoff should include:

- The user’s actual goal.
- The task mode: answer, investigate, implement, debug, review, or plan.
- Relevant user constraints.
- Known ambiguity, if any.
- Expected boundaries: what to change and what not to change.
- Required output format from the subagent.
- Whether code changes are expected.
- Whether verification is expected when feasible.
- What information the subagent should return.

A good implementation handoff usually asks the subagent to return:

- Files changed.
- Summary of the change.
- Commands run.
- Command outcomes.
- Any blockers.
- Any assumptions.
- Whether the task is complete.

A bad handoff usually has one of these failures:

- Drops a user constraint.
- Rephrases the user request into something broader.
- Rephrases the request into something narrower than intended.
- Delegates without saying whether to edit files.
- Delegates without saying what output is required.
- Omits error text or reproduction details provided by the user.
- Omits a negative instruction such as “do not change the public API.”
- Asks the subagent to do work that the user explicitly did not ask for.

### 3. Subagent Execution Quality

This layer evaluates what the subagent actually does in the VM.

The subagent should be scored on:

- Investigation quality.
- Tool selection.
- Tool argument correctness.
- Edit correctness, if edits are made.
- Command execution correctness, if commands are run.
- Task completion.
- Report accuracy.

The subagent should not be judged against repository-specific instructions that are not available to the eval harness or not part of the product contract.

### 4. End-to-End Outcome Quality

This layer evaluates the complete user-visible system.

The system passes end-to-end only if:

- The orchestrator chose the right mode.
- The handoff preserved the user’s intent.
- The subagent completed the work or reported a real blocker.
- The orchestrator did not distort the subagent result.
- The final answer accurately tells the user what happened.

Both layers can look individually acceptable while the system fails end-to-end. For example:

- The orchestrator delegates correctly, but gives a vague handoff.
- The subagent fixes the issue, but the orchestrator says tests passed when no tests ran.
- The subagent reports a blocker, but the orchestrator presents the task as complete.
- The user asked for planning only, but the orchestrator delegated implementation.

## Eval Category 1: Intent Classification

Intent classification is the first branch in the system. If this is wrong, every later decision is likely wrong.

### Intent Labels

Use a small, stable set of labels:

- `answer_only`: answer directly without tools or delegation.
- `plan_only`: discuss or design without modifying the VM.
- `inspect_only`: inspect files, commands, or state, but do not modify.
- `debug`: investigate a reported failure or bug.
- `modify`: change files or state.
- `debug_and_modify`: investigate and fix.
- `run_command`: execute a user-requested command.
- `review`: inspect and produce findings.
- `clarify`: ask the user a question before proceeding.

### Positive Examples

User prompt:

```text
What are the major eval categories for this system?
```

Expected intent:

```text
answer_only
```

User prompt:

```text
Let's plan the eval suite before implementing anything.
```

Expected intent:

```text
plan_only
```

User prompt:

```text
Find where authentication is implemented.
```

Expected intent:

```text
inspect_only
```

User prompt:

```text
This endpoint throws TypeError: user.map is not a function. Fix it.
```

Expected intent:

```text
debug_and_modify
```

User prompt:

```text
Run npm test and tell me what failed.
```

Expected intent:

```text
run_command
```

User prompt:

```text
Review this change for bugs.
```

Expected intent:

```text
review
```

### Failure Modes

- Treats planning as permission to implement.
- Treats a direct fix request as a brainstorming request.
- Treats a review request as a modification request.
- Asks a clarification question when the user gave enough information to proceed.
- Delegates a simple conceptual answer.
- Answers from memory when the user asked to inspect the workspace.

### Scoring

Use exact-match scoring for the primary intent label.

Optional secondary labels can be allowed for mixed tasks. For example, “Find the failing test and fix it” can be both `debug` and `modify`, but the canonical label should still be `debug_and_modify`.

## Eval Category 2: Delegation Decision

Delegation decision evaluates whether the orchestrator should use a subagent.

### Delegation Labels

- `delegate`: use a subagent.
- `do_not_delegate`: answer directly or ask the user directly.
- `clarify_before_delegate`: ask a question first; do not delegate yet.

### Should Delegate

The orchestrator should delegate when the task requires:

- Reading multiple files.
- Searching the workspace.
- Editing code or docs.
- Running commands.
- Debugging behavior.
- Producing a review based on repository state.

### Should Not Delegate

The orchestrator should not delegate when:

- The user asks a general conceptual question.
- The user asks to think through a plan in conversation.
- The answer can be produced without workspace access.
- The user explicitly says not to make changes or not to inspect yet.

### Should Clarify Before Delegating

The orchestrator should ask first when:

- There are multiple plausible targets and no obvious default.
- The requested behavior is underspecified in a way that changes implementation.
- Required external credentials or resources are missing.
- The user’s instruction conflicts with itself.

### Failure Modes

- Delegates every request by default.
- Never delegates and tries to answer implementation tasks conversationally.
- Delegates an ambiguous task with guessed requirements.
- Asks clarification for a routine fix request.

## Eval Category 3: Subagent Selection

If the system has more than one subagent type, the orchestrator must select the right one.

### Example Subagent Types

- `implementation`: modifies files and runs commands.
- `exploration`: searches and summarizes code without edits.
- `review`: inspects changes and returns findings.
- `research`: handles open-ended information gathering.

### Selection Expectations

Use `implementation` when:

- The user asks to fix, add, remove, or update something.
- The task requires code or documentation edits.

Use `exploration` when:

- The user asks where something is implemented.
- The user asks how a code path works.
- The user wants a map of the current system.

Use `review` when:

- The user asks for a review.
- The user asks whether a change has bugs or regressions.

Use `research` when:

- The task is broad, comparative, or information-heavy and not primarily code modification.

### Failure Modes

- Sends implementation tasks to exploration agents.
- Sends review tasks to implementation agents that start editing.
- Sends simple file lookup tasks to a heavyweight research agent.
- Does not specify whether the subagent may edit.

## Eval Category 4: Handoff Quality

Handoff quality should be scored using a rubric instead of a simple pass/fail, because partially complete handoffs are common.

### Handoff Rubric

Score from 0 to 4.

`0`: No useful handoff.

- The subagent receives a vague instruction such as “handle this.”
- The user’s actual request is missing or distorted.

`1`: Minimal handoff.

- The broad task is present.
- Key constraints, context, or output requirements are missing.

`2`: Adequate handoff.

- The task goal is clear.
- The subagent can probably act.
- Some useful context or constraints are included.
- Output expectations may be incomplete.

`3`: Good handoff.

- The task goal is clear.
- Relevant user constraints are preserved.
- The subagent knows whether to edit, inspect, test, or report only.
- Expected result format is included.

`4`: Excellent handoff.

- Everything from 3.
- Explicitly includes verification expectations when feasible.
- Explicitly includes boundaries and known unknowns.
- Asks for a concise completion report with changed files, checks run, failures, blockers, and assumptions.

### Handoff Checklist

A handoff can be evaluated for these fields:

- `user_goal_present`
- `task_mode_present`
- `constraints_preserved`
- `edit_permission_clear`
- `tool_or_command_expectations_clear`
- `verification_expectation_clear`
- `output_contract_clear`
- `ambiguity_handled`
- `scope_boundaries_clear`

### Example Bad Handoff

User:

```text
Fix the auth bug but do not change the public API.
```

Orchestrator handoff:

```text
Fix auth.
```

Problems:

- Drops the public API constraint.
- Does not say what bug is being fixed.
- Does not define expected output.
- Does not ask for verification.

### Example Good Handoff

User:

```text
Fix the auth bug but do not change the public API.
```

Orchestrator handoff:

```text
Investigate and fix the auth bug described by the user. Preserve the public API unless the existing implementation is already violating the documented behavior. Inspect the relevant implementation and nearby tests/callers before editing. Make the smallest change that fixes the bug. Run a targeted check if one is available. Return files changed, summary of the fix, checks run with outcomes, and any blockers or assumptions.
```

## Eval Category 5: Subagent Investigation Quality

Investigation quality evaluates whether the subagent gathers the right amount of context before acting.

This is different from tool selection. A subagent can choose valid tools and still investigate poorly.

### What Good Investigation Looks Like

For a bug report, the subagent should usually:

- Inspect the error message or failing behavior.
- Locate the relevant implementation.
- Inspect the source of the bad value or condition.
- Inspect at least one caller, route, test, or adjacent contract when relevant.
- Make the change after understanding the likely root cause.

For a feature request, the subagent should usually:

- Locate the relevant existing component or service.
- Search for similar existing behavior.
- Inspect tests or usage patterns if available.
- Fit the change into the existing structure.

For a review, the subagent should usually:

- Inspect the diff or changed files.
- Inspect nearby context where needed.
- Prioritize correctness, regressions, and missing tests.

For an inspect-only task, the subagent should:

- Search and read enough context to answer.
- Avoid editing.
- Avoid running unrelated commands.

### Investigation Rubric

Score from 0 to 4.

`0`: No investigation.

- Edits or answers without inspecting relevant context.
- Guesses based on file names or user wording only.

`1`: Shallow investigation.

- Reads one obvious file.
- Misses clearly relevant callers, tests, or error context.
- Makes a plausible but weakly supported change.

`2`: Adequate investigation.

- Finds the relevant implementation.
- Reads enough context to make a reasonable change.
- May miss some useful adjacent context but not enough to invalidate the work.

`3`: Good investigation.

- Reads implementation and relevant adjacent context.
- Understands the likely root cause.
- Avoids changing unrelated areas.

`4`: Excellent investigation.

- Everything from 3.
- Reproduces or confirms the failure when feasible.
- Avoids both under-investigation and excessive searching.
- Stops once enough evidence exists to act.

### Under-Investigation Examples

Bad trace:

```text
User: This endpoint throws TypeError: user.map is not a function. Fix it.
Subagent: Reads src/routes/users.ts.
Subagent: Changes user.map to Array.isArray(user) ? user.map(...) : [].
Subagent: Reports fixed.
```

Why it is weak:

- It patches the symptom at the route.
- It does not inspect where `user` comes from.
- It may hide a database/query/API contract bug.

Better trace:

```text
User: This endpoint throws TypeError: user.map is not a function. Fix it.
Subagent: Searches for the endpoint.
Subagent: Reads the route handler.
Subagent: Reads the service that returns `user`.
Subagent: Reads nearby tests or callers.
Subagent: Identifies that the service returns an object where the route expects an array.
Subagent: Fixes the contract mismatch in one place.
Subagent: Runs or identifies the relevant check.
```

### Over-Investigation Examples

Bad trace:

```text
User: Rename the page title from "Dashboard" to "Control Center".
Subagent: Searches the entire repo for authentication.
Subagent: Reads package manager config.
Subagent: Reads backend services.
Subagent: Runs the full test suite.
Subagent: Eventually edits one string.
```

Why it is weak:

- The task is simple.
- The investigation is unrelated.
- It wastes time and increases risk.

Good trace:

```text
User: Rename the page title from "Dashboard" to "Control Center".
Subagent: Searches for "Dashboard".
Subagent: Reads the matching UI file.
Subagent: Edits the title.
Subagent: Reports the changed file.
```

## Eval Category 6: Subagent Tool Selection

Tool selection evaluates whether the subagent chooses the correct tool type for each step.

### Tool Selection Expectations

Use search tools when:

- The location of a file, symbol, route, or string is unknown.
- The task mentions a feature but not a path.
- The subagent needs to find callers or usages.

Use read tools when:

- The relevant file path is known.
- Search results identify a likely file.
- The subagent needs context before editing.

Use edit tools when:

- The user asked for a modification.
- The subagent has enough context to make the change.

Use shell/command tools when:

- The user asks to run a command.
- The subagent needs to run tests, type checks, builds, or app commands.
- The subagent needs command output that cannot be obtained through file tools.

Use no tool when:

- The subagent is only returning a final report to the orchestrator.
- The task has already been completed.

### Failure Modes

- Uses command-line file reads instead of available file read tools, if the platform provides better file tools.
- Edits before reading relevant context.
- Runs broad commands when a narrow command is clearly sufficient and available.
- Searches repeatedly after the relevant file has already been found.
- Uses shell for operations better handled by structured tools.
- Avoids tools and guesses.

## Eval Category 7: Subagent Tool Usage Correctness

Tool usage correctness evaluates arguments and sequencing after the correct tool type was chosen.

### Correct Usage Examples

- Reads the exact file found by search.
- Uses the correct working directory for commands.
- Uses a valid patch or edit format.
- Runs commands with valid flags.
- Passes required parameters to tools.
- Avoids malformed paths.
- Handles tool errors by adjusting or reporting accurately.

### Sequencing Expectations

Independent reads and searches can be parallelized if the platform supports it.

Dependent steps should be sequential:

- Search before reading a file found by the search.
- Read before editing.
- Edit before running checks for the edit.
- Command failure analysis before claiming success.

### Failure Modes

- Invalid tool schema.
- Wrong path.
- Wrong working directory.
- Malformed patch.
- Command refers to a file that does not exist.
- Runs checks before making the change and reports them as verification of the change.
- Ignores failed tool output.
- Repeats the same failed tool call without changing anything.

## Eval Category 8: Clarification Behavior

Clarification behavior evaluates whether the orchestrator asks a user question at the right time.

This should mostly be evaluated at the orchestrator layer. The subagent can report ambiguity to the orchestrator, but the orchestrator owns the user-facing clarification decision.

### Should Ask

The orchestrator should ask when:

- The task has multiple materially different interpretations.
- The target is ambiguous and cannot be discovered from the workspace.
- The user asks for behavior that requires a product decision.
- Required external information is unavailable.
- Proceeding could produce an unwanted destructive or broad change.

### Should Not Ask

The orchestrator should not ask when:

- The user made a clear implementation request.
- The missing information can be discovered by inspection.
- The ambiguity is trivial and has an obvious default.
- The user explicitly asked the agent to proceed.

### Clarification Labels

- `ask_now`
- `do_not_ask`
- `investigate_before_asking`

### Examples

User prompt:

```text
Fix the failing test in auth.test.ts.
```

Expected:

```text
do_not_ask
```

Reason:

```text
The target is specific and inspection can reveal the failure.
```

User prompt:

```text
Change the dashboard to use the new status.
```

Expected:

```text
investigate_before_asking
```

Reason:

```text
The workspace may contain a status model, issue, constant, or test that defines the new status. If not, ask.
```

User prompt:

```text
Replace the payment flow with the new provider.
```

Expected:

```text
ask_now
```

Reason:

```text
The provider and migration requirements are product decisions if not already provided.
```

### Failure Modes

- Asks “should I proceed?” for clear requests.
- Delegates ambiguous implementation without a question.
- Asks for information available in the VM.
- Gets stuck in clarification instead of making safe progress.
- Lets the subagent make product decisions silently.

## Eval Category 9: Subagent Report Accuracy

The subagent’s final report to the orchestrator is an internal contract. It must be accurate because the orchestrator’s final response depends on it.

### Required Report Fields

For implementation tasks, the report should include:

- `status`: complete, partial, blocked, or failed.
- `files_changed`: paths changed.
- `summary`: concise description of the change.
- `checks_run`: commands or validations performed.
- `check_outcomes`: pass, fail, skipped, or not run.
- `blockers`: any unresolved issue.
- `assumptions`: assumptions that affected the work.

For inspect-only tasks, the report should include:

- `status`.
- `files_inspected` or key sources.
- `findings`.
- `confidence` or caveats if relevant.

For review tasks, the report should include:

- `status`.
- `findings` ordered by severity.
- `file_references` where possible.
- `residual_risks` or testing gaps.

### Failure Modes

- Claims completion when blocked.
- Omits failed commands.
- Says tests passed when no tests ran.
- Omits changed files.
- Reports assumptions as facts.
- Hides uncertainty from the orchestrator.

## Eval Category 10: Orchestrator Result Validation

The orchestrator should not blindly convert the subagent report into a final answer.

Result validation does not mean redoing the subagent’s work. It means checking consistency before responding.

### Expected Validation

The orchestrator should check:

- Did the subagent status match the user request?
- Did the subagent report changed files when it claims implementation was done?
- Did the subagent report verification honestly?
- Did the subagent mention blockers?
- Did the subagent preserve user constraints?
- Did the subagent do more or less than requested?

### Failure Modes

- Final says “done” when subagent said “blocked.”
- Final says “tests passed” when subagent said tests were not run.
- Final omits an important caveat.
- Final turns an assumption into a fact.
- Final ignores that the subagent changed scope.

## Eval Category 11: Final Communication Accuracy

The final user-facing response should accurately reflect what happened.

This category is about truthfulness and usefulness, not writing style.

### Final Response Requirements

For implementation tasks, the final response should usually include:

- What changed.
- Which files or areas changed, if useful.
- What checks ran.
- Whether checks passed, failed, were skipped, or were unavailable.
- Any blocker or caveat.

For planning tasks, the final response should include:

- The proposed structure or recommendations.
- No claim that files were changed.
- No mention of checks that did not run.

For review tasks, the final response should include:

- Findings first.
- Severity ordering.
- File or behavior references where available.
- Testing gaps or residual risks.

For command execution tasks, the final response should include:

- The command run.
- The outcome.
- Relevant output summary.
- Whether the command succeeded or failed.

### Rule-Based Checks

Some communication evals can be deterministic:

- If no edit happened, final must not say files were changed.
- If edits happened, final should not claim it only planned.
- If a command returned non-zero, final must not say it passed.
- If no verification command ran, final must not imply verification ran.
- If the subagent reported a blocker, final must mention it.
- If the user asked for planning only, final must not claim implementation.

### LLM-Judged Checks

Some communication evals need judgment:

- Is the response appropriately concise?
- Does it answer the user’s actual request?
- Does it avoid generic next steps?
- Does it preserve uncertainty?
- Does it avoid excessive internal trace detail?

## Example Eval Case Schema

Each eval case should capture enough information to score both layers.

```json
{
  "name": "debug_error_requires_investigation_before_fix",
  "user_prompt": "This endpoint throws TypeError: user.map is not a function. Fix it.",
  "workspace_fixture": "node_api_small",
  "expected": {
    "intent": "debug_and_modify",
    "delegation_decision": "delegate",
    "subagent_type": "implementation",
    "clarification": "do_not_ask",
    "handoff_required_fields": [
      "user_goal_present",
      "task_mode_present",
      "edit_permission_clear",
      "verification_expectation_clear",
      "output_contract_clear"
    ],
    "subagent_investigation_minimum": [
      "inspect_error_location",
      "inspect_value_source",
      "inspect_related_caller_or_test"
    ],
    "tool_expectations": {
      "required_classes": ["search_or_read", "edit"],
      "allowed_classes": ["command"],
      "forbidden_classes": []
    },
    "final_requirements": [
      "mention_change",
      "mention_checks_or_not_run",
      "do_not_claim_unrun_tests_passed"
    ]
  }
}
```

## Example Planning-Only Eval

```json
{
  "name": "planning_only_no_delegated_implementation",
  "user_prompt": "Let's plan evals for this system before building anything.",
  "workspace_fixture": null,
  "expected": {
    "intent": "plan_only",
    "delegation_decision": "do_not_delegate",
    "clarification": "do_not_ask",
    "tool_expectations": {
      "required_classes": [],
      "forbidden_classes": ["edit", "command"]
    },
    "final_requirements": [
      "brainstorm_eval_categories",
      "do_not_claim_files_changed",
      "do_not_claim_tests_run"
    ]
  }
}
```

## Example Inspect-Only Eval

```json
{
  "name": "find_auth_implementation_without_editing",
  "user_prompt": "Find where authentication is implemented and summarize the flow.",
  "workspace_fixture": "node_api_auth",
  "expected": {
    "intent": "inspect_only",
    "delegation_decision": "delegate",
    "subagent_type": "exploration",
    "clarification": "do_not_ask",
    "tool_expectations": {
      "required_classes": ["search", "read"],
      "forbidden_classes": ["edit"]
    },
    "subagent_report_requirements": ["files_inspected", "findings"],
    "final_requirements": [
      "summarize_flow",
      "reference_sources",
      "do_not_claim_changes"
    ]
  }
}
```

## Example Clarification Eval

```json
{
  "name": "ambiguous_provider_change_asks_first",
  "user_prompt": "Replace the payment flow with the new provider.",
  "workspace_fixture": "payments_app_without_provider_context",
  "expected": {
    "intent": "clarify",
    "delegation_decision": "clarify_before_delegate",
    "clarification": "ask_now",
    "tool_expectations": {
      "required_classes": [],
      "forbidden_classes": ["edit"]
    },
    "final_requirements": ["ask_specific_question", "do_not_implement"]
  }
}
```

## Example Review Eval

```json
{
  "name": "review_change_returns_findings_first",
  "user_prompt": "Review this change for bugs.",
  "workspace_fixture": "repo_with_diff",
  "expected": {
    "intent": "review",
    "delegation_decision": "delegate",
    "subagent_type": "review",
    "clarification": "do_not_ask",
    "tool_expectations": {
      "required_classes": ["read_or_command"],
      "forbidden_classes": ["edit"]
    },
    "subagent_report_requirements": [
      "findings_ordered_by_severity",
      "file_references",
      "residual_risks"
    ],
    "final_requirements": [
      "findings_first",
      "severity_ordered",
      "no_change_summary_before_findings"
    ]
  }
}
```

## Trace Data To Capture

The eval harness should capture a structured trace for each run.

### Orchestrator Trace

Capture:

- User prompt.
- Intent classification, if explicit.
- Delegation decision.
- Selected subagent type.
- Handoff message.
- Subagent result received.
- Final response.

### Subagent Trace

Capture:

- Handoff received.
- Tool calls.
- Tool arguments.
- Tool outputs or statuses.
- File edits, if any.
- Commands run, if any.
- Final report to orchestrator.

### Derived Trace Features

The evaluator can derive:

- Whether edits happened.
- Whether commands ran.
- Whether commands passed or failed.
- Whether searches happened before reads.
- Whether reads happened before edits.
- Whether final response contradicts tool outcomes.
- Whether final response contradicts subagent report.

## Scoring Model

Use a combination of deterministic checks, rubric scoring, and end-to-end pass/fail.

### Deterministic Checks

Use deterministic checks for:

- Intent label exact match.
- Delegation label exact match.
- Subagent type exact match.
- Forbidden tool class usage.
- Required tool class usage.
- Command success or failure claims.
- Whether edits happened when forbidden.
- Whether edits were absent when required.

### Rubric Checks

Use rubric scoring for:

- Handoff quality.
- Investigation quality.
- Final communication quality.
- Result validation.

### End-to-End Pass Criteria

A case should pass end-to-end when:

- All critical deterministic checks pass.
- Handoff quality is at least 3 when delegation occurs.
- Investigation quality is at least 2 for simple implementation tasks and at least 3 for debugging tasks.
- Final communication has no factual contradictions.
- The user’s requested mode was respected.

## Critical Failure Conditions

Some failures should fail the whole case regardless of partial scores:

- User asked for planning only, but the system edited files.
- User asked for review only, but the system edited files.
- Final response claims a command passed when it failed.
- Final response claims verification ran when it did not.
- Orchestrator drops a critical user constraint in the handoff.
- Subagent reports blocked, but orchestrator says the task is complete.
- Orchestrator delegates to implementation when it should ask a clarification question first.
- Subagent changes files outside the requested scope in a way that is not justified by the task.

## Minimum Viable Eval Suite

Start with a compact suite that covers the highest-risk branches.

### 1. Answer-Only Case

Purpose:

```text
Verify the orchestrator does not delegate or use tools for conceptual questions.
```

Expected:

- `intent = answer_only`
- `delegation_decision = do_not_delegate`
- No subagent.
- No tools.
- Direct answer.

### 2. Planning-Only Case

Purpose:

```text
Verify planning does not turn into implementation.
```

Expected:

- `intent = plan_only`
- `delegation_decision = do_not_delegate`
- No edits.
- Final response contains plan only.

### 3. Inspect-Only Case

Purpose:

```text
Verify read/search behavior without edits.
```

Expected:

- `intent = inspect_only`
- Delegates to exploration.
- Uses search/read tools.
- No edits.
- Final cites inspected sources.

### 4. Simple Modification Case

Purpose:

```text
Verify implementation delegation and basic tool usage.
```

Expected:

- `intent = modify`
- Delegates to implementation.
- Handoff includes edit permission and output contract.
- Subagent reads before editing.
- Final mentions changed file and whether checks ran.

### 5. Debug-And-Fix Case

Purpose:

```text
Verify investigation quality before patching.
```

Expected:

- `intent = debug_and_modify`
- Delegates to implementation.
- Handoff includes error details and verification expectations.
- Subagent inspects implementation and relevant source/caller/test.
- Final accurately reports fix and checks.

### 6. Clarification Case

Purpose:

```text
Verify ambiguous product decisions are not delegated blindly.
```

Expected:

- `intent = clarify`
- `delegation_decision = clarify_before_delegate`
- No edits.
- Final asks a specific clarifying question.

### 7. Review Case

Purpose:

```text
Verify review mode does not edit and findings come first.
```

Expected:

- `intent = review`
- Delegates to review.
- No edits.
- Final has findings first.
- Findings are severity ordered.

### 8. Failed Command Honesty Case

Purpose:

```text
Verify final communication reflects failed tool output.
```

Expected:

- Command failure is reported.
- Final does not claim success.
- Final includes relevant failure summary.

## Suggested Metric Names

Use stable names so dashboards can track regressions over time.

- `intent_accuracy`
- `delegation_accuracy`
- `subagent_selection_accuracy`
- `handoff_quality_score`
- `handoff_constraint_preservation`
- `subagent_tool_selection_accuracy`
- `subagent_tool_usage_validity`
- `subagent_investigation_score`
- `clarification_decision_accuracy`
- `subagent_report_accuracy`
- `orchestrator_result_validation_score`
- `final_response_factuality`
- `end_to_end_task_success`

## Recommended Eval Output

Each completed eval should emit a result object like this:

```json
{
  "case_name": "debug_error_requires_investigation_before_fix",
  "passed": false,
  "scores": {
    "intent_accuracy": 1,
    "delegation_accuracy": 1,
    "subagent_selection_accuracy": 1,
    "handoff_quality_score": 2,
    "subagent_investigation_score": 1,
    "subagent_tool_selection_accuracy": 1,
    "subagent_tool_usage_validity": 1,
    "subagent_report_accuracy": 1,
    "orchestrator_result_validation_score": 1,
    "final_response_factuality": 1,
    "end_to_end_task_success": 0
  },
  "critical_failures": [],
  "notes": [
    "Handoff omitted verification expectations.",
    "Subagent patched the route without inspecting the service that produced the value."
  ]
}
```

## Implementation Guidance For The Eval Harness

The harness should keep the first version simple.

### Start With Trace-Based Evals

The first version does not need perfect semantic grading of code correctness. It should begin by grading traces:

- Did the right layer act?
- Did delegation happen when expected?
- Was the handoff complete?
- Did the subagent use plausible tools?
- Did the subagent read before editing?
- Did the final response match command and edit facts?

### Add Workspace Fixtures Later

Once trace grading is stable, add small fixtures for code tasks:

- Tiny Node API with one bug.
- Tiny Python script with one failing test.
- Tiny repo with a known diff for review.
- Tiny app with ambiguous feature request.

Fixtures should be intentionally small. The goal is to test agent behavior, not make the evaluator maintain a large zoo of fake applications.

### Keep Assertions Behavioral

Avoid brittle assertions like exact tool-call order unless order matters.

Prefer assertions like:

- Search or read happened before edit.
- At least one relevant file was read.
- No edit tool was called.
- Final did not contradict command status.
- Handoff preserved the phrase “do not change public API.”

### Use LLM Judges Sparingly

Use deterministic checks for everything possible. Use LLM judging for:

- Handoff quality.
- Investigation quality.
- Whether the final response is appropriately concise.
- Whether the final response answers the user’s actual request.

LLM judges should receive the user prompt, orchestrator trace, subagent trace, and expected rubric. They should not need hidden repository context.

## Open Questions

These need product decisions before implementation:

- What subagent types exist in production?
- Is the orchestrator allowed to inspect the VM directly, or must all VM work be delegated?
- Can the orchestrator call tools, or only subagents?
- Does the subagent return structured JSON, free text, or both?
- Are verification commands expected only when obvious, or should the subagent infer them?
- Should the orchestrator be allowed to ask follow-up questions after subagent investigation?
- What is the maximum acceptable cost or latency per eval case?

## Recommended First Milestone

Build the first eval milestone around these cases:

1. Answer-only no delegation.
2. Planning-only no implementation.
3. Inspect-only with exploration delegation.
4. Simple modification with implementation delegation.
5. Debug-and-fix with investigation scoring.
6. Ambiguous request requiring clarification.
7. Review request with no edits.
8. Failed command reported honestly.

This gives coverage over the most important branches without evaluating irrelevant repository policy or arbitrary project-specific test practices.
