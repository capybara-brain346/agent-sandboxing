import logging
from django.conf import settings
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import BasePermission
from ..models import UserProfile

logger = logging.getLogger(__name__)


class QuestionPagination(PageNumberPagination):
    page_size = 10
    page_size_query_param = "page_size"
    max_page_size = 100


class IsEmailVerified(BasePermission):
    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False

        if settings.BYPASS_EMAIL_VERIFICATION:
            return True

        try:
            profile = request.user.profile
            return profile.email_verified
        except UserProfile.DoesNotExist:
            return False

    message = "Email verification required. Please verify your email address to access this resource."
