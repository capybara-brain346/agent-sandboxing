import logging
import re
from django.conf import settings
from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from django.utils import timezone
from google.auth.transport import requests
from google.oauth2 import id_token
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from .auth_jwt import get_tokens_for_user, set_refresh_cookie


from ..logging_utils import log_api_request
from ..models import (
    UserProfile,
)
from ..serializers import (
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    RegisterSerializer,
    UserSerializer,
)
from ..services.email_service import (
    send_magic_verification_email,
    send_password_reset_email,
    send_verification_email,
)
from ..services.token_service import (
    generate_magic_verification_token,
    generate_password_reset_token,
    generate_verification_token,
    invalidate_token,
    mark_email_as_verified,
    verify_token,
)

logger = logging.getLogger(__name__)


@api_view(["POST"])
@permission_classes([AllowAny])
@log_api_request
def register(request):
    serializer = RegisterSerializer(data=request.data)
    if serializer.is_valid():
        user = serializer.save()

        email_sent = False
        if settings.BYPASS_EMAIL_VERIFICATION:
            mark_email_as_verified(user)
            message = (
                "Registration successful. Email verification bypassed for testing."
            )
        elif user.email:
            try:
                verification_token = generate_verification_token(user)
                success, error = send_verification_email(user, verification_token)
                email_sent = success
                if not success:
                    logger.error(
                        f"Failed to send verification email during registration: {error}"
                    )
            except Exception as e:
                logger.error(
                    f"Exception sending verification email during registration: {str(e)}"
                )

            message = "Registration successful."
            if email_sent:
                message += " Please check your email to verify your account."
            else:
                message += " We couldn't send a verification email. Please request a new one from the login page."
        else:
            message = "Registration successful."

        tokens = get_tokens_for_user(user)

        user = User.objects.select_related("profile").get(pk=user.pk)
        user_data = UserSerializer(user).data

        response = Response(
            {"user": user_data, "access": tokens["access"], "message": message},
            status=status.HTTP_201_CREATED,
        )
        set_refresh_cookie(response, tokens["refresh"])
        return response
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(["POST"])
@permission_classes([AllowAny])
@log_api_request
def google_login(request):
    credential = request.data.get("credential")
    if not credential:
        return Response(
            {"error": "Google credential is required"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        idinfo = id_token.verify_oauth2_token(
            credential, requests.Request(), settings.GOOGLE_OAUTH_CLIENT_ID
        )

        email = idinfo["email"]
        first_name = idinfo.get("given_name", "")
        last_name = idinfo.get("family_name", "")
        picture = idinfo.get("picture", "")

        try:
            user = User.objects.get(email=email)
        except User.DoesNotExist:
            username = email.split("@")[0]
            base_username = username
            counter = 1
            while User.objects.filter(username=username).exists():
                username = f"{base_username}{counter}"
                counter += 1

            user = User.objects.create_user(
                username=username,
                email=email,
                first_name=first_name,
                last_name=last_name,
            )
            user.set_unusable_password()
            user.save()

            UserProfile.objects.create(user=user, onboarding_completed=False)

        profile, _ = UserProfile.objects.get_or_create(user=user)
        profile.email_verified = True
        profile.email_verified_at = timezone.now()
        if not profile.avatar_url and picture:
            profile.avatar_url = picture
        profile.save()

        if not user.first_name and first_name:
            user.first_name = first_name
        if not user.last_name and last_name:
            user.last_name = last_name
        user.save()

        tokens = get_tokens_for_user(user)
        user_data = UserSerializer(user).data

        response = Response(
            {
                "user": user_data,
                "access": tokens["access"],
                "requires_onboarding": not profile.onboarding_completed,
            },
            status=status.HTTP_200_OK,
        )
        set_refresh_cookie(response, tokens["refresh"])
        return response

    except ValueError:
        return Response(
            {"error": "Invalid Google credential"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    except Exception as e:
        logger.error(f"Error during Google login: {str(e)}")
        return Response(
            {"error": "An error occurred during Google login"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def complete_onboarding(request):
    user = request.user
    username = request.data.get("username")
    first_name = request.data.get("first_name", "")
    last_name = request.data.get("last_name", "")

    if not username:
        return Response(
            {"error": "Username is required"}, status=status.HTTP_400_BAD_REQUEST
        )

    if not re.match(r"^[a-zA-Z0-9_-]+$", username):
        return Response(
            {
                "error": "Username can only contain alphanumeric characters, underscores, and hyphens"
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    if User.objects.filter(username=username).exclude(id=user.id).exists():
        return Response(
            {"error": "This username is already taken"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    user.username = username
    if first_name:
        user.first_name = first_name
    if last_name:
        user.last_name = last_name
    user.save()

    profile, created = UserProfile.objects.get_or_create(user=user)
    profile.onboarding_completed = True
    profile.save()

    return Response(UserSerializer(user).data, status=status.HTTP_200_OK)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def request_verification_email(request):
    user = request.user

    try:
        profile = user.profile
        if profile.email_verified:
            return Response(
                {"message": "Email already verified"}, status=status.HTTP_200_OK
            )
    except UserProfile.DoesNotExist:
        profile = UserProfile.objects.create(user=user)

    if not user.email:
        return Response(
            {"error": "No email address associated with this account"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        token = generate_verification_token(user)
        success, error = send_verification_email(user, token)

        if success:
            return Response(
                {"message": "Verification email sent successfully"},
                status=status.HTTP_200_OK,
            )
        else:
            logger.error(f"Failed to send verification email to {user.email}: {error}")
            return Response(
                {"error": "Failed to send verification email. Please try again later."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
    except Exception as e:
        logger.error(f"Exception in request_verification_email: {str(e)}")
        return Response(
            {"error": "An error occurred. Please try again later."},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


@api_view(["POST"])
@permission_classes([AllowAny])
def verify_email(request, token):
    user, error = verify_token(token, "magic_verification")

    if error:
        error_message = error
        if "expired" in error.lower() or "invalid" in error.lower():
            error_message = "This verification link has expired or is invalid. Please request a new verification email from the login page."
        elif "not found" in error.lower():
            error_message = "This verification link is invalid. Please request a new verification email from the login page."
        return Response({"error": error_message}, status=status.HTTP_400_BAD_REQUEST)

    try:
        profile = user.profile
        if profile.email_verified:
            return Response(
                {
                    "message": "Your email has already been verified. You can log in now."
                },
                status=status.HTTP_200_OK,
            )
    except UserProfile.DoesNotExist:
        pass

    if mark_email_as_verified(user):
        invalidate_token(token)
        return Response(
            {
                "message": "Email verified successfully! You can now log in to your account."
            },
            status=status.HTTP_200_OK,
        )
    else:
        return Response(
            {"error": "Failed to verify email. Please try again or contact support."},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


@api_view(["POST"])
@permission_classes([AllowAny])
def resend_verification_email_public(request):
    email = request.data.get("email")
    username = request.data.get("username")

    if not email and not username:
        return Response(
            {"error": "Email or username is required"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    user = None
    try:
        if email:
            user = User.objects.get(email=email)
        elif username:
            try:
                user = User.objects.get(username=username)
            except User.DoesNotExist:
                if "@" in username:
                    user = User.objects.get(email=username)

        if user:
            try:
                profile = user.profile
                if not profile.email_verified and user.email:
                    token = generate_verification_token(user)
                    success, error = send_verification_email(user, token)
                    if not success:
                        logger.error(
                            f"Failed to send verification email to {user.email}: {error}"
                        )
            except UserProfile.DoesNotExist:
                pass
    except User.DoesNotExist:
        pass
    except Exception as e:
        logger.error(f"Error in resend_verification_email_public: {str(e)}")

    return Response(
        {"message": "If an account exists, a verification email has been sent"},
        status=status.HTTP_200_OK,
    )


@api_view(["POST"])
@permission_classes([AllowAny])
def request_password_reset(request):
    serializer = PasswordResetRequestSerializer(data=request.data)

    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    email = serializer.validated_data["email"]

    try:
        user = User.objects.get(email=email)
        token = generate_password_reset_token(user)
        success, error = send_password_reset_email(user, token)

        if not success:
            logger.error(f"Failed to send password reset email to {email}: {error}")
    except User.DoesNotExist:
        logger.debug(f"Password reset requested for non-existent email: {email}")
        pass
    except Exception as e:
        logger.error(f"Error in password reset request for {email}: {str(e)}")

    return Response(
        {
            "message": "If an account with this email exists, a password reset link has been sent"
        },
        status=status.HTTP_200_OK,
    )


@api_view(["POST"])
@permission_classes([AllowAny])
def reset_password(request, token):
    serializer = PasswordResetConfirmSerializer(data=request.data)

    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    user, error = verify_token(token, "password_reset")

    if error:
        return Response({"error": error}, status=status.HTTP_400_BAD_REQUEST)

    new_password = serializer.validated_data["password"]
    user.set_password(new_password)
    user.save()

    invalidate_token(token)

    return Response(
        {"message": "Password reset successfully"}, status=status.HTTP_200_OK
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def check_verification_status(request):
    try:
        profile = request.user.profile
        return Response(
            {"email_verified": profile.email_verified, "email": request.user.email}
        )
    except UserProfile.DoesNotExist:
        return Response({"email_verified": False, "email": request.user.email})


@api_view(["POST"])
@permission_classes([AllowAny])
def request_magic_verification_link(request):
    serializer = PasswordResetRequestSerializer(data=request.data)

    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    email = serializer.validated_data["email"]

    try:
        user = User.objects.get(email=email)
        token = generate_magic_verification_token(user)
        success, error = send_magic_verification_email(user, token)

        if not success:
            logger.error(f"Failed to send magic verification email to {email}: {error}")
            return Response(
                {"error": "Failed to send verification email. Please try again later."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    except User.DoesNotExist:
        logger.debug(
            f"Magic verification link requested for non-existent email: {email}"
        )
        pass
    except Exception as e:
        logger.error(f"Error in magic verification link request for {email}: {str(e)}")
        return Response(
            {"error": "An error occurred. Please try again later."},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    return Response(
        {
            "message": "If an account with this email exists, a verification link has been sent"
        },
        status=status.HTTP_200_OK,
    )


@api_view(["POST"])
@permission_classes([AllowAny])
def verify_magic_verification_link(request, token):
    user, error = verify_token(token, "magic_verification")

    if error:
        return Response({"error": error}, status=status.HTTP_400_BAD_REQUEST)

    invalidate_token(token)

    if not user.profile.email_verified:
        mark_email_as_verified(user)

    return Response(
        {"message": "Email verified successfully", "email": user.email},
        status=status.HTTP_200_OK,
    )
