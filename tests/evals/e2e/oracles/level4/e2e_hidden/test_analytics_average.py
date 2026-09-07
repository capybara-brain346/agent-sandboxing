from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from api.models import Question, Submission, UserProfile
from api.stats_updater import update_user_stats


class AnalyticsAverageOracleTests(TestCase):
    def test_analytics_average_is_the_mean_across_submissions(self):
        user = User.objects.create_user(username="analytics", password="secret123")
        UserProfile.objects.create(user=user, email_verified=True)
        first = Question.objects.create(
            title="First", description="First", difficulty="Beginner", category="data"
        )
        second = Question.objects.create(
            title="Second", description="Second", difficulty="Beginner", category="data"
        )
        Submission.objects.create(user=user, question=first, diagram={}, score=40)
        Submission.objects.create(user=user, question=second, diagram={}, score=80)
        stats = update_user_stats(user)
        self.assertEqual(stats.average_score, 60)
        client = APIClient()
        client.force_authenticate(user)
        response = client.get("/api/analytics/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["average_score"], 60)
