from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from ..services.credit_service import (
    RateLimitError,
    get_credit_status,
)
from .base import IsEmailVerified


@api_view(["GET"])
@permission_classes([IsEmailVerified])
def credit_status(request):
    try:
        status_data = get_credit_status(request.user)
        return Response(status_data, status=status.HTTP_200_OK)
    except RateLimitError as e:
        return Response({"error": str(e)}, status=status.HTTP_429_TOO_MANY_REQUESTS)
