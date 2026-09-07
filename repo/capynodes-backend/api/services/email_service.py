import logging

from django.conf import settings
from django.core.mail import send_mail
from django.template.loader import render_to_string

logger = logging.getLogger(__name__)


def send_verification_email(user, token):
    try:
        if not user.email:
            logger.warning(
                f"Cannot send verification email to user {user.username}: no email address"
            )
            return False, "User has no email address"

        is_ses = getattr(settings, "EMAIL_BACKEND", "") == "django_ses.SESBackend"

        if not getattr(settings, "DEFAULT_FROM_EMAIL", None):
            logger.warning("DEFAULT_FROM_EMAIL not configured.")
            return False, "Email service not configured"

        if is_ses and not (
            getattr(settings, "AWS_ACCESS_KEY_ID", None)
            and getattr(settings, "AWS_SECRET_ACCESS_KEY", None)
        ):
            logger.warning("AWS SES credentials missing.")
            return False, "Email service not configured"

        magic_link_url = f"{settings.FRONTEND_URL}/auth/verify?token={token}"

        context = {
            "user": user,
            "magic_link_url": magic_link_url,
            "site_name": "CapyNodes",
        }

        html_message = render_to_string("emails/magic_verification_email.html", context)
        plain_message = render_to_string("emails/magic_verification_email.txt", context)

        send_mail(
            subject="Verify your email - CapyNodes",
            message=plain_message,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[user.email],
            html_message=html_message,
            fail_silently=False,
        )

        logger.info(f"Verification email sent to {user.email}")
        return True, None
    except Exception as e:
        logger.error(f"Failed to send verification email: {str(e)}")
        return False, str(e)


def send_password_reset_email(user, token):
    try:
        if not user.email:
            logger.warning(
                f"Cannot send password reset email to user {user.username}: no email address"
            )
            return False, "User has no email address"

        is_ses = getattr(settings, "EMAIL_BACKEND", "") == "django_ses.SESBackend"

        if not getattr(settings, "DEFAULT_FROM_EMAIL", None):
            logger.warning("DEFAULT_FROM_EMAIL not configured.")
            return False, "Email service not configured"

        if is_ses and not (
            getattr(settings, "AWS_ACCESS_KEY_ID", None)
            and getattr(settings, "AWS_SECRET_ACCESS_KEY", None)
        ):
            logger.warning("AWS SES credentials missing.")
            return False, "Email service not configured"

        reset_url = f"{settings.FRONTEND_URL}/reset-password/{token}"

        context = {
            "user": user,
            "reset_url": reset_url,
            "site_name": "CapyNodes",
        }

        html_message = render_to_string("emails/password_reset_email.html", context)
        plain_message = render_to_string("emails/password_reset_email.txt", context)

        send_mail(
            subject="Reset your password - CapyNodes",
            message=plain_message,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[user.email],
            html_message=html_message,
            fail_silently=False,
        )

        logger.info(f"Password reset email sent to {user.email}")
        return True, None
    except Exception as e:
        logger.error(f"Failed to send password reset email: {str(e)}")
        return False, str(e)


def send_magic_verification_email(user, token):
    try:
        if not user.email:
            logger.warning(
                f"Cannot send magic verification email to user {user.username}: no email address"
            )
            return False, "User has no email address"

        is_ses = getattr(settings, "EMAIL_BACKEND", "") == "django_ses.SESBackend"

        if not getattr(settings, "DEFAULT_FROM_EMAIL", None):
            logger.warning("DEFAULT_FROM_EMAIL not configured.")
            return False, "Email service not configured"

        if is_ses and not (
            getattr(settings, "AWS_ACCESS_KEY_ID", None)
            and getattr(settings, "AWS_SECRET_ACCESS_KEY", None)
        ):
            logger.warning("AWS SES credentials missing.")
            return False, "Email service not configured"

        magic_link_url = f"{settings.FRONTEND_URL}/auth/verify?token={token}"

        context = {
            "user": user,
            "magic_link_url": magic_link_url,
            "site_name": "CapyNodes",
        }

        html_message = render_to_string("emails/magic_verification_email.html", context)
        plain_message = render_to_string("emails/magic_verification_email.txt", context)

        send_mail(
            subject="Verify your email - CapyNodes",
            message=plain_message,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[user.email],
            html_message=html_message,
            fail_silently=False,
        )

        logger.info(f"Magic verification email sent to {user.email}")
        return True, None
    except Exception as e:
        logger.error(f"Failed to send magic verification email: {str(e)}")
        return False, str(e)
