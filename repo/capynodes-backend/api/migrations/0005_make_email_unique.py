from django.db import migrations


def handle_duplicate_emails(apps, schema_editor):
    User = apps.get_model('auth', 'User')
    db_alias = schema_editor.connection.alias
    
    duplicates = {}
    for user in User.objects.using(db_alias).filter(email__isnull=False).exclude(email='').order_by('email', 'id'):
        email = user.email
        if email in duplicates:
            user.email = f"{email}.duplicate{duplicates[email]}"
            user.save(using=db_alias)
            duplicates[email] += 1
        else:
            duplicates[email] = 1


def add_unique_constraint(apps, schema_editor):
    if schema_editor.connection.vendor == 'postgresql':
        schema_editor.execute(
            'CREATE UNIQUE INDEX auth_user_email_unique ON auth_user (email) WHERE email != \'\';'
        )
    elif schema_editor.connection.vendor == 'sqlite':
        schema_editor.execute(
            'CREATE UNIQUE INDEX auth_user_email_unique ON auth_user (email) WHERE email != \'\';'
        )
    elif schema_editor.connection.vendor == 'mysql':
        schema_editor.execute(
            'ALTER TABLE auth_user ADD CONSTRAINT auth_user_email_unique UNIQUE (email);'
        )


def remove_unique_constraint(apps, schema_editor):
    if schema_editor.connection.vendor in ['postgresql', 'sqlite']:
        schema_editor.execute('DROP INDEX IF EXISTS auth_user_email_unique;')
    elif schema_editor.connection.vendor == 'mysql':
        schema_editor.execute('ALTER TABLE auth_user DROP INDEX auth_user_email_unique;')


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0004_alter_question_options_userprofile_email_verified_and_more'),
    ]

    operations = [
        migrations.RunPython(handle_duplicate_emails, migrations.RunPython.noop),
        migrations.RunPython(add_unique_constraint, remove_unique_constraint),
    ]

