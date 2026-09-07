from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from api.models import CustomNodeDefinition, UserProfile


class CustomNodeOwnershipOracleTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(username="owner", password="secret123")
        self.other = User.objects.create_user(username="other", password="secret123")
        UserProfile.objects.create(user=self.owner, email_verified=True)
        UserProfile.objects.create(user=self.other, email_verified=True)
        self.client = APIClient()
        self.payload = {
            "type": "queue",
            "label": "Queue",
            "category": "processing",
            "icon_name": "Box",
            "description": "A queue",
            "tooltip": "Queue tooltip",
            "properties": [],
            "inputs": 1,
            "outputs": 1,
        }

    def test_creation_assigns_owner_and_hides_user(self):
        self.client.force_authenticate(self.owner)
        response = self.client.post(
            "/api/custom-nodes/",
            {**self.payload, "user": self.other.pk},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertNotIn("user", response.data)
        node = CustomNodeDefinition.objects.get(type="queue")
        self.assertEqual(node.user_id, self.owner.pk)

    def test_all_reads_and_mutations_are_owner_scoped(self):
        owner_node = CustomNodeDefinition.objects.create(user=self.owner, **self.payload)
        other_node = CustomNodeDefinition.objects.create(
            user=self.other, type="database", label="Database", description="A database"
        )
        self.client.force_authenticate(self.owner)
        listing = self.client.get("/api/custom-nodes/")
        self.assertEqual(listing.status_code, 200)
        self.assertEqual([item["id"] for item in listing.data], [owner_node.id])
        self.assertEqual(self.client.get(f"/api/custom-nodes/{other_node.pk}/").status_code, 404)
        self.assertEqual(
            self.client.patch(
                f"/api/custom-nodes/{other_node.pk}/",
                {"label": "forged"},
                format="json",
            ).status_code,
            404,
        )
        self.assertEqual(self.client.delete(f"/api/custom-nodes/{other_node.pk}/").status_code, 404)
