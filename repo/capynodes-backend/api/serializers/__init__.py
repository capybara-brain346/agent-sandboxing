from django.contrib.auth.models import User
from rest_framework import serializers

from ..models import CustomNodeDefinition, Question, Submission, UserProfile


class UserSerializer(serializers.ModelSerializer):
    email_verified = serializers.SerializerMethodField()
    has_password = serializers.SerializerMethodField()
    onboarding_completed = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "email",
            "first_name",
            "last_name",
            "email_verified",
            "has_password",
            "onboarding_completed",
        ]
        read_only_fields = ["id", "email_verified"]

    def get_email_verified(self, obj):
        try:
            return obj.profile.email_verified
        except UserProfile.DoesNotExist:
            return False

    def get_has_password(self, obj):
        return obj.has_usable_password()

    def get_onboarding_completed(self, obj):
        try:
            return obj.profile.onboarding_completed
        except UserProfile.DoesNotExist:
            return True


class UserProfileSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source="user.username", read_only=True)
    email = serializers.EmailField(source="user.email", read_only=True)
    first_name = serializers.CharField(
        source="user.first_name", required=False, allow_blank=True
    )
    last_name = serializers.CharField(
        source="user.last_name", required=False, allow_blank=True
    )

    class Meta:
        model = UserProfile
        fields = [
            "id",
            "username",
            "email",
            "first_name",
            "last_name",
            "bio",
            "avatar_url",
            "linkedin_url",
            "twitter_url",
            "github_url",
            "website_url",
            "total_score",
            "problems_solved",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "total_score",
            "problems_solved",
            "created_at",
            "updated_at",
        ]

    def update(self, instance, validated_data):
        user_data = {}
        if "user" in validated_data:
            user_data = validated_data.pop("user")

        if user_data:
            user = instance.user
            if "first_name" in user_data:
                user.first_name = user_data["first_name"]
            if "last_name" in user_data:
                user.last_name = user_data["last_name"]
            user.save()

        return super().update(instance, validated_data)


class PublicUserProfileSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source="user.username", read_only=True)
    first_name = serializers.CharField(source="user.first_name", read_only=True)
    last_name = serializers.CharField(source="user.last_name", read_only=True)

    class Meta:
        model = UserProfile
        fields = [
            "id",
            "username",
            "first_name",
            "last_name",
            "bio",
            "avatar_url",
            "linkedin_url",
            "twitter_url",
            "github_url",
            "website_url",
            "total_score",
            "problems_solved",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=6, max_length=16)
    password_confirm = serializers.CharField(
        write_only=True, min_length=6, max_length=16
    )

    class Meta:
        model = User
        fields = [
            "username",
            "email",
            "password",
            "password_confirm",
            "first_name",
            "last_name",
        ]

    def validate_username(self, value):
        import re

        if not re.match(r"^[a-zA-Z0-9_-]+$", value):
            raise serializers.ValidationError(
                "Username can only contain alphanumeric characters, underscores, and hyphens."
            )
        if User.objects.filter(username=value).exists():
            raise serializers.ValidationError("This username is already taken.")
        return value

    def validate_email(self, value):
        if value and User.objects.filter(email=value).exists():
            raise serializers.ValidationError("A user with this email already exists.")
        return value

    def validate(self, data):
        if data["password"] != data["password_confirm"]:
            raise serializers.ValidationError(
                {"password_confirm": "Passwords do not match"}
            )
        return data

    def create(self, validated_data):
        validated_data.pop("password_confirm")
        user = User.objects.create_user(
            username=validated_data["username"],
            email=validated_data.get("email", ""),
            password=validated_data["password"],
            first_name=validated_data.get("first_name", ""),
            last_name=validated_data.get("last_name", ""),
        )
        UserProfile.objects.create(user=user)
        return user


class QuestionListSerializer(serializers.ModelSerializer):
    class Meta:
        model = Question
        fields = ["id", "title", "difficulty", "category", "created_at"]


class QuestionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Question
        fields = "__all__"


class SubmissionSerializer(serializers.ModelSerializer):
    question_title = serializers.CharField(source="question.title", read_only=True)
    question_difficulty = serializers.CharField(
        source="question.difficulty", read_only=True
    )
    username = serializers.CharField(source="user.username", read_only=True)

    class Meta:
        model = Submission
        fields = "__all__"
        read_only_fields = ["user", "created_at"]


class EmailVerificationSerializer(serializers.Serializer):
    email = serializers.EmailField(required=False)


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField(required=True)

    def validate_email(self, value):
        if not User.objects.filter(email=value).exists():
            pass
        return value


class PasswordResetConfirmSerializer(serializers.Serializer):
    password = serializers.CharField(write_only=True, min_length=6, required=True)
    password_confirm = serializers.CharField(
        write_only=True, min_length=6, required=True
    )

    def validate(self, data):
        if data["password"] != data["password_confirm"]:
            raise serializers.ValidationError("Passwords do not match")
        return data


class CustomNodeDefinitionSerializer(serializers.ModelSerializer):
    class Meta:
        model = CustomNodeDefinition
        fields = [
            "id",
            "type",
            "label",
            "category",
            "icon_name",
            "description",
            "tooltip",
            "properties",
            "inputs",
            "outputs",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


# Import from other files in the package
from .auth_jwt import CustomTokenObtainPairSerializer
