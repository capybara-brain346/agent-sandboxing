import uuid

from django.db import models
from django.utils import timezone


class LLMCallLog(models.Model):
    call_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    timestamp = models.DateTimeField(default=timezone.now, db_index=True)
    endpoint_name = models.CharField(max_length=100, db_index=True)

    graph_json = models.JSONField()
    graph_hash = models.CharField(max_length=64, db_index=True)
    graph_schema_version = models.CharField(max_length=20, default="1.0")

    system_prompt_version = models.CharField(
        max_length=20, default="1.0", db_index=True
    )
    model_name = models.CharField(max_length=100, db_index=True)
    model_parameters = models.JSONField(default=dict)

    response_text = models.TextField(blank=True)
    token_usage = models.JSONField(default=dict)
    latency_ms = models.IntegerField(null=True, blank=True)
    finish_reason = models.CharField(max_length=50, blank=True)
    error = models.TextField(blank=True)

    class Meta:
        ordering = ["-timestamp"]
        verbose_name = "LLM Call Log"
        verbose_name_plural = "LLM Call Logs"
        indexes = [
            models.Index(fields=["model_name", "timestamp"]),
            models.Index(fields=["system_prompt_version", "timestamp"]),
        ]

    def __str__(self):
        return f"LLMCall {self.call_id} - {self.endpoint_name} ({self.timestamp})"


class GoldenGraph(models.Model):
    name = models.CharField(max_length=255, unique=True)
    description = models.TextField(blank=True)
    graph_json = models.JSONField()
    graph_hash = models.CharField(max_length=64, unique=True)
    expected_answer = models.TextField()
    baseline_score = models.FloatField(null=True, blank=True)
    is_active = models.BooleanField(default=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]
        verbose_name = "Golden Graph"
        verbose_name_plural = "Golden Graphs"

    def __str__(self):
        return self.name


class JudgeEvaluation(models.Model):
    llm_call = models.ForeignKey(
        LLMCallLog, on_delete=models.CASCADE, related_name="evaluations"
    )
    evaluated_at = models.DateTimeField(auto_now_add=True, db_index=True)

    graph_fidelity_score = models.IntegerField()
    logical_correctness_score = models.IntegerField()
    instruction_adherence_score = models.IntegerField()
    hallucination_flag = models.BooleanField()
    notes = models.TextField(blank=True)

    judge_model = models.CharField(max_length=100, default="gemini-3-flash-preview")
    evaluation_latency_ms = models.IntegerField(null=True, blank=True)

    class Meta:
        ordering = ["-evaluated_at"]
        verbose_name = "Judge Evaluation"
        verbose_name_plural = "Judge Evaluations"

    def __str__(self):
        return (
            f"Eval for {self.llm_call.call_id} - Fidelity: {self.graph_fidelity_score}"
        )

    @property
    def average_score(self) -> float:
        return (
            self.graph_fidelity_score
            + self.logical_correctness_score
            + self.instruction_adherence_score
        ) / 3.0
