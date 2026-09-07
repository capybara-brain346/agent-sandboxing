from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone

from .models import CreditBalance


class CreditSystemTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="testuser", password="password")
        self.balance = CreditBalance.objects.create(user=self.user)

    def test_initial_balance(self):
        """Test that a new user starts with default credits."""
        status = self.balance.get_status()
        self.assertEqual(status["credits_remaining"], 20)
        self.assertEqual(status["max_credits"], 20)
        self.assertIsNone(status["reset_at"])

    def test_credit_usage(self):
        """Test that using a credit decreases the balance and updates timings."""
        success = self.balance.use_credit()
        self.assertTrue(success)
        self.balance.refresh_from_db()
        self.assertEqual(self.balance.credits_remaining, 19)
        self.assertIsNotNone(self.balance.last_credit_used_at)

    def test_credit_reset_after_24h_from_last_usage(self):
        """Test that credits reset 24 hours after the LAST usage."""
        # Use 1 credit
        self.balance.use_credit()

        # Advance 1 hour
        now = timezone.now()
        first_usage_time = now

        # Use another credit 11 hours later
        later_time = first_usage_time + timedelta(hours=11)
        with patch("django.utils.timezone.now", return_value=later_time):
            self.balance.use_credit()
            # This second usage SHOULD extend the reset time

        # Verify reset logic depends on LAST usage time
        # Time = First usage + 24h + 1s (Should NOT reset yet because of second usage)
        check_time_no_reset = first_usage_time + timedelta(hours=24, seconds=1)

        with patch("django.utils.timezone.now", return_value=check_time_no_reset):
            self.balance.refresh_from_db()
            should_reset = self.balance.needs_reset
            self.assertFalse(
                should_reset, "Should NOT reset 24h after FIRST usage if used again"
            )

        # Time = Second usage + 24h + 1s (Should reset here)
        check_time_reset = later_time + timedelta(hours=24, seconds=1)

        with patch("django.utils.timezone.now", return_value=check_time_reset):
            self.balance.refresh_from_db()
            should_reset = self.balance.needs_reset
            self.assertTrue(should_reset, "Should reset 24h after LAST usage")

            # Trigger reset
            self.balance.reset_if_needed()
            self.assertEqual(self.balance.credits_remaining, 20)

    def test_usage_extends_reset(self):
        """
        Verify that using credits continuously DOES push the reset time back.
        """
        self.balance.use_credit()
        initial_reset = self.balance.reset_available_at

        # Advance 1 hour and use another
        next_hour = timezone.now() + timedelta(hours=1)
        with patch("django.utils.timezone.now", return_value=next_hour):
            self.balance.use_credit()
            self.balance.refresh_from_db()
            new_reset = self.balance.reset_available_at

            self.assertNotEqual(new_reset, initial_reset)
            self.assertTrue(new_reset > initial_reset)
