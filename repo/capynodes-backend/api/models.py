import hashlib
import secrets
from datetime import timedelta

from django.contrib.auth.models import User
from django.db import models
from django.utils import timezone


class UserProfile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="profile")
    bio = models.TextField(blank=True, null=True)
    avatar_url = models.URLField(blank=True, null=True)
    linkedin_url = models.URLField(blank=True, null=True)
    twitter_url = models.URLField(blank=True, null=True)
    github_url = models.URLField(blank=True, null=True)
    website_url = models.URLField(blank=True, null=True)
    total_score = models.IntegerField(default=0)
    problems_solved = models.IntegerField(default=0)
    email_verified = models.BooleanField(default=False, db_index=True)
    email_verified_at = models.DateTimeField(null=True, blank=True)
    onboarding_completed = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.user.username}'s Profile"

    def update_stats(self):
        from .stats_updater import update_user_stats

        stats = update_user_stats(self.user)
        self.total_score = stats.total_score
        self.problems_solved = stats.problems_solved
        self.save()
        return stats

    def get_analytics(self, stats=None):
        try:
            if stats is None:
                stats = self.user.stats

            recent_submissions = list(
                self.user.submissions.filter(score__isnull=False)
                .select_related("question")
                .order_by("-created_at")[:10]
                .values(
                    "id",
                    "score",
                    "created_at",
                    "question__title",
                    "question__difficulty",
                )
            )

            dimension_stats = {
                "scalability": {
                    "avg_score": stats.dimension_scalability_avg,
                },
                "performance": {
                    "avg_score": stats.dimension_performance_avg,
                },
                "cost": {
                    "avg_score": stats.dimension_cost_avg,
                },
                "reliability": {
                    "avg_score": stats.dimension_reliability_avg,
                },
                "completeness": {
                    "avg_score": stats.dimension_completeness_avg,
                },
                "security": {
                    "avg_score": stats.dimension_security_avg,
                },
            }

            return {
                "total_score": stats.total_score,
                "problems_solved": stats.problems_solved,
                "problems_attempted": stats.problems_attempted,
                "total_submissions": stats.total_submissions,
                "average_score": stats.average_score,
                "difficulty_stats": {
                    "beginner": {
                        "solved": stats.beginner_solved,
                        "avg_score": stats.beginner_avg_score,
                        "attempts": stats.beginner_attempts,
                    },
                    "intermediate": {
                        "solved": stats.intermediate_solved,
                        "avg_score": stats.intermediate_avg_score,
                        "attempts": stats.intermediate_attempts,
                    },
                    "advanced": {
                        "solved": stats.advanced_solved,
                        "avg_score": stats.advanced_avg_score,
                        "attempts": stats.advanced_attempts,
                    },
                },
                "category_stats": stats.category_stats,
                "recent_submissions": recent_submissions,
                "dimension_stats": dimension_stats,
                "score_trends": {
                    "weekly": stats.score_trends or [],
                    "difficulty_progress": {
                        "beginner": {
                            "current_avg": stats.beginner_avg_score,
                        },
                        "intermediate": {
                            "current_avg": stats.intermediate_avg_score,
                        },
                        "advanced": {
                            "current_avg": stats.advanced_avg_score,
                        },
                    },
                },
                "component_usage": stats.component_usage or {},
                "improvement_summary": stats.improvement_summary or {},
            }
        except UserStats.DoesNotExist:
            from .stats_updater import update_user_stats

            update_user_stats(self.user)
            return self.get_analytics()


class UserStats(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="stats")

    total_score = models.IntegerField(default=0)
    problems_solved = models.IntegerField(default=0)
    problems_attempted = models.IntegerField(default=0)
    total_submissions = models.IntegerField(default=0)
    average_score = models.FloatField(default=0.0)

    beginner_solved = models.IntegerField(default=0)
    beginner_avg_score = models.FloatField(default=0.0)
    beginner_attempts = models.IntegerField(default=0)

    intermediate_solved = models.IntegerField(default=0)
    intermediate_avg_score = models.FloatField(default=0.0)
    intermediate_attempts = models.IntegerField(default=0)

    advanced_solved = models.IntegerField(default=0)
    advanced_avg_score = models.FloatField(default=0.0)
    advanced_attempts = models.IntegerField(default=0)

    category_stats = models.JSONField(default=dict)

    dimension_scalability_avg = models.FloatField(default=0.0)
    dimension_performance_avg = models.FloatField(default=0.0)
    dimension_cost_avg = models.FloatField(default=0.0)
    dimension_reliability_avg = models.FloatField(default=0.0)
    dimension_completeness_avg = models.FloatField(default=0.0)
    dimension_security_avg = models.FloatField(default=0.0)

    score_trends = models.JSONField(default=list)

    component_usage = models.JSONField(default=dict)

    improvement_summary = models.JSONField(default=dict)

    last_updated = models.DateTimeField(auto_now=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name_plural = "User stats"

    def __str__(self):
        return f"Stats for {self.user.username}"


class Question(models.Model):
    title = models.CharField(max_length=255)
    description = models.TextField()
    constraints = models.JSONField(default=dict)
    difficulty = models.CharField(
        max_length=50,
        choices=[
            ("Beginner", "Beginner"),
            ("Intermediate", "Intermediate"),
            ("Advanced", "Advanced"),
        ],
        db_index=True,
    )
    category = models.CharField(max_length=100, db_index=True)
    ideal_solution = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.title


class Submission(models.Model):
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="submissions",
        null=True,
        blank=True,
        db_index=True,
    )
    question = models.ForeignKey(
        Question, on_delete=models.CASCADE, related_name="submissions", db_index=True
    )
    diagram = models.JSONField()
    evaluation_result = models.JSONField(null=True, blank=True)
    score = models.IntegerField(null=True, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        user_str = self.user.username if self.user else "Anonymous"
        return (
            f"Submission by {user_str} for {self.question.title} at {self.created_at}"
        )


class EmailVerificationToken(models.Model):
    TOKEN_TYPE_CHOICES = [
        ("verification", "Email Verification"),
        ("password_reset", "Password Reset"),
        ("magic_verification", "Magic Verification"),
    ]

    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="email_tokens"
    )
    token_hash = models.CharField(max_length=64, unique=True)
    token_type = models.CharField(
        max_length=20, choices=TOKEN_TYPE_CHOICES, db_index=True
    )
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(db_index=True)
    used = models.BooleanField(default=False, db_index=True)

    def __str__(self):
        return f"{self.token_type} token for {self.user.username}"

    def is_expired(self):
        return timezone.now() > self.expires_at

    def is_valid(self):
        return not self.used and not self.is_expired()

    @staticmethod
    def hash_token(token):
        return hashlib.sha256(token.encode()).hexdigest()

    @classmethod
    def create_token(cls, user, token_type, expiry_hours=1):
        token = secrets.token_urlsafe(32)
        token_hash = cls.hash_token(token)
        expires_at = timezone.now() + timedelta(hours=expiry_hours)

        cls.objects.create(
            user=user,
            token_hash=token_hash,
            token_type=token_type,
            expires_at=expires_at,
        )

        return token


class CreditBalance(models.Model):
    user = models.OneToOneField(
        User, on_delete=models.CASCADE, related_name="credit_balance"
    )
    credits_remaining = models.IntegerField(default=20)
    max_credits = models.IntegerField(default=20)
    period_started_at = models.DateTimeField(null=True, blank=True)
    last_credit_used_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    DEFAULT_MAX_CREDITS = 20
    RESET_HOURS = 24

    class Meta:
        verbose_name_plural = "Credit balances"

    def __str__(self):
        return (
            f"{self.user.username}: {self.credits_remaining}/{self.max_credits} credits"
        )

    @property
    def needs_reset(self) -> bool:
        if self.last_credit_used_at is None:
            return False
        return timezone.now() >= self.last_credit_used_at + timedelta(
            hours=self.RESET_HOURS
        )

    @property
    def reset_available_at(self):
        if (
            self.credits_remaining >= self.max_credits
            or self.last_credit_used_at is None
        ):
            return None
        return self.last_credit_used_at + timedelta(hours=self.RESET_HOURS)

    @property
    def seconds_until_reset(self):
        if self.reset_available_at is None:
            return None
        delta = self.reset_available_at - timezone.now()
        return max(0, int(delta.total_seconds()))

    def reset_if_needed(self) -> bool:
        if self.needs_reset:
            self.credits_remaining = self.max_credits
            self.period_started_at = None
            self.save()
            return True
        return False

    def use_credit(self) -> bool:
        self.reset_if_needed()

        if self.credits_remaining <= 0:
            return False
        if self.period_started_at is None:
            self.period_started_at = timezone.now()

        self.credits_remaining -= 1
        self.last_credit_used_at = timezone.now()
        self.save()
        return True

    def get_status(self) -> dict:
        self.reset_if_needed()
        return {
            "credits_remaining": self.credits_remaining,
            "max_credits": self.max_credits,
            "reset_at": (
                self.reset_available_at.isoformat() if self.reset_available_at else None
            ),
            "seconds_until_reset": self.seconds_until_reset,
        }


class CustomNodeDefinition(models.Model):
    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="custom_nodes", db_index=True
    )
    type = models.CharField(max_length=100, db_index=True)
    label = models.CharField(max_length=255)
    category = models.CharField(max_length=100, default="custom", db_index=True)
    icon_name = models.CharField(max_length=50, default="Box")
    description = models.TextField()
    tooltip = models.TextField(blank=True)
    properties = models.JSONField(default=list)
    inputs = models.IntegerField(default=1)
    outputs = models.IntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [["user", "type"]]
        ordering = ["-created_at"]
        verbose_name = "Custom Node Definition"
        verbose_name_plural = "Custom Node Definitions"

    def __str__(self):
        return f"{self.user.username}'s {self.label}"
