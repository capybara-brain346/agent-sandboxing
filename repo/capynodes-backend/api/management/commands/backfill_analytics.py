from django.core.management.base import BaseCommand
from django.contrib.auth.models import User
from api.stats_updater import update_user_stats


class Command(BaseCommand):
    help = "Backfills user analytics (dimension scores, trends, component usage) for all users"

    def add_arguments(self, parser):
        parser.add_argument(
            "--user",
            type=str,
            help="Username to backfill for a specific user",
        )

    def handle(self, *args, **options):
        username = options.get("user")

        if username:
            try:
                users = [User.objects.get(username=username)]
                self.stdout.write(
                    self.style.SUCCESS(f"Backfilling for user: {username}")
                )
            except User.DoesNotExist:
                self.stdout.write(self.style.ERROR(f"User {username} not found"))
                return
        else:
            users = User.objects.all()
            self.stdout.write(
                self.style.SUCCESS(f"Backfilling for all {users.count()} users")
            )

        count = 0
        for user in users:
            try:
                update_user_stats(user)
                count += 1
                if count % 10 == 0:
                    self.stdout.write(f"Processed {count} users...")
            except Exception as e:
                self.stdout.write(
                    self.style.ERROR(f"Error updating {user.username}: {str(e)}")
                )

        self.stdout.write(
            self.style.SUCCESS(f"Successfully backfilled analytics for {count} users")
        )
