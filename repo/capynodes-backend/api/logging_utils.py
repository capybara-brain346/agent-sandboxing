import functools
import logging
import time

from django.conf import settings

logger = logging.getLogger(__name__)


def log_execution_time(func):
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        start_time = time.time()
        result = func(*args, **kwargs)
        end_time = time.time()
        duration = end_time - start_time

        if duration > 1.0:
            level = logging.WARNING
        else:
            level = logging.DEBUG if settings.DEBUG else logging.INFO

        logger.log(level, f"Function '{func.__name__}' executed in {duration:.4f}s")
        return result

    return wrapper


def log_api_request(func):
    @functools.wraps(func)
    def wrapper(request, *args, **kwargs):
        method = request.method
        path = request.path
        user = request.user.username if request.user.is_authenticated else "Anonymous"

        logger.info(f"API Request: {method} {path} by user: {user}")

        start_time = time.time()
        try:
            response = func(request, *args, **kwargs)
            duration = time.time() - start_time

            status_code = getattr(response, "status_code", "N/A")
            level = logging.INFO
            if isinstance(status_code, int):
                if status_code >= 500:
                    level = logging.ERROR
                elif status_code >= 400:
                    level = logging.WARNING

            logger.log(
                level,
                f"API Response: {method} {path} - Status: {status_code} - Time: {duration:.4f}s",
            )
            return response
        except Exception as e:
            duration = time.time() - start_time
            logger.exception(
                f"API Error: {method} {path} - Exception: {str(e)} - Time: {duration:.4f}s"
            )
            raise

    return wrapper
