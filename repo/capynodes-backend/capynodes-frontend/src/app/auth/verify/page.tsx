'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiClient } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import Link from 'next/link';

function VerifyMagicLinkContent() {
    const searchParams = useSearchParams();
    const token = searchParams.get('token');
    const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
    const [message, setMessage] = useState('');

    useEffect(() => {
        const verifyToken = async () => {
            if (!token) {
                setStatus('error');
                setMessage('No verification token provided.');
                return;
            }

            try {
                const response = await apiClient.verifyMagicLink(token);
                setStatus('success');
                setMessage(response.message || 'Your email has been successfully verified! You can now log in to your account.');
            } catch (err: any) {
                setStatus('error');
                const errorMessage = err.fieldErrors?.error || err.message || 'Invalid or expired verification link.';
                setMessage(errorMessage);
            }
        };

        verifyToken();
    }, [token]);

    return (
        <Card className="w-full max-w-md p-8 text-center space-y-6">
            {status === 'loading' && (
                <div className="space-y-4">
                    <div className="flex justify-center">
                        <Loader2 className="w-12 h-12 text-primary animate-spin" />
                    </div>
                    <h1 className="text-2xl font-bold">Verifying your email...</h1>
                    <p className="text-muted-foreground">Please wait while we confirm your email address.</p>
                </div>
            )}

            {status === 'success' && (
                <div className="space-y-4">
                    <div className="flex justify-center">
                        <CheckCircle2 className="w-12 h-12 text-green-500" />
                    </div>
                    <h1 className="text-2xl font-bold text-green-500">Email Verified!</h1>
                    <p className="text-muted-foreground">{message}</p>
                    <Button asChild className="w-full">
                        <Link href="/login">Go to Login</Link>
                    </Button>
                </div>
            )}

            {status === 'error' && (
                <div className="space-y-4">
                    <div className="flex justify-center">
                        <XCircle className="w-12 h-12 text-red-500" />
                    </div>
                    <h1 className="text-2xl font-bold text-red-500">Verification Failed</h1>
                    <p className="text-muted-foreground">{message}</p>
                    <div className="space-y-3">
                        <Button asChild className="w-full">
                            <Link href="/login">Return to Login</Link>
                        </Button>
                        <p className="text-sm text-muted-foreground">
                            You can request a new verification email by entering your username or email on the login page and clicking "Resend Verification Email".
                        </p>
                    </div>
                </div>
            )}
        </Card>
    );
}

export default function VerifyMagicLinkPage() {
    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
            <Suspense fallback={
                <Card className="w-full max-w-md p-8 text-center space-y-6">
                    <div className="flex justify-center">
                        <Loader2 className="w-12 h-12 text-primary animate-spin" />
                    </div>
                    <h1 className="text-2xl font-bold">Loading...</h1>
                </Card>
            }>
                <VerifyMagicLinkContent />
            </Suspense>
        </div>
    );
}
