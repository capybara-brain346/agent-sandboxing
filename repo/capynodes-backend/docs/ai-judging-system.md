# AI-First Calibrated Judging System

## Why one-shot scoring fails

A single prompt that asks an AI to assign a score is fast, but it is hard to
calibrate and audit. It can overvalue fluent answers, miss required evidence,
change its standard between runs, and produce feedback that does not justify
the score. A confident-looking number is not a reliable evaluation record.

## Architecture

Use AI as the primary evaluator, constrained by explicit evidence and a
versioned rubric. Deterministic checks handle objective facts where practical;
the judge interprets the evidence packet against the rubric, and uncertainty
or disagreement can be escalated to a human.

### Evidence packet

Build a compact, immutable packet for each submission containing:

- the submission and relevant question/context;
- expected capabilities, rubric version, and scoring anchors;
- extracted artifacts (tests, outputs, tool calls, citations, and failures);
- deterministic check results and provenance for every artifact.

The judge may only claim what is supported by this packet. Missing evidence is
uncertainty, not implicit credit.

### Rubric-guided scoring

Score each criterion independently using observable anchors (for example,
missing, partial, and complete). Require an evidence reference and a short
rationale per criterion, then aggregate with explicit weights and caps. Keep
the numeric score separate from prose feedback so feedback cannot silently
change the grade.

## Judge passes and traces

Use a bounded sequence of passes:

1. **Scorer:** proposes criterion scores, evidence references, and confidence.
2. **Critic:** checks evidence coverage, rubric compliance, contradictions, and
   unsupported claims.
3. **Revision:** resolves valid criticisms and emits the final structured
   result; repeat only with a fixed maximum.

Persist judge traces, not chain-of-thought: prompts and versions, model/config,
evidence IDs, structured outputs, critic findings, revisions, confidence,
timestamps, and escalation decisions. Do not store private hidden reasoning or
ask the model to expose it.

## Calibration and evaluation

Maintain a small set of calibration examples spanning borderline, strong,
weak, adversarial, and incomplete submissions. Each example should include
the evidence packet, rubric-labelled score, acceptable rationale, and known
failure modes. Show a few relevant examples to the scorer when useful, but
keep the golden set held out from prompt tuning.

The golden eval dataset is the release gate: version it, review labels, and
measure criterion-level agreement, score drift, unsupported-claim rate,
confidence calibration, and escalation rate. Re-run it whenever the rubric,
prompt, model, aggregation logic, or evidence extraction changes.

## Confidence, escalation, and feedback

Confidence should reflect evidence quality and judge agreement, not just model
certainty. Escalate when evidence is missing or contradictory, a score is near
a decision boundary, scorer and critic disagree materially, or the case is
outside the calibrated distribution. Record the reason and the human outcome.

Return two separate products:

- **Score:** structured criterion scores, aggregate, rubric version, and
  confidence/escalation state.
- **Feedback:** actionable strengths, gaps, and next steps, each tied to
  evidence and a criterion.

## Phased implementation

1. **Baseline:** define the rubric schema, evidence packet, structured output,
   trace schema, and a hand-labelled calibration set.
2. **Pilot:** add scorer/critic/revision passes, deterministic checks, confidence
   thresholds, and persisted audit traces behind a feature flag.
3. **Calibrate:** build the golden dataset, inspect disagreement and drift, and
   tune prompts, anchors, thresholds, and aggregation using held-out results.
4. **Operate:** add monitoring, periodic relabelling, model/rubric versioning,
   human review queues, and rollback criteria.

## Prompt and dataset workflow

Version prompts beside the rubric. Generate or collect examples, construct
evidence packets, label scores and evidence links, review disagreements, and
split into calibration, development, and held-out golden data. Run the full
pipeline on every candidate change; compare structured metrics and sampled
traces; promote only when quality, calibration, cost, and latency meet their
thresholds. Log production cases for periodic error analysis, with privacy
controls and redaction before they enter any dataset.
