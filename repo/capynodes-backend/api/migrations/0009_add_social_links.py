from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0008_alter_emailverificationtoken_expires_at_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='userprofile',
            name='linkedin_url',
            field=models.URLField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='userprofile',
            name='twitter_url',
            field=models.URLField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='userprofile',
            name='github_url',
            field=models.URLField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='userprofile',
            name='website_url',
            field=models.URLField(blank=True, null=True),
        ),
    ]

