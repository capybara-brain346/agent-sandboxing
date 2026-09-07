from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated

from ..models import (
    CustomNodeDefinition,
)
from ..serializers import (
    CustomNodeDefinitionSerializer,
)
from .base import IsEmailVerified


class CustomNodeViewSet(viewsets.ModelViewSet):
    serializer_class = CustomNodeDefinitionSerializer
    permission_classes = [IsAuthenticated, IsEmailVerified]

    def get_queryset(self):
        return CustomNodeDefinition.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)
