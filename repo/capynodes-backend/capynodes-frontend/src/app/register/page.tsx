'use client';

import { useState } from 'react';
import { apiClient } from '@/lib/api';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { CheckCircle2, Mail, Home } from 'lucide-react';
import { GoogleLoginButton } from '@/components/auth/GoogleLoginButton';

export default function RegisterPage() {
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    password_confirm: '',
    first_name: '',
    last_name: '',
  });
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [registrationSuccess, setRegistrationSuccess] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
    if (fieldErrors[e.target.name]) {
      setFieldErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[e.target.name];
        return newErrors;
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setFieldErrors({});
    setLoading(true);

    if (!/^[a-zA-Z0-9_-]+$/.test(formData.username)) {
      setFieldErrors({ username: 'Username can only contain alphanumeric characters, underscores, and hyphens' });
      setLoading(false);
      return;
    }

    if (formData.password.length > 16) {
      setFieldErrors({ password: 'Password must not be longer than 16 characters' });
      setLoading(false);
      return;
    }

    if (formData.password !== formData.password_confirm) {
      setFieldErrors({ password_confirm: 'Passwords do not match' });
      setLoading(false);
      return;
    }

    try {
      await apiClient.register(formData);
      setRegistrationSuccess(true);
    } catch (err: any) {
      if (err.fieldErrors && typeof err.fieldErrors === 'object') {
        const errors: Record<string, string> = {};
        for (const [field, value] of Object.entries(err.fieldErrors)) {
          if (Array.isArray(value)) {
            errors[field] = value.join(', ');
          } else if (typeof value === 'string') {
            errors[field] = value;
          }
        }
        setFieldErrors(errors);
      }
      setError(err instanceof Error ? err.message : 'Registration failed. Please check the form and try again.');
    } finally {
      setLoading(false);
    }
  };

  if (registrationSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
        <Card className="w-full max-w-md p-8 text-center space-y-6">
          <div className="flex justify-center">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-small text-muted-foreground hover:text-primary transition-colors group"
            >
              <Home size={16} className="group-hover:-translate-x-0.5 transition-transform" />
              <span>Back to Home</span>
            </Link>
          </div>

          <div className="flex justify-center">
            <div className="relative">
              <CheckCircle2 className="w-16 h-16 text-green-500" />
              <Mail className="w-6 h-6 text-primary absolute -bottom-1 -right-1 bg-background rounded-full p-0.5" />
            </div>
          </div>
          <div className="space-y-2">
            <h1 className="text-title text-green-500">Registration Successful!</h1>
            <p className="text-body text-muted-foreground">
              We've sent a verification email to <strong>{formData.email}</strong>
            </p>
          </div>
          <div className="bg-muted/50 rounded-lg p-4 text-small text-muted-foreground">
            <p>Please check your inbox and click the verification link to activate your account.</p>
            <p className="mt-2">The link will expire in 1 hour.</p>
          </div>
          <Button asChild className="w-full font-semibold">
            <Link href="/login">Go to Login</Link>
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
      <Card className="w-full max-w-md p-8 space-y-6">
        <div className="flex justify-center">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-small text-muted-foreground hover:text-primary transition-colors group"
          >
            <Home size={16} className="group-hover:-translate-x-0.5 transition-transform" />
            <span>Back to Home</span>
          </Link>
        </div>

        <div className="text-center space-y-2">
          <h1 className="text-title">Create Account</h1>
          <p className="text-body text-muted-foreground">
            Join CapyNodes and start solving problems
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="username" className="text-small font-semibold block">
              Username *
            </label>
            <Input
              id="username"
              name="username"
              type="text"
              value={formData.username}
              onChange={handleChange}
              placeholder="Choose a username"
              required
              disabled={loading}
              className={fieldErrors.username ? 'border-red-500' : ''}
            />
            {fieldErrors.username && (
              <p className="text-xs text-red-600">{fieldErrors.username}</p>
            )}
          </div>

          <div className="space-y-2">
            <label htmlFor="email" className="text-small font-semibold block">
              Email *
            </label>
            <Input
              id="email"
              name="email"
              type="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="your@email.com"
              required
              disabled={loading}
              className={fieldErrors.email ? 'border-red-500' : ''}
            />
            {fieldErrors.email && (
              <p className="text-xs text-red-600">{fieldErrors.email}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label htmlFor="first_name" className="text-small font-semibold block">
                First Name
              </label>
              <Input
                id="first_name"
                name="first_name"
                type="text"
                value={formData.first_name}
                onChange={handleChange}
                placeholder="First name"
                disabled={loading}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="last_name" className="text-small font-semibold block">
                Last Name
              </label>
              <Input
                id="last_name"
                name="last_name"
                type="text"
                value={formData.last_name}
                onChange={handleChange}
                placeholder="Last name"
                disabled={loading}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="text-small font-semibold block">
              Password *
            </label>
            <Input
              id="password"
              name="password"
              type="password"
              value={formData.password}
              onChange={handleChange}
              placeholder="Choose a strong password"
              required
              disabled={loading}
              minLength={6}
              maxLength={16}
              className={fieldErrors.password ? 'border-red-500' : ''}
            />
            {fieldErrors.password && (
              <p className="text-xs text-red-600">{fieldErrors.password}</p>
            )}
          </div>

          <div className="space-y-2">
            <label htmlFor="password_confirm" className="text-small font-semibold block">
              Confirm Password *
            </label>
            <Input
              id="password_confirm"
              name="password_confirm"
              type="password"
              value={formData.password_confirm}
              onChange={handleChange}
              placeholder="Confirm your password"
              required
              disabled={loading}
              minLength={6}
              maxLength={16}
              className={fieldErrors.password_confirm ? 'border-red-500' : ''}
            />
            {fieldErrors.password_confirm && (
              <p className="text-xs text-red-600">{fieldErrors.password_confirm}</p>
            )}
          </div>

          {error && Object.keys(fieldErrors).length === 0 && (
            <div className="p-3 text-small text-red-600 bg-red-50 border border-red-200 rounded">
              {error}
            </div>
          )}

          <Button type="submit" className="w-full font-semibold" disabled={loading}>
            {loading ? 'Creating account...' : 'Create Account'}
          </Button>

          <div className="relative my-4">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">
                Or continue with
              </span>
            </div>
          </div>

          <GoogleLoginButton />
        </form>

        <div className="text-center text-small">
          <span className="text-muted-foreground">Already have an account? </span>
          <Link href="/login" className="text-primary hover:underline font-semibold">
            Sign in
          </Link>
        </div>
      </Card>
    </div>
  );
}

