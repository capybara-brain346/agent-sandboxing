import logging

from django.contrib.auth.models import User
from django.core.cache import cache
from django.db import transaction

from ..models import CreditBalance

logger = logging.getLogger(__name__)

MAX_CREDIT_CHECKS_PER_MINUTE = 30
MAX_EVAL_ATTEMPTS_PER_MINUTE = 5


class CreditError(Exception):
    pass


class NoCreditsError(CreditError):
    def __init__(self, credit_status: dict):
        self.credit_status = credit_status
        super().__init__("No credits remaining")


class RateLimitError(CreditError):
    pass


def get_or_create_balance(user: User) -> CreditBalance:
    balance, created = CreditBalance.objects.get_or_create(user=user)
    if created:
        logger.info(f"Created credit balance for user {user.username}")
    return balance


def check_rate_limit(user: User, action: str, max_per_minute: int) -> bool:
    cache_key = f"credit_ratelimit:{user.id}:{action}"

    cache.add(cache_key, 0, timeout=60)

    try:
        current_count = cache.incr(cache_key)
    except ValueError:
        cache.add(cache_key, 0, timeout=60)
        current_count = cache.incr(cache_key)

    if current_count > max_per_minute:
        logger.warning(f"Rate limit exceeded for user {user.username} on {action}")
        raise RateLimitError("Too many requests. Please wait before trying again.")

    return True


@transaction.atomic
def use_credit(user: User) -> dict:
    check_rate_limit(user, "eval_attempt", MAX_EVAL_ATTEMPTS_PER_MINUTE)

    CreditBalance.objects.get_or_create(user=user)
    balance = CreditBalance.objects.select_for_update().get(user=user)

    if not balance.use_credit():
        raise NoCreditsError(balance.get_status())

    logger.info(
        f"Credit used by {user.username}. Remaining: {balance.credits_remaining}"
    )
    return balance.get_status()


def get_credit_status(user: User) -> dict:
    check_rate_limit(user, "status_check", MAX_CREDIT_CHECKS_PER_MINUTE)
    balance = get_or_create_balance(user)
    return balance.get_status()
