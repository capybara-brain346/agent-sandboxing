import logging
from functools import wraps

from django.contrib.auth.models import User
from django.core.cache import cache
from rest_framework.response import Response

logger = logging.getLogger(__name__)


def cache_user_response(cache_key_prefix, timeout=300):
    def decorator(view_func):
        @wraps(view_func)
        def wrapper(request, *args, **kwargs):
            user_id = request.user.id
            cache_key = f"{cache_key_prefix}:user:{user_id}"

            try:
                cached_data = cache.get(cache_key)
                if cached_data is not None:
                    logger.debug(f"Cache hit: {cache_key}")
                    return Response(cached_data)
                else:
                    logger.debug(f"Cache miss: {cache_key}")
            except Exception as e:
                logger.warning(
                    f"Cache read error for {cache_key}: {e}, falling back to database"
                )

            response = view_func(request, *args, **kwargs)

            if response.status_code == 200:
                try:
                    data_to_cache = response.data
                    cache.set(cache_key, data_to_cache, timeout)
                    logger.debug(
                        f"Cache set: {cache_key} (timeout: {timeout}s, data size: {len(str(data_to_cache))} chars)"
                    )
                except Exception as e:
                    logger.error(
                        f"Cache write error for {cache_key}: {type(e).__name__}: {e}"
                    )
                    import traceback

                    logger.error(f"Cache write traceback: {traceback.format_exc()}")
            else:
                logger.debug(
                    f"Skipping cache for {cache_key} (status: {response.status_code})"
                )

            return response

        return wrapper

    return decorator


def cache_public_profile_response(cache_key_prefix, timeout=300):
    def decorator(view_func):
        @wraps(view_func)
        def wrapper(request, username, *args, **kwargs):
            viewer_id = request.user.id if request.user.is_authenticated else "anon"
            cache_key = f"{cache_key_prefix}:username:{username}:viewer:{viewer_id}"

            try:
                cached_data = cache.get(cache_key)
                if cached_data is not None:
                    logger.debug(f"Cache hit: {cache_key}")
                    return Response(cached_data)
                else:
                    logger.debug(f"Cache miss: {cache_key}")
            except Exception as e:
                logger.warning(
                    f"Cache read error for {cache_key}: {e}, falling back to database"
                )

            response = view_func(request, username, *args, **kwargs)

            if response.status_code == 200:
                try:
                    data_to_cache = response.data
                    cache.set(cache_key, data_to_cache, timeout)
                    logger.debug(
                        f"Cache set: {cache_key} (timeout: {timeout}s, data size: {len(str(data_to_cache))} chars)"
                    )

                    try:
                        user = User.objects.get(username=username)
                        user_id_cache_key = f"{cache_key_prefix}:user_id:{user.id}"
                        cache.set(user_id_cache_key, username, timeout)
                        logger.debug(
                            f"Cache mapping set: user_id {user.id} -> username {username}"
                        )
                    except User.DoesNotExist:
                        pass
                except Exception as e:
                    logger.error(
                        f"Cache write error for {cache_key}: {type(e).__name__}: {e}"
                    )
                    import traceback

                    logger.error(f"Cache write traceback: {traceback.format_exc()}")
            else:
                logger.debug(
                    f"Skipping cache for {cache_key} (status: {response.status_code})"
                )

            return response

        return wrapper

    return decorator


def invalidate_user_cache(user_id, username=None):
    try:
        if username is None:
            try:
                user = User.objects.get(id=user_id)
                username = user.username
            except User.DoesNotExist:
                logger.warning(f"Cannot invalidate cache: user {user_id} not found")
                return

        cache_keys = [
            f"profile:user:{user_id}",
            f"current_user:user:{user_id}",
            f"analytics:user:{user_id}",
            f"public_profile:username:{username}:viewer:{user_id}",
            f"public_profile:username:{username}:viewer:anon",
            f"public_analytics:username:{username}:viewer:{user_id}",
            f"public_analytics:username:{username}:viewer:anon",
        ]

        cache.delete_many(cache_keys)
        logger.debug(f"Cache invalidated for user {user_id} ({username}): {cache_keys}")
    except Exception as e:
        logger.error(f"Error invalidating cache for user {user_id}: {e}")
