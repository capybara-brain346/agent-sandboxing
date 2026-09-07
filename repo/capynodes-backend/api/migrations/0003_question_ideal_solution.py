from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0002_alter_submission_options_submission_user_userprofile'),
    ]

    operations = [
        migrations.AddField(
            model_name='question',
            name='ideal_solution',
            field=models.JSONField(blank=True, null=True),
        ),
    ]

