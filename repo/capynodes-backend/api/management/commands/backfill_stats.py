from django.core.management.base import BaseCommand
from django.contrib.auth.models import User
from api.stats_updater import update_user_stats


class Command(BaseCommand):
    help = "Backfill UserStats for all existing users"

    def handle(self, *args, **options):
        users = User.objects.all()
        total = users.count()

        for i, user in enumerate(users, 1):
            update_user_stats(user)
            self.stdout.write(f"Updated stats for {user.username} ({i}/{total})")

        self.stdout.write(
            self.style.SUCCESS(f"Successfully backfilled stats for {total} users")
        )
