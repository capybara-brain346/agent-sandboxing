from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from ..cache_utils import (
    invalidate_user_cache,
)
from ..evaluation.evaluation_engine import evaluate_diagram
from ..evaluation.followup_generator import FollowUpQuestionsGenerator
from ..logging_utils import log_api_request
from ..models import (
    Question,
    Submission,
)
from ..services.credit_service import (
    NoCreditsError,
    RateLimitError,
)
from ..services.credit_service import (
    use_credit as use_credit_service,
)
from ..stats_updater import update_user_stats
from .base import IsEmailVerified


@api_view(["POST"])
@permission_classes([IsEmailVerified])
@log_api_request
def submit_evaluation(request):
    try:
        credit_status_data = use_credit_service(request.user)
    except NoCreditsError as e:
        return Response(
            {
                "error": "No credits remaining",
                "credits": e.credit_status,
                "message": "Credits exhausted. Please wait until credits reset.",
            },
            status=status.HTTP_402_PAYMENT_REQUIRED,
        )
    except RateLimitError as e:
        return Response({"error": str(e)}, status=status.HTTP_429_TOO_MANY_REQUESTS)

    question_id = request.data.get("questionId")
    nodes = request.data.get("nodes", [])
    edges = request.data.get("edges", [])

    if question_id == 0:
        custom_q = request.data.get("customQuestion", {})
        title = custom_q.get("title", "Custom Question")
        description = custom_q.get("description", "")
        constraints = custom_q.get("constraints", {})
        difficulty = custom_q.get("difficulty", "Intermediate")
        ideal_solution = None

        problem_statement = f"{title}\n\n{description}"
        is_custom = True
    else:
        try:
            question = Question.objects.get(id=question_id)
            title = question.title
            description = question.description
            constraints = question.constraints
            difficulty = question.difficulty
            ideal_solution = question.ideal_solution
            problem_statement = f"{title}\n\n{description}"
            is_custom = False
        except Question.DoesNotExist:
            return Response(
                {"error": "Question not found"}, status=status.HTTP_404_NOT_FOUND
            )

    evaluation_result = evaluate_diagram(
        problem_statement=problem_statement,
        constraints=constraints,
        nodes=nodes,
        edges=edges,
        difficulty=difficulty,
        ideal_solution=ideal_solution,
    )

    if not is_custom:
        Submission.objects.create(
            user=request.user,
            question=question,
            diagram={"nodes": nodes, "edges": edges},
            evaluation_result=evaluation_result,
            score=evaluation_result.get("overallScore", 0),
        )

        update_user_stats(request.user)

        if hasattr(request.user, "profile"):
            request.user.profile.update_stats()

        invalidate_user_cache(request.user.id, request.user.username)

    evaluation_result["credits"] = credit_status_data
    return Response(evaluation_result, status=status.HTTP_201_CREATED)


@api_view(["POST"])
@permission_classes([IsEmailVerified])
@log_api_request
def generate_follow_up_questions(request, question_id):
    try:
        credit_status_data = use_credit_service(request.user)
    except NoCreditsError as e:
        return Response(
            {
                "error": "No credits remaining",
                "credits": e.credit_status,
                "message": "Credits exhausted. Please wait until credits reset.",
            },
            status=status.HTTP_402_PAYMENT_REQUIRED,
        )
    except RateLimitError as e:
        return Response({"error": str(e)}, status=status.HTTP_429_TOO_MANY_REQUESTS)

    nodes = request.data.get("nodes", [])
    edges = request.data.get("edges", [])

    if question_id == 0:
        custom_q = request.data.get("customQuestion", {})
        title = custom_q.get("title", "Custom Question")
        description = custom_q.get("description", "")
        constraints = custom_q.get("constraints", {})
        problem_statement = f"{title}\n\n{description}"
    else:
        try:
            question = Question.objects.get(id=question_id)
            problem_statement = f"{question.title}\n\n{question.description}"
            constraints = question.constraints
        except Question.DoesNotExist:
            return Response(
                {"error": "Question not found"}, status=status.HTTP_404_NOT_FOUND
            )

    generator = FollowUpQuestionsGenerator(
        problem_statement=problem_statement,
        constraints=constraints,
        nodes=nodes,
        edges=edges,
    )

    result = generator.generate()

    if not result.get("success"):
        return Response(
            {
                "error": result.get("error", "Failed to generate questions"),
                "questions": [],
                "credits": credit_status_data,
            },
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    return Response(
        {
            "questions": result.get("questions", []),
            "credits": credit_status_data,
        },
        status=status.HTTP_200_OK,
    )
