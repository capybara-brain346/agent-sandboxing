from unittest.mock import patch
from django.test import TestCase
from django.contrib.auth.models import User
from rest_framework.test import APIClient
from api.models import UserProfile


class GoogleAuthTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.google_login_url = "/api/auth/google/"

    @patch("google.oauth2.id_token.verify_oauth2_token")
    def test_google_login_new_user(self, mock_verify):
        """Test that a new user is created when logging in with Google for the first time."""
        # Mock Google token verification response
        mock_verify.return_value = {
            "email": "newuser@gmail.com",
            "given_name": "New",
            "family_name": "User",
            "picture": "http://example.com/avatar.jpg",
        }

        response = self.client.post(self.google_login_url, {"credential": "fake-token"})

        self.assertEqual(response.status_code, 200)
        self.assertIn("access", response.data)
        self.assertIn("user", response.data)
        self.assertEqual(response.data["user"]["email"], "newuser@gmail.com")

        # Check if user and profile were created
        user = User.objects.get(email="newuser@gmail.com")
        self.assertEqual(user.first_name, "New")
        self.assertEqual(user.last_name, "User")

        profile = UserProfile.objects.get(user=user)
        self.assertTrue(profile.email_verified)
        self.assertEqual(profile.avatar_url, "http://example.com/avatar.jpg")

    @patch("google.oauth2.id_token.verify_oauth2_token")
    def test_google_login_existing_unverified_user(self, mock_verify):
        """Test that an existing unverified user is verified and logged in."""
        user = User.objects.create_user(username="existing", email="existing@gmail.com")
        profile = UserProfile.objects.create(user=user, email_verified=False)

        mock_verify.return_value = {
            "email": "existing@gmail.com",
            "given_name": "Existing",
            "family_name": "User",
            "picture": "http://example.com/avatar.jpg",
        }

        response = self.client.post(self.google_login_url, {"credential": "fake-token"})

        self.assertEqual(response.status_code, 200)

        profile.refresh_from_db()
        self.assertTrue(profile.email_verified)
        self.assertEqual(User.objects.count(), 1)  # only existing

    @patch("google.oauth2.id_token.verify_oauth2_token")
    def test_google_login_invalid_token(self, mock_verify):
        """Test that an invalid token returns a 400 error."""
        mock_verify.side_effect = ValueError("Invalid token")

        response = self.client.post(
            self.google_login_url, {"credential": "invalid-token"}
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["error"], "Invalid Google credential")

    def test_complete_onboarding(self):
        """Test that a user can complete onboarding by setting profile details."""
        user = User.objects.create_user(username="temp", email="newuser@gmail.com")
        profile = UserProfile.objects.create(user=user, onboarding_completed=False)
        self.client.force_authenticate(user=user)

        response = self.client.post(
            "/api/auth/complete-onboarding/",
            {"username": "final_username", "first_name": "New", "last_name": "User"},
        )

        self.assertEqual(response.status_code, 200)
        user.refresh_from_db()
        profile.refresh_from_db()

        self.assertEqual(user.username, "final_username")
        self.assertEqual(user.first_name, "New")
        self.assertTrue(profile.onboarding_completed)

    def test_delete_account_without_password(self):
        """Test that an OAuth user without a password can delete their account with a confirm flag."""
        user = User.objects.create_user(username="oauth_user", email="oauth@gmail.com")
        user.set_unusable_password()
        user.save()
        self.client.force_authenticate(user=user)

        # Should fail without confirm
        response = self.client.post("/api/auth/delete-account/", {})
        self.assertEqual(response.status_code, 400)

        # Should succeed with confirm
        response = self.client.post("/api/auth/delete-account/", {"confirm": True})
        self.assertEqual(response.status_code, 200)
        self.assertFalse(User.objects.filter(id=user.id).exists())
