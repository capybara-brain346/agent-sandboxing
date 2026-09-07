from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    CustomNodeViewSet,
    QuestionViewSet,
    check_verification_status,
    credit_status,
    current_user,
    complete_onboarding,
    delete_account,
    generate_follow_up_questions,
    google_login,
    CookieTokenObtainPairView,
    CookieTokenRefreshView,
    CookieLogoutView,
    public_profile,
    public_user_analytics,
    question_submissions,
    register,
    request_magic_verification_link,
    request_password_reset,
    request_verification_email,
    resend_verification_email_public,
    reset_password,
    submit_evaluation,
    user_analytics,
    user_profile,
    verify_email,
    verify_magic_verification_link,
)

router = DefaultRouter()
router.register(r"questions", QuestionViewSet)
router.register(r"custom-nodes", CustomNodeViewSet, basename="custom-node")

urlpatterns = [
    path("", include(router.urls)),
    path("evaluate/", submit_evaluation),
    path("questions/<int:question_id>/submissions/", question_submissions),
    path(
        "questions/<int:question_id>/follow-up-questions/", generate_follow_up_questions
    ),
    path("auth/register/", register),
    path("auth/login/", CookieTokenObtainPairView.as_view(), name="token_obtain_pair"),
    path("auth/token/refresh/", CookieTokenRefreshView.as_view(), name="token_refresh"),
    path("auth/google/", google_login),
    path("auth/logout/", CookieLogoutView.as_view(), name="logout"),
    path("auth/me/", current_user),
    path("auth/verify-email/request/", request_verification_email),
    path("auth/verify-email/resend/", resend_verification_email_public),
    path("auth/verify-email/<str:token>/", verify_email),
    path("auth/password-reset/request/", request_password_reset),
    path("auth/password-reset/<str:token>/", reset_password),
    path("auth/magic-link/request/", request_magic_verification_link),
    path("auth/magic-link/verify/<str:token>/", verify_magic_verification_link),
    path("auth/complete-onboarding/", complete_onboarding),
    path("auth/verification-status/", check_verification_status),
    path("auth/delete-account/", delete_account),
    path("profile/", user_profile),
    path("analytics/", user_analytics),
    path("users/<str:username>/", public_profile),
    path("users/<str:username>/analytics/", public_user_analytics),
    path("credits/", credit_status),
]
