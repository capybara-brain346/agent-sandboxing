from django.core.management.base import BaseCommand, CommandError
from django.db.models import Q

from api.evaluation.judge import Judge
from api.observability_models import GoldenGraph, JudgeEvaluation, LLMCallLog


class Command(BaseCommand):
    help = "Run batch evaluations on LLM calls using Gemini judge"

    def add_arguments(self, parser):
        parser.add_argument(
            "--sample-size",
            type=int,
            default=100,
            help="Number of recent calls to sample (default: 100)",
        )
        parser.add_argument(
            "--include-golden",
            action="store_true",
            help="Always include golden graph calls in evaluation",
        )
        parser.add_argument(
            "--unevaluated-only",
            action="store_true",
            default=True,
            help="Only evaluate calls without existing evaluations (default: True)",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show what would be evaluated without actually running",
        )

    def handle(self, *args, **options):
        sample_size = options["sample_size"]
        include_golden = options["include_golden"]
        unevaluated_only = options["unevaluated_only"]
        dry_run = options["dry_run"]

        judge = Judge()

        if not judge.is_available():
            raise CommandError(
                "Judge API not available. Please set GEMINI_API_KEY in environment."
            )

        self.stdout.write(self.style.NOTICE(f"Fetching LLM calls for evaluation..."))

        calls = LLMCallLog.objects.all()

        if unevaluated_only:
            calls = calls.filter(evaluations__isnull=True)

        calls = calls.exclude(Q(error__isnull=False) & ~Q(error=""))

        recent_calls = list(calls.order_by("-timestamp")[:sample_size])

        golden_calls = []
        if include_golden:
            golden_hashes = GoldenGraph.objects.filter(is_active=True).values_list(
                "graph_hash", flat=True
            )
            golden_calls = list(
                LLMCallLog.objects.filter(graph_hash__in=golden_hashes)
                .exclude(pk__in=[c.pk for c in recent_calls])
                .order_by("-timestamp")[:20]
            )

        all_calls = recent_calls + golden_calls
        total_count = len(all_calls)

        self.stdout.write(
            self.style.SUCCESS(
                f"Found {total_count} calls to evaluate "
                f"({len(recent_calls)} recent, {len(golden_calls)} golden)"
            )
        )

        if dry_run:
            self.stdout.write(self.style.WARNING("Dry run - no evaluations performed"))
            for call in all_calls[:10]:
                self.stdout.write(f"  - {call.call_id} ({call.endpoint_name})")
            if total_count > 10:
                self.stdout.write(f"  ... and {total_count - 10} more")
            return

        success_count = 0
        error_count = 0

        for i, call in enumerate(all_calls, 1):
            self.stdout.write(f"[{i}/{total_count}] Evaluating {call.call_id}...")

            system_prompt = (
                f"Model: {call.model_name}, Version: {call.system_prompt_version}"
            )

            result = judge.evaluate(
                graph_json=call.graph_json,
                system_prompt=system_prompt,
                model_response=call.response_text,
            )

            if result.get("success"):
                JudgeEvaluation.objects.create(
                    llm_call=call,
                    graph_fidelity_score=result["graph_fidelity_score"],
                    logical_correctness_score=result["logical_correctness_score"],
                    instruction_adherence_score=result["instruction_adherence_score"],
                    hallucination_flag=result["hallucination_flag"],
                    notes=result.get("notes", ""),
                    evaluation_latency_ms=result.get("latency_ms"),
                )
                success_count += 1
                self.stdout.write(
                    self.style.SUCCESS(
                        f"  ✓ Fidelity: {result['graph_fidelity_score']}, "
                        f"Correctness: {result['logical_correctness_score']}, "
                        f"Adherence: {result['instruction_adherence_score']}"
                    )
                )
            else:
                error_count += 1
                self.stdout.write(
                    self.style.ERROR(f"  ✗ Error: {result.get('error', 'Unknown')}")
                )

        self.stdout.write("")
        self.stdout.write(
            self.style.SUCCESS(
                f"Evaluation complete: {success_count} successful, {error_count} failed"
            )
        )
