'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { apiClient } from '@/lib/api';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Home } from 'lucide-react';
import { GoogleLoginButton } from '@/components/auth/GoogleLoginButton';

function LoginForm() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [errorDetails, setErrorDetails] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);
  const [deleteSuccess, setDeleteSuccess] = useState(false);
  const searchParams = useSearchParams();
  const { login } = useAuth();

  useEffect(() => {
    if (searchParams.get('deleted') === 'true') {
      setDeleteSuccess(true);
    }
  }, [searchParams]);

  const handleResend = async () => {
    setResending(true);
    setError('');
    setResendSuccess(false);
    try {
      await apiClient.resendVerificationByUsername(username);
      setResendSuccess(true);
    } catch (err) {
      setError('Failed to resend verification email. Please try again.');
    } finally {
      setResending(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setErrorDetails(null);
    setResendSuccess(false);
    setLoading(true);

    try {
      await login(username, password);
    } catch (err: any) {
      const errorMessage = err instanceof Error ? err.message : 'Login failed. Please try again.';
      setError(errorMessage);
      setErrorDetails(err.fieldErrors || null);
    } finally {
      setLoading(false);
    }
  };

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
          <h1 className="text-title">Welcome to CapyNodes</h1>
          <p className="text-body text-muted-foreground">
            Sign in to continue your learning journey
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="username" className="text-small font-semibold block">
              Username or Email
            </label>
            <Input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter your username or email"
              required
              disabled={loading}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="text-small font-semibold block">
              Password
            </label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              required
              disabled={loading}
            />
            <div className="flex justify-end">
              <Link href="/reset-password" className="text-xs text-muted-foreground hover:text-primary transition-colors">
                Forgot password?
              </Link>
            </div>
          </div>

          {error && (
            <div className="p-3 text-small rounded space-y-2 text-red-600 bg-red-50 border border-red-200">
              <p className="font-medium">{error}</p>
              {errorDetails?.message && errorDetails.message !== error && (
                <p className="text-xs">{errorDetails.message}</p>
              )}
              {(error.toLowerCase().includes('verif') || errorDetails?.requires_verification) && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full text-xs h-8 mt-2"
                  onClick={handleResend}
                  disabled={resending || !username}
                >
                  {resending ? 'Resending...' : 'Resend Verification Email'}
                </Button>
              )}
            </div>
          )}

          {resendSuccess && (
            <div className="p-3 text-small text-green-600 bg-green-50 border border-green-200 rounded">
              <p className="font-medium">✓ Verification email sent!</p>
              <p className="text-xs mt-1">Please check your inbox and click the link to verify your account.</p>
            </div>
          )}

          {deleteSuccess && (
            <div className="p-3 text-small text-green-600 bg-green-50 border border-green-200 rounded">
              <p className="font-medium">✓ Your account has been permanently deleted.</p>
              <p className="text-xs mt-1">We're sorry to see you go. You can always create a new account.</p>
            </div>
          )}

          <Button type="submit" className="w-full font-semibold" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
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
          <span className="text-muted-foreground">Don't have an account? </span>
          <Link href="/register" className="text-primary hover:underline font-semibold">
            Sign up
          </Link>
        </div>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-background"><div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" /></div>}>
      <LoginForm />
    </Suspense>
  );
}

