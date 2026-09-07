from django.conf import settings
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.exceptions import InvalidToken
from django.utils.translation import gettext_lazy as _


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    def validate(self, attrs):
        data = super().validate(attrs)

        user = self.user
        if not user.is_active:
            raise InvalidToken(_("User is inactive"))

        try:
            profile = user.profile
            email_verified = profile.email_verified
        except Exception:
            email_verified = False

        if not email_verified and not getattr(
            settings, "BYPASS_EMAIL_VERIFICATION", False
        ):
            raise InvalidToken(
                {
                    "error": "Email verification required",
                    "message": "Please verify your email address before logging in.",
                    "email": user.email,
                    "requires_verification": True,
                }
            )

        from ..serializers import UserSerializer

        data["user"] = UserSerializer(user).data

        return data
