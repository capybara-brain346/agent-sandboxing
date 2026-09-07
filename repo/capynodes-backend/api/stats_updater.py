from collections import Counter, defaultdict
from datetime import timedelta

from django.db import models
from django.db.models import Avg, Count
from django.utils import timezone

from .models import UserStats


DIMENSION_ALIASES = {
    "scalability": "scalability",
    "scale": "scalability",
    "performance": "performance",
    "latency & performance": "performance",
    "latency": "performance",
    "speed": "performance",
    "cost": "cost",
    "cost efficiency": "cost",
    "cost optimization": "cost",
    "cost-efficiency": "cost",
    "reliability": "reliability",
    "reliability & fault tolerance": "reliability",
    "fault tolerance": "reliability",
    "redundancy": "reliability",
    "completeness": "completeness",
    "completeness & best practices": "completeness",
    "coverage": "completeness",
    "security": "security",
    "security & ethics": "security",
    "data protection": "security",
}


def normalize_dimension_name(name: str) -> str:
    normalized = name.lower().strip()
    return DIMENSION_ALIASES.get(normalized, normalized)


def update_user_stats(user):
    stats, created = UserStats.objects.get_or_create(user=user)

    submissions = list(
        user.submissions.filter(score__isnull=False)
        .select_related("question")
        .order_by("created_at")
    )

    if not submissions:
        stats.total_score = 0
        stats.problems_solved = 0
        stats.total_submissions = 0
        stats.average_score = 0.0
        stats.beginner_solved = 0
        stats.beginner_avg_score = 0.0
        stats.beginner_attempts = 0
        stats.intermediate_solved = 0
        stats.intermediate_avg_score = 0.0
        stats.intermediate_attempts = 0
        stats.advanced_solved = 0
        stats.advanced_avg_score = 0.0
        stats.advanced_attempts = 0
        stats.category_stats = {}
        stats.dimension_scalability_avg = 0.0
        stats.dimension_performance_avg = 0.0
        stats.dimension_cost_avg = 0.0
        stats.dimension_reliability_avg = 0.0
        stats.dimension_completeness_avg = 0.0
        stats.dimension_security_avg = 0.0
        stats.score_trends = []
        stats.component_usage = {}
        stats.improvement_summary = {}
        stats.save()
        return stats

    total_score = sum(s.score for s in submissions)
    stats.total_submissions = len(submissions)
    stats.total_score = total_score
    stats.average_score = total_score / stats.total_submissions

    attempted_questions = set()
    solved_questions = set()

    diff_stats = {
        "Beginner": {"attempts": 0, "solved": 0, "scores": []},
        "Intermediate": {"attempts": 0, "solved": 0, "scores": []},
        "Advanced": {"attempts": 0, "solved": 0, "scores": []},
    }

    cat_stats = defaultdict(lambda: {"attempts": 0, "solved": 0, "scores": []})

    question_max_scores = defaultdict(int)

    for s in submissions:
        q_id = s.question_id
        score = s.score

        attempted_questions.add(q_id)
        question_max_scores[q_id] = max(question_max_scores[q_id], score)

        diff = s.question.difficulty
        if diff in diff_stats:
            diff_stats[diff]["attempts"] += 1
            diff_stats[diff]["scores"].append(score)

        cat = s.question.category
        cat_stats[cat]["attempts"] += 1
        cat_stats[cat]["scores"].append(score)

    for q_id, max_score in question_max_scores.items():
        if max_score > 70:
            solved_questions.add(q_id)

    stats.problems_attempted = len(attempted_questions)
    stats.problems_solved = len(solved_questions)

    q_meta = {}
    for s in submissions:
        q_meta[s.question_id] = {
            "difficulty": s.question.difficulty,
            "category": s.question.category,
        }

    diff_solved_counts = defaultdict(int)
    cat_solved_counts = defaultdict(int)

    for q_id in solved_questions:
        meta = q_meta.get(q_id)
        if meta:
            diff_solved_counts[meta["difficulty"]] += 1
            cat_solved_counts[meta["category"]] += 1

    for difficulty, prefix in [
        ("Beginner", "beginner"),
        ("Intermediate", "intermediate"),
        ("Advanced", "advanced"),
    ]:
        d_data = diff_stats.get(difficulty, {})
        scores = d_data.get("scores", [])
        avg = sum(scores) / len(scores) if scores else 0.0

        setattr(stats, f"{prefix}_attempts", d_data.get("attempts", 0))
        setattr(stats, f"{prefix}_solved", diff_solved_counts.get(difficulty, 0))
        setattr(stats, f"{prefix}_avg_score", avg)

    category_stats_json = {}
    for cat, data in cat_stats.items():
        scores = data["scores"]
        avg = sum(scores) / len(scores) if scores else 0.0
        category_stats_json[cat] = {
            "solved": cat_solved_counts.get(cat, 0),
            "avg_score": avg,
            "attempts": data["attempts"],
        }
    stats.category_stats = category_stats_json

    _update_dimension_stats(stats, submissions)
    _update_score_trends(stats, submissions)
    _update_component_usage(stats, submissions)
    _update_improvement_summary(stats, submissions)

    stats.save()
    return stats


def _update_dimension_stats(stats, submissions):
    dimension_scores = defaultdict(list)

    for submission in submissions:
        eval_result = submission.evaluation_result or {}
        breakdown = eval_result.get("breakdown", [])

        for item in breakdown:
            if isinstance(item, dict) and "category" in item and "score" in item:
                dim_name = normalize_dimension_name(item["category"])
                if dim_name in [
                    "scalability",
                    "performance",
                    "cost",
                    "reliability",
                    "completeness",
                    "security",
                ]:
                    try:
                        score = float(item["score"])
                        dimension_scores[dim_name].append(score)
                    except (ValueError, TypeError):
                        pass

    for dim in [
        "scalability",
        "performance",
        "cost",
        "reliability",
        "completeness",
        "security",
    ]:
        scores = dimension_scores.get(dim, [])
        avg = sum(scores) / len(scores) if scores else 0.0
        setattr(stats, f"dimension_{dim}_avg", round(avg, 2))


def _update_score_trends(stats, submissions):
    now = timezone.now()
    twelve_weeks_ago = now - timedelta(weeks=12)

    recent = [s for s in submissions if s.created_at >= twelve_weeks_ago]

    weekly_data = defaultdict(lambda: {"scores": [], "count": 0})

    for submission in recent:
        week_start = submission.created_at - timedelta(
            days=submission.created_at.weekday()
        )
        week_key = week_start.strftime("%Y-%m-%d")

        weekly_data[week_key]["scores"].append(submission.score)
        weekly_data[week_key]["count"] += 1

    trends = []
    for week_key in sorted(weekly_data.keys()):
        data = weekly_data[week_key]
        avg_score = sum(data["scores"]) / len(data["scores"]) if data["scores"] else 0
        trends.append(
            {
                "week": week_key,
                "avg_score": round(avg_score, 2),
                "submissions": data["count"],
            }
        )

    stats.score_trends = trends[-12:]


def _update_component_usage(stats, submissions):
    component_counts = Counter()

    for submission in submissions:
        diagram = submission.diagram or {}
        nodes = diagram.get("nodes", [])

        for node in nodes:
            if isinstance(node, dict):
                node_type = node.get("type", "")
                data = node.get("data", {})
                label = data.get("label", node_type)

                if label:
                    component_counts[label] += 1

    most_common = component_counts.most_common(15)

    total_nodes = sum(component_counts.values())
    stats.component_usage = {
        "most_used": [
            {
                "name": name,
                "count": count,
                "percentage": round(
                    (count / total_nodes * 100) if total_nodes > 0 else 0, 1
                ),
            }
            for name, count in most_common
        ],
        "total_components": total_nodes,
        "unique_components": len(component_counts),
    }


def _update_improvement_summary(stats, submissions):
    issue_counts = Counter()
    strength_counts = Counter()

    for submission in submissions:
        eval_result = submission.evaluation_result or {}

        improvements = eval_result.get("improvements", [])
        for improvement in improvements:
            if isinstance(improvement, str) and improvement.strip():
                normalized = _normalize_feedback(improvement)
                if normalized:
                    issue_counts[normalized] += 1

        strengths = eval_result.get("strengths", [])
        for strength in strengths:
            if isinstance(strength, str) and strength.strip():
                normalized = _normalize_feedback(strength)
                if normalized:
                    strength_counts[normalized] += 1

    dimension_avgs = {
        "scalability": stats.dimension_scalability_avg,
        "performance": stats.dimension_performance_avg,
        "cost": stats.dimension_cost_avg,
        "reliability": stats.dimension_reliability_avg,
        "completeness": stats.dimension_completeness_avg,
        "security": stats.dimension_security_avg,
    }

    suggested_focus = None
    if any(avg > 0 for avg in dimension_avgs.values()):
        weakest_dim = min(dimension_avgs, key=dimension_avgs.get)
        if dimension_avgs[weakest_dim] < 60:
            suggested_focus = {
                "dimension": weakest_dim,
                "avg_score": dimension_avgs[weakest_dim],
                "reason": f"Consistently scoring low in {weakest_dim.capitalize()} (avg {dimension_avgs[weakest_dim]:.1f})",
            }

    stats.improvement_summary = {
        "recurring_issues": [
            {"theme": theme, "count": count}
            for theme, count in issue_counts.most_common(5)
        ],
        "recurring_strengths": [
            {"theme": theme, "count": count}
            for theme, count in strength_counts.most_common(5)
        ],
        "suggested_focus": suggested_focus,
    }


def _normalize_feedback(text: str) -> str:
    text = text.strip()
    if len(text) > 100:
        text = text[:100] + "..."

    prefixes_to_remove = ["Warning: ", "Consider ", "Try to ", "You should "]
    for prefix in prefixes_to_remove:
        if text.startswith(prefix):
            text = text[len(prefix) :]

    return text.capitalize()
