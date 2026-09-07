from django.utils import timezone

from api.models import EmailVerificationToken


def generate_verification_token(user):
    token = EmailVerificationToken.create_token(
        user, "magic_verification", expiry_hours=0.25
    )
    return token


def generate_password_reset_token(user):
    token = EmailVerificationToken.create_token(user, "password_reset", expiry_hours=1)
    return token


def generate_magic_verification_token(user):
    token = EmailVerificationToken.create_token(
        user, "magic_verification", expiry_hours=0.25
    )
    return token


def verify_token(token, token_type):
    token_hash = EmailVerificationToken.hash_token(token)

    try:
        token_obj = EmailVerificationToken.objects.get(
            token_hash=token_hash, token_type=token_type
        )

        if token_obj.used:
            return None, "This link has already been used"

        if token_obj.is_expired():
            return None, "This link has expired"

        return token_obj.user, None
    except EmailVerificationToken.DoesNotExist:
        return None, "Invalid or unknown token"


def invalidate_token(token):
    token_hash = EmailVerificationToken.hash_token(token)

    try:
        token_obj = EmailVerificationToken.objects.get(token_hash=token_hash)
        token_obj.used = True
        token_obj.save()
        return True
    except EmailVerificationToken.DoesNotExist:
        return False


def mark_email_as_verified(user):
    try:
        profile = user.profile
        profile.email_verified = True
        profile.email_verified_at = timezone.now()
        profile.save()
        return True
    except Exception:
        return False
