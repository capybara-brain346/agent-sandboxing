from django.conf import settings
from rest_framework import status
from rest_framework.response import Response
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from ..serializers.auth_jwt import CustomTokenObtainPairSerializer


import logging

logger = logging.getLogger(__name__)


def get_tokens_for_user(user):
    refresh = RefreshToken.for_user(user)
    return {
        "refresh": str(refresh),
        "access": str(refresh.access_token),
    }


def set_refresh_cookie(response, refresh_token):
    cookie_settings = settings.SIMPLE_JWT.get("COOKIE", {})
    refresh_cookie_name = cookie_settings.get("REFRESH_COOKIE", "refresh_token")
    httponly = cookie_settings.get("REFRESH_COOKIE_HTTP_ONLY", True)
    secure = cookie_settings.get("REFRESH_COOKIE_SECURE", True)
    samesite = cookie_settings.get("REFRESH_COOKIE_SAMESITE", "None")
    path = cookie_settings.get("REFRESH_COOKIE_PATH", "/")

    response.set_cookie(
        refresh_cookie_name,
        refresh_token,
        max_age=settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"].total_seconds(),
        httponly=httponly,
        secure=secure,
        samesite=samesite,
        path=path,
    )


class CookieTokenObtainPairView(TokenObtainPairView):
    serializer_class = CustomTokenObtainPairSerializer

    def post(self, request, *args, **kwargs):
        response = super().post(request, *args, **kwargs)
        if response.status_code == 200:
            refresh_token = response.data.get("refresh")
            set_refresh_cookie(response, refresh_token)
            del response.data["refresh"]
        return response


class CookieTokenRefreshView(TokenRefreshView):
    def post(self, request, *args, **kwargs):
        cookie_settings = settings.SIMPLE_JWT.get("COOKIE", {})
        refresh_cookie_name = cookie_settings.get("REFRESH_COOKIE", "refresh_token")

        refresh_token = request.COOKIES.get(refresh_cookie_name)

        if refresh_token:
            data = request.data.copy()
            data["refresh"] = refresh_token
            serializer = self.get_serializer(data=data)

            try:
                serializer.is_valid(raise_exception=True)
            except TokenError as e:
                logger.error(f"Token refresh failed: {str(e)}")
                raise InvalidToken(e.args[0])

            response = Response(serializer.validated_data, status=status.HTTP_200_OK)

            if settings.SIMPLE_JWT.get("ROTATE_REFRESH_TOKENS", False):
                new_refresh_token = serializer.validated_data.get("refresh")
                if new_refresh_token:
                    set_refresh_cookie(response, new_refresh_token)
                    del response.data["refresh"]

            logger.info("Token refreshed successfully using cookie.")
            return response

        logger.warning(
            f"Refresh token not found in cookies (searching for '{refresh_cookie_name}')"
        )
        return Response(
            {"detail": "Refresh token not found in cookies"},
            status=status.HTTP_401_UNAUTHORIZED,
        )


class CookieLogoutView(CookieTokenRefreshView):
    def post(self, request, *args, **kwargs):
        response = Response(
            {"message": "Logged out successfully"}, status=status.HTTP_200_OK
        )

        cookie_settings = settings.SIMPLE_JWT.get("COOKIE", {})
        refresh_cookie_name = cookie_settings.get("REFRESH_COOKIE", "refresh_token")

        response.delete_cookie(
            refresh_cookie_name,
            path=cookie_settings.get("REFRESH_COOKIE_PATH", "/"),
            samesite=cookie_settings.get("REFRESH_COOKIE_SAMESITE", "None"),
        )

        return response
