import logging
from django.contrib.auth.models import User
from django.core.cache import cache
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from ..cache_utils import (
    cache_public_profile_response,
    cache_user_response,
    invalidate_user_cache,
)
from ..logging_utils import log_api_request
from ..models import (
    UserProfile,
)
from ..serializers import (
    PublicUserProfileSerializer,
    UserProfileSerializer,
    UserSerializer,
)
from .base import IsEmailVerified

logger = logging.getLogger(__name__)


@api_view(["GET", "PUT"])
@permission_classes([IsAuthenticated, IsEmailVerified])
@log_api_request
def user_profile(request):
    if request.method == "GET":
        cache_key = f"profile:user:{request.user.id}"

        try:
            cached_data = cache.get(cache_key)
            if cached_data:
                logger.debug(f"Cache hit for profile: {cache_key}")
                return Response(cached_data)
        except Exception as e:
            logger.warning(f"Cache read error for profile: {e}")

        try:
            profile = (
                UserProfile.objects.select_related("user")
                .only(
                    "id",
                    "bio",
                    "avatar_url",
                    "linkedin_url",
                    "twitter_url",
                    "github_url",
                    "website_url",
                    "total_score",
                    "problems_solved",
                    "created_at",
                    "updated_at",
                    "user__username",
                    "user__email",
                    "user__first_name",
                    "user__last_name",
                )
                .get(user=request.user)
            )
        except UserProfile.DoesNotExist:
            profile = UserProfile.objects.create(user=request.user)

        serializer = UserProfileSerializer(profile)

        try:
            cache.set(cache_key, serializer.data, 300)
            logger.debug(f"Cache set for profile: {cache_key}")
        except Exception as e:
            logger.warning(f"Cache write error for profile: {e}")

        return Response(serializer.data)

    elif request.method == "PUT":
        try:
            profile = request.user.profile
        except UserProfile.DoesNotExist:
            profile = UserProfile.objects.create(user=request.user)

        serializer = UserProfileSerializer(profile, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            invalidate_user_cache(request.user.id, request.user.username)
            return Response(serializer.data)

        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(["GET"])
@permission_classes([IsAuthenticated, IsEmailVerified])
@cache_user_response("analytics", timeout=300)
def user_analytics(request):
    try:
        profile = request.user.profile
    except UserProfile.DoesNotExist:
        profile = UserProfile.objects.create(user=request.user)

    stats = profile.update_stats()
    analytics = profile.get_analytics(stats=stats)
    return Response(analytics)


@api_view(["GET"])
@permission_classes([IsAuthenticated, IsEmailVerified])
@cache_user_response("current_user", timeout=300)
def current_user(request):
    user = (
        User.objects.select_related("profile")
        .only(
            "id",
            "username",
            "email",
            "first_name",
            "last_name",
            "profile__email_verified",
        )
        .get(pk=request.user.pk)
    )
    serializer = UserSerializer(user)
    return Response(serializer.data)


@api_view(["GET"])
@permission_classes([AllowAny])
@cache_public_profile_response("public_profile", timeout=300)
def public_profile(request, username):
    try:
        user = User.objects.get(username=username)
    except User.DoesNotExist:
        return Response({"error": "User not found"}, status=status.HTTP_404_NOT_FOUND)

    try:
        profile = (
            UserProfile.objects.select_related("user")
            .only(
                "id",
                "bio",
                "avatar_url",
                "linkedin_url",
                "twitter_url",
                "github_url",
                "website_url",
                "total_score",
                "problems_solved",
                "created_at",
                "updated_at",
                "user__username",
                "user__first_name",
                "user__last_name",
            )
            .get(user=user)
        )
    except UserProfile.DoesNotExist:
        profile = UserProfile.objects.create(user=user)

    serializer = PublicUserProfileSerializer(profile)

    is_owner = request.user.is_authenticated and request.user.id == user.id

    response_data = serializer.data
    response_data["is_owner"] = is_owner

    return Response(response_data)


@api_view(["GET"])
@permission_classes([AllowAny])
@cache_public_profile_response("public_analytics", timeout=300)
def public_user_analytics(request, username):
    try:
        user = User.objects.get(username=username)
    except User.DoesNotExist:
        return Response({"error": "User not found"}, status=status.HTTP_404_NOT_FOUND)

    try:
        profile = user.profile
    except UserProfile.DoesNotExist:
        profile = UserProfile.objects.create(user=user)

    stats = profile.update_stats()
    analytics = profile.get_analytics(stats=stats)
    return Response(analytics)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def delete_account(request):
    user = request.user
    has_password = user.has_usable_password()

    if has_password:
        password = request.data.get("password")
        if not password:
            return Response(
                {"error": "Password is required to delete your account."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not user.check_password(password):
            return Response(
                {"error": "Invalid password. Account deletion aborted."},
                status=status.HTTP_401_UNAUTHORIZED,
            )
    else:
        # For OAuth users without a password, we rely on their active session/token.
        confirm = request.data.get("confirm")
        if not confirm:
            return Response(
                {"error": "Please confirm account deletion."},
                status=status.HTTP_400_BAD_REQUEST,
            )

    try:
        user = request.user
        username = user.username
        user_id = user.id

        invalidate_user_cache(user_id, username)

        user.delete()

        logger.info(f"User {username} (ID: {user_id}) has deleted their account.")

        return Response(
            {"message": "Your account has been successfully deleted."},
            status=status.HTTP_200_OK,
        )
    except Exception as e:
        logger.error(f"Error deleting account for user {request.user.id}: {str(e)}")
        return Response(
            {
                "error": "An error occurred during account deletion. Please try again later."
            },
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )
