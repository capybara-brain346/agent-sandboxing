"""
Percentile calculation service for community-wide benchmarking.
"""

import bisect
import logging
from typing import Dict, List, Optional

from django.core.cache import cache
from django.db.models import Avg

logger = logging.getLogger(__name__)

CACHE_KEY_OVERALL_DISTRIBUTION = "analytics:percentile:overall_distribution"
CACHE_KEY_DIMENSION_DISTRIBUTION = "analytics:percentile:dimension_distribution"
CACHE_TIMEOUT = 3600  # 1 hour


def get_overall_distribution() -> List[float]:
    """
    Get the cached distribution of average scores across all users.
    Returns a sorted list of average scores.
    """
    distribution = cache.get(CACHE_KEY_OVERALL_DISTRIBUTION)

    if distribution is None:
        distribution = _calculate_overall_distribution()
        cache.set(CACHE_KEY_OVERALL_DISTRIBUTION, distribution, CACHE_TIMEOUT)

    return distribution


def get_dimension_distributions() -> Dict[str, List[float]]:
    """
    Get cached distributions for each dimension.
    Returns dict mapping dimension -> sorted list of averages.
    """
    distributions = cache.get(CACHE_KEY_DIMENSION_DISTRIBUTION)

    if distributions is None:
        distributions = _calculate_dimension_distributions()
        cache.set(CACHE_KEY_DIMENSION_DISTRIBUTION, distributions, CACHE_TIMEOUT)

    return distributions


def _calculate_overall_distribution() -> List[float]:
    """
    Calculate the distribution of average scores across all users.
    """
    from ..models import UserStats

    # Get all users with at least one submission
    avg_scores = list(
        UserStats.objects.filter(total_submissions__gt=0).values_list(
            "average_score", flat=True
        )
    )

    return sorted(avg_scores)


def _calculate_dimension_distributions() -> Dict[str, List[float]]:
    """
    Calculate distributions for each evaluation dimension.
    """
    from ..models import UserStats

    dimensions = [
        "scalability",
        "performance",
        "cost",
        "reliability",
        "completeness",
        "security",
    ]

    distributions = {}

    for dim in dimensions:
        field_name = f"dimension_{dim}_avg"
        scores = list(
            UserStats.objects.filter(
                total_submissions__gt=0, **{f"{field_name}__gt": 0}
            ).values_list(field_name, flat=True)
        )
        distributions[dim] = sorted(scores)

    return distributions


def calculate_percentile(score: float, distribution: List[float]) -> int:
    """
    Calculate the percentile rank of a score within a distribution.

    Args:
        score: The score to rank
        distribution: Sorted list of all scores

    Returns:
        Percentile (0-100)
    """
    if not distribution:
        return 50  # Default if no data

    position = bisect.bisect_left(distribution, score)
    percentile = (position / len(distribution)) * 100

    return min(100, max(0, int(round(percentile))))


def get_user_percentile(user_average_score: float) -> int:
    """
    Get a user's percentile rank compared to all users.

    Args:
        user_average_score: The user's average score

    Returns:
        Percentile (0-100)
    """
    distribution = get_overall_distribution()
    return calculate_percentile(user_average_score, distribution)


def get_dimension_percentiles(dimension_scores: Dict[str, float]) -> Dict[str, int]:
    """
    Get percentile ranks for each dimension.

    Args:
        dimension_scores: Dict mapping dimension name -> user's avg score

    Returns:
        Dict mapping dimension name -> percentile (0-100)
    """
    distributions = get_dimension_distributions()
    percentiles = {}

    for dim, score in dimension_scores.items():
        if dim in distributions and score > 0:
            percentiles[dim] = calculate_percentile(score, distributions[dim])
        else:
            percentiles[dim] = 50  # Default

    return percentiles


def get_percentile_message(percentile: int, average_score: float) -> str:
    """
    Generate a user-friendly message about their percentile ranking.
    """
    if percentile >= 90:
        return f"Your average score ({average_score:.1f}) puts you in the top 10% of users!"
    elif percentile >= 75:
        return f"Your average score ({average_score:.1f}) is better than {percentile}% of users"
    elif percentile >= 50:
        return f"Your average score ({average_score:.1f}) is better than {percentile}% of users"
    elif percentile >= 25:
        return f"Your average score ({average_score:.1f}) is better than {percentile}% of users. Keep practicing!"
    else:
        return f"Your average score ({average_score:.1f}) is in the bottom quartile. Room to grow!"


def update_user_percentiles(user) -> Dict:
    """
    Calculate and update a user's percentile rankings.
    Returns the percentile data.
    """
    from ..models import UserStats

    try:
        stats = user.stats
    except UserStats.DoesNotExist:
        return {"overall_percentile": 50, "dimension_percentiles": {}}

    # Overall percentile
    overall_percentile = get_user_percentile(stats.average_score)

    # Dimension percentiles
    dimension_scores = {
        "scalability": stats.dimension_scalability_avg,
        "performance": stats.dimension_performance_avg,
        "cost": stats.dimension_cost_avg,
        "reliability": stats.dimension_reliability_avg,
        "completeness": stats.dimension_completeness_avg,
        "security": stats.dimension_security_avg,
    }
    dimension_percentiles = get_dimension_percentiles(dimension_scores)

    # Update the stats model
    stats.percentile_overall = overall_percentile
    stats.percentile_by_dimension = dimension_percentiles
    stats.save(update_fields=["percentile_overall", "percentile_by_dimension"])

    return {
        "overall_percentile": overall_percentile,
        "dimension_percentiles": dimension_percentiles,
        "message": get_percentile_message(overall_percentile, stats.average_score),
    }


def refresh_percentile_cache():
    """
    Force refresh of percentile distribution caches.
    Call this periodically (e.g., every hour via cron/celery).
    """
    logger.info("Refreshing percentile distribution caches")

    distribution = _calculate_overall_distribution()
    cache.set(CACHE_KEY_OVERALL_DISTRIBUTION, distribution, CACHE_TIMEOUT)

    dimension_dists = _calculate_dimension_distributions()
    cache.set(CACHE_KEY_DIMENSION_DISTRIBUTION, dimension_dists, CACHE_TIMEOUT)

    logger.info(
        f"Percentile cache refreshed: {len(distribution)} users in overall distribution"
    )
