from rest_framework import viewsets, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from ..models import (
    Question,
    Submission,
)
from ..serializers import (
    QuestionListSerializer,
    QuestionSerializer,
    SubmissionSerializer,
)
from .base import QuestionPagination, IsEmailVerified


class QuestionViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Question.objects.all()
    serializer_class = QuestionSerializer
    permission_classes = [IsAuthenticated, IsEmailVerified]
    pagination_class = QuestionPagination

    def get_serializer_class(self):
        if self.action == "list":
            return QuestionListSerializer
        return QuestionSerializer

    def get_queryset(self):
        queryset = Question.objects.all().order_by("id")

        if self.action == "list":
            queryset = queryset.only(
                "id", "title", "difficulty", "category", "created_at"
            )

        search_query = self.request.query_params.get("search", None)
        if search_query:
            queryset = queryset.filter(title__icontains=search_query)

        return queryset


@api_view(["GET"])
@permission_classes([IsAuthenticated, IsEmailVerified])
def question_submissions(request, question_id):
    try:
        question = Question.objects.get(id=question_id)
    except Question.DoesNotExist:
        return Response(
            {"error": "Question not found"}, status=status.HTTP_404_NOT_FOUND
        )

    submissions = (
        Submission.objects.filter(user=request.user, question=question)
        .select_related("question", "user")
        .order_by("-created_at")
    )

    serializer = SubmissionSerializer(submissions, many=True)
    return Response(serializer.data)
