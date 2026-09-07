# Email System Documentation

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Email Verification Flow](#email-verification-flow)
4. [Password Reset Flow](#password-reset-flow)
5. [API Endpoints](#api-endpoints)
6. [Environment Variables](#environment-variables)
7. [Email Templates](#email-templates)
8. [Security Considerations](#security-considerations)
9. [Testing Guide](#testing-guide)
10. [Troubleshooting](#troubleshooting)

## Overview

The CapyNodes email system provides two core functionalities:

1. **Email Verification**: Required verification system - users must verify their email address before they can access the platform. Once verified, no further verification is needed.

2. **Password Reset**: Secure password reset flow using time-limited tokens sent via email.

### Key Features

- Token-based verification with 1-hour expiration
- Secure token hashing in database
- One-time use tokens
- Beautiful HTML email templates with plain text fallbacks
- SMTP support for multiple email providers
- Comprehensive permission system to protect endpoints

## Architecture

### System Components

```
┌─────────────────┐
│   Frontend      │
│  (Vercel App)   │
└────────┬────────┘
         │
         │ HTTP/REST
         │
┌────────▼────────┐
│  Django Backend │
│   (Railway)     │
├─────────────────┤
│  • API Views    │
│  • Permissions  │
│  • Serializers  │
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
┌───▼──┐  ┌──▼──────┐
│ Token│  │  Email  │
│Service│  │ Service │
└───┬──┘  └──┬──────┘
    │        │
    │   ┌────▼─────┐
    │   │   SMTP   │
    │   │  Server  │
    │   └──────────┘
    │
┌───▼─────────────┐
│    Database     │
│  • UserProfile  │
│  • EmailToken   │
└─────────────────┘
```

### Database Models

#### UserProfile Model

```python
email_verified: BooleanField(default=False)
email_verified_at: DateTimeField(null=True, blank=True)
```

#### EmailVerificationToken Model

```python
user: ForeignKey(User)
token_hash: CharField(max_length=64, unique=True)
token_type: CharField(choices=['verification', 'password_reset'])
created_at: DateTimeField(auto_now_add=True)
expires_at: DateTimeField()
used: BooleanField(default=False)
```

## Email Verification Flow

### Step-by-Step Process

1. **User Registration**

   - User submits registration form with email
   - Backend creates user account with `email_verified=False`
   - Verification token is generated and stored (hashed)
   - Verification email is sent to user's email address
   - User receives auth token but cannot access protected endpoints

2. **Email Sent**

   - User receives email with verification link
   - Link format: `https://capynodes-frontend.vercel.app/verify-email/{token}`
   - Token is valid for 1 hour

3. **User Clicks Link**

   - Frontend receives token from URL
   - Frontend sends POST request to `/api/auth/verify-email/{token}/`
   - Backend validates token (checks expiration, used status)
   - If valid: marks `email_verified=True`, `email_verified_at=now()`
   - Token is marked as used

4. **Access Granted**
   - User can now log in successfully
   - All protected endpoints are now accessible
   - Verification status persists permanently

### Sequence Diagram

```
User → Frontend → Backend → Database → Email Service
  │        │          │          │           │
  │──Register────────→│          │           │
  │        │          │──Create──→│           │
  │        │          │          User        │
  │        │          │    (verified=False)  │
  │        │          │──Token───→│           │
  │        │          │──Send Email──────────→│
  │        │←─Response│          │           │
  │        │    (token,          │           │
  │        │   verified=false)   │           │
  │        │          │          │           │
  │←─────Email────────────────────────────────│
  │  (with link)     │          │           │
  │        │          │          │           │
  │─Click Link──────→│          │           │
  │        │──POST────→│          │           │
  │        │  /verify │──Validate→│           │
  │        │          │──Update──→│           │
  │        │          │    (verified=True)    │
  │        │←─Success─│          │           │
  │        │          │          │           │
  │──Login──────────→│          │           │
  │        │          │──Check───→│           │
  │        │          │  (verified=True)      │
  │        │←─Token───│          │           │
  │   Access Granted │          │           │
```

## Password Reset Flow

### Step-by-Step Process

1. **Request Password Reset**

   - User enters email address
   - Backend finds user by email
   - Password reset token is generated
   - Reset email is sent
   - Always returns success (don't reveal if email exists)

2. **Email Sent**

   - User receives email with reset link
   - Link format: `https://capynodes-frontend.vercel.app/reset-password/{token}`
   - Token valid for 1 hour

3. **Reset Password**
   - User clicks link, enters new password
   - Frontend sends POST to `/api/auth/password-reset/{token}/`
   - Backend validates token
   - If valid: updates password, marks token as used
   - User can now login with new password

## API Endpoints

### Authentication Endpoints

#### 1. Register User

```http
POST /api/auth/register/
```

**Request Body:**

```json
{
  "username": "johndoe",
  "email": "john@example.com",
  "password": "secure_password",
  "password_confirm": "secure_password",
  "first_name": "John",
  "last_name": "Doe"
}
```

**Response (201 Created):**

```json
{
  "user": {
    "id": 1,
    "username": "johndoe",
    "email": "john@example.com",
    "first_name": "John",
    "last_name": "Doe",
    "email_verified": false
  },
  "token": "abc123...",
  "message": "Registration successful. Please verify your email to access the platform."
}
```

#### 2. Login

```http
POST /api/auth/login/
```

**Request Body:**

```json
{
  "username": "johndoe",
  "password": "secure_password"
}
```

**Success Response (200 OK):**

```json
{
  "user": {
    "id": 1,
    "username": "johndoe",
    "email": "john@example.com",
    "email_verified": true
  },
  "token": "abc123..."
}
```

**Error Response - Unverified Email (403 Forbidden):**

```json
{
  "error": "Email verification required",
  "message": "Please verify your email address before logging in. Check your inbox for the verification link.",
  "email": "john@example.com"
}
```

### Email Verification Endpoints

#### 3. Request Verification Email (Resend)

```http
POST /api/auth/verify-email/request/
```

**Headers:**

```
Authorization: Token abc123...
```

**Response (200 OK):**

```json
{
  "message": "Verification email sent successfully"
}
```

**Error - Already Verified (200 OK):**

```json
{
  "message": "Email already verified"
}
```

#### 4. Verify Email

```http
POST /api/auth/verify-email/{token}/
```

**No authentication required**

**Response (200 OK):**

```json
{
  "message": "Email verified successfully"
}
```

**Error Response (400 Bad Request):**

```json
{
  "error": "Token is invalid or expired"
}
```

#### 5. Check Verification Status

```http
GET /api/auth/verification-status/
```

**Headers:**

```
Authorization: Token abc123...
```

**Response (200 OK):**

```json
{
  "email_verified": true,
  "email": "john@example.com"
}
```

### Password Reset Endpoints

#### 6. Request Password Reset

```http
POST /api/auth/password-reset/request/
```

**Request Body:**

```json
{
  "email": "john@example.com"
}
```

**Response (200 OK):**

```json
{
  "message": "If an account with this email exists, a password reset link has been sent"
}
```

#### 7. Reset Password

```http
POST /api/auth/password-reset/{token}/
```

**Request Body:**

```json
{
  "password": "new_secure_password",
  "password_confirm": "new_secure_password"
}
```

**Success Response (200 OK):**

```json
{
  "message": "Password reset successfully"
}
```

**Error Response (400 Bad Request):**

```json
{
  "error": "Token is invalid or expired"
}
```

### Protected Endpoints

The following endpoints require both authentication AND email verification:

- `GET /api/questions/` - List questions
- `GET /api/questions/{id}/` - Get question details
- `POST /api/evaluate/` - Submit evaluation
- `GET /api/questions/{id}/submissions/` - Get submissions
- `GET /api/profile/` - Get user profile
- `PUT /api/profile/` - Update user profile
- `GET /api/analytics/` - Get user analytics
- `GET /api/auth/me/` - Get current user

**Error Response for Unverified Users (403 Forbidden):**

```json
{
  "detail": "Email verification required. Please verify your email address to access this resource."
}
```

## Environment Variables

Configure these in your `.env` file:

```bash
EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USE_TLS=True
EMAIL_HOST_USER=your-email@gmail.com
EMAIL_HOST_PASSWORD=your-app-password
DEFAULT_FROM_EMAIL=noreply@capynodes.com
FRONTEND_URL=https://capynodes-frontend.vercel.app
```

### Email Provider Setup

#### Gmail

1. Enable 2-Factor Authentication
2. Generate App Password: [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
3. Use App Password as `EMAIL_HOST_PASSWORD`

#### SendGrid

```bash
EMAIL_HOST=smtp.sendgrid.net
EMAIL_PORT=587
EMAIL_HOST_USER=apikey
EMAIL_HOST_PASSWORD=your-sendgrid-api-key
```

#### AWS SES

```bash
EMAIL_HOST=email-smtp.us-east-1.amazonaws.com
EMAIL_PORT=587
EMAIL_HOST_USER=your-ses-smtp-username
EMAIL_HOST_PASSWORD=your-ses-smtp-password
```

### Development Setup

For development, use Django's console backend (emails print to console):

```bash
EMAIL_BACKEND=django.core.mail.backends.console.EmailBackend
```

## Email Templates

### Template Location

```
api/templates/emails/
├── verification_email.html
├── verification_email.txt
├── password_reset_email.html
└── password_reset_email.txt
```

### Customization

Templates use Django template language with these context variables:

**Verification Email:**

- `{{ user }}` - User object
- `{{ user.username }}` - Username
- `{{ verification_url }}` - Full verification URL
- `{{ site_name }}` - Site name (CapyNodes)

**Password Reset Email:**

- `{{ user }}` - User object
- `{{ user.username }}` - Username
- `{{ reset_url }}` - Full password reset URL
- `{{ site_name }}` - Site name (CapyNodes)

### Example Customization

Edit `api/templates/emails/verification_email.html`:

```html
<p>Hi {{ user.username }},</p>
<p>Your custom message here...</p>
<a href="{{ verification_url }}">Verify Email</a>
```

## Security Considerations

### Token Security

1. **Hashing**: Tokens are hashed with SHA-256 before storage
2. **One-time Use**: Tokens are marked as used after verification
3. **Time-Limited**: Tokens expire after 1 hour
4. **Secure Generation**: Uses Python's `secrets` module (cryptographically secure)

### Best Practices

1. **HTTPS Only**: Always use HTTPS in production
2. **Email Privacy**: Password reset endpoint doesn't reveal if email exists
3. **Rate Limiting**: Consider adding rate limiting to prevent abuse
4. **Token Length**: Tokens are 32 bytes (256 bits) URL-safe base64 encoded

### Email Security

1. Use TLS for SMTP connections (`EMAIL_USE_TLS=True`)
2. Store credentials in environment variables
3. Use app-specific passwords for Gmail
4. Never commit email credentials to version control

## Testing Guide

### Manual Testing

#### 1. Test Email Verification Flow

```bash
# Register a new user
curl -X POST http://localhost:8000/api/auth/register/ \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser",
    "email": "test@example.com",
    "password": "testpass123",
    "password_confirm": "testpass123"
  }'

# Try to login (should fail - unverified)
curl -X POST http://localhost:8000/api/auth/login/ \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser",
    "password": "testpass123"
  }'

# Check email for verification link
# Click link or use token to verify

# Verify email (replace TOKEN with actual token)
curl -X POST http://localhost:8000/api/auth/verify-email/TOKEN/

# Try login again (should succeed)
curl -X POST http://localhost:8000/api/auth/login/ \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser",
    "password": "testpass123"
  }'
```

#### 2. Test Password Reset Flow

```bash
# Request password reset
curl -X POST http://localhost:8000/api/auth/password-reset/request/ \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com"
  }'

# Check email for reset link
# Use token to reset password

# Reset password (replace TOKEN)
curl -X POST http://localhost:8000/api/auth/password-reset/TOKEN/ \
  -H "Content-Type: application/json" \
  -d '{
    "password": "newpass123",
    "password_confirm": "newpass123"
  }'

# Login with new password
curl -X POST http://localhost:8000/api/auth/login/ \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser",
    "password": "newpass123"
  }'
```

### Automated Testing

Create tests in `api/tests.py`:

```python
from django.test import TestCase
from django.contrib.auth.models import User
from api.services.token_service import generate_verification_token, verify_token

class EmailVerificationTests(TestCase):
    def test_token_generation(self):
        user = User.objects.create_user('test', 'test@example.com', 'pass123')
        token = generate_verification_token(user)
        self.assertIsNotNone(token)

    def test_token_verification(self):
        user = User.objects.create_user('test', 'test@example.com', 'pass123')
        token = generate_verification_token(user)
        verified_user, error = verify_token(token, 'verification')
        self.assertIsNone(error)
        self.assertEqual(verified_user.id, user.id)

    def test_expired_token(self):
        pass

    def test_used_token(self):
        pass
```

## Troubleshooting

### Common Issues

#### 1. Emails Not Sending

**Symptom**: No emails received, no errors shown

**Solutions**:

- Check email credentials in `.env`
- Verify SMTP settings for your provider
- Check spam/junk folder
- Review Django logs for email errors
- Test with console backend first

```python
# In settings.py for debugging
EMAIL_BACKEND = 'django.core.mail.backends.console.EmailBackend'
```

#### 2. Token Invalid or Expired

**Symptom**: "Token is invalid or expired" error

**Possible Causes**:

- Token was already used
- More than 1 hour has passed
- Token was manually edited/corrupted
- User doesn't exist

**Solution**:

- Request a new verification email
- Check token hasn't been modified in transit
- Verify database contains the token (hashed)

#### 3. Login Fails After Verification

**Symptom**: User verified email but still can't login

**Debug Steps**:

```python
# Django shell
python manage.py shell

from django.contrib.auth.models import User
user = User.objects.get(username='testuser')
print(user.profile.email_verified)  # Should be True
print(user.profile.email_verified_at)  # Should have timestamp
```

#### 4. Permission Denied on Protected Endpoints

**Symptom**: 403 Forbidden on API calls

**Solutions**:

- Verify user is authenticated (has valid token)
- Check email_verified status: `/api/auth/verification-status/`
- Ensure Authorization header is included: `Authorization: Token abc123...`

#### 5. SMTP Authentication Failed

**Symptom**: Authentication error when sending emails

**Gmail Specific**:

- Enable 2FA on Google account
- Create App Password
- Use App Password (not regular password)

**Generic**:

- Verify EMAIL_HOST_USER is correct
- Check EMAIL_HOST_PASSWORD is correct
- Ensure EMAIL_PORT matches provider (usually 587 for TLS)
- Confirm EMAIL_USE_TLS=True

### Debug Commands

```bash
# Check migrations
uv run python manage.py showmigrations api

# Test email sending from Django shell
uv run python manage.py shell
>>> from django.core.mail import send_mail
>>> send_mail('Test', 'Test message', 'from@example.com', ['to@example.com'])

# Check user verification status
uv run python manage.py shell
>>> from django.contrib.auth.models import User
>>> user = User.objects.get(username='testuser')
>>> user.profile.email_verified

# View all tokens for a user
>>> user.email_tokens.all()
```

### Logging

Add logging to track email operations:

```python
# In settings.py
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'handlers': {
        'file': {
            'level': 'INFO',
            'class': 'logging.FileHandler',
            'filename': 'email_debug.log',
        },
    },
    'loggers': {
        'api.services.email_service': {
            'handlers': ['file'],
            'level': 'INFO',
        },
    },
}
```

## Migration Guide

### Running Migrations

```bash
# Create migrations
uv run python manage.py makemigrations

# Apply migrations
uv run python manage.py migrate

# Check migration status
uv run python manage.py showmigrations api
```

### Updating Existing Users

If you have existing users, run this script to set default values:

```bash
uv run python manage.py shell
```

```python
from api.models import UserProfile

# Set all existing users as unverified
for profile in UserProfile.objects.all():
    if not hasattr(profile, 'email_verified'):
        profile.email_verified = False
        profile.save()

print("Updated all user profiles")
```

## Support

For issues or questions:

- Check this documentation first
- Review error logs
- Test with console email backend
- Check Django and email service documentation

---

**Last Updated**: January 2026  
**Version**: 1.0.0
