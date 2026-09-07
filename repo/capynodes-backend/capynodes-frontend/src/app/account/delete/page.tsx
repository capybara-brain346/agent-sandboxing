'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { apiClient } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertTriangle, ArrowLeft, Loader2 } from 'lucide-react';

export default function DeleteAccountPage() {
    const router = useRouter();
    const { user, logout } = useAuth();
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleDelete = async (e: React.FormEvent) => {
        e.preventDefault();
        const confirm = (document.getElementById('confirm') as HTMLInputElement)?.checked;

        if (user?.has_password && !password) {
            setError('Password is required');
            return;
        }

        setLoading(true);
        setError(null);

        try {
            await apiClient.deleteAccount(password || undefined, confirm);
            // After successful deletion, the server-side token is already gone.
            // We just need to clear local state.
            apiClient.setToken(null);
            router.push('/?deleted=true');
        } catch (err: any) {
            console.error('Account deletion failed:', err);

            let errorMessage = 'Failed to delete account. Please try again later.';

            if (err.statusCode === 401) {
                if (err.message?.toLowerCase().includes('password')) {
                    errorMessage = 'Incorrect password. Please try again.';
                } else {
                    errorMessage = 'Your session has expired. Please log in again.';
                }
            } else if (err.message) {
                errorMessage = err.message;
            }

            setError(errorMessage);
            setPassword('');
        } finally {
            setLoading(false);
        }
    };

    const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setPassword(e.target.value);
        if (error) setError(null);
    };

    useEffect(() => {
        if (!user && !loading) {
            router.push('/login');
        }
    }, [user, loading, router]);

    if (!user) {
        return null;
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-background p-6">
            <div className="max-w-md w-full space-y-8">
                <Button
                    variant="ghost"
                    onClick={() => router.back()}
                    className="flex items-center gap-2 text-muted-foreground hover:text-foreground -ml-2"
                >
                    <ArrowLeft size={16} />
                    <span>Back</span>
                </Button>

                <Card className="p-8 border-destructive/20 relative overflow-hidden">
                    {/* Subtle destructive gradient top bar */}
                    <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-destructive/50 via-destructive to-destructive/50" />

                    <div className="space-y-6">
                        <div className="flex flex-col items-center text-center space-y-2">
                            <div className="p-3 bg-destructive/10 rounded-full text-destructive mb-2">
                                <AlertTriangle size={32} />
                            </div>
                            <h1 className="text-2xl font-bold">Delete Account</h1>
                            <p className="text-muted-foreground">
                                This action is <span className="text-destructive font-semibold">permanent</span> and cannot be undone.
                            </p>
                        </div>

                        <div className="bg-muted/50 p-4 rounded-lg space-y-2 text-sm">
                            <p className="font-semibold">By deleting your account, you will lose:</p>
                            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                                <li>Your profile and all personal information</li>
                                <li>All your system design submissions</li>
                                <li>Your scores and analytics progress</li>
                            </ul>
                        </div>

                        <form onSubmit={handleDelete} className="space-y-4">
                            {user.has_password ? (
                                <div className="space-y-2">
                                    <label htmlFor="password" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">Confirm with Password</label>
                                    <Input
                                        id="password"
                                        type="password"
                                        placeholder="Enter your password to confirm"
                                        value={password}
                                        onChange={handlePasswordChange}
                                        disabled={loading}
                                        className={error ? 'border-destructive ring-destructive/20' : ''}
                                        required
                                    />
                                </div>
                            ) : (
                                <div className="space-y-4 p-4 border border-destructive/20 rounded-lg bg-destructive/5">
                                    <p className="text-sm font-medium text-destructive">
                                        Since you log in via Google, no password is required.
                                    </p>
                                    <div className="flex items-center space-x-2">
                                        <input
                                            type="checkbox"
                                            id="confirm"
                                            required
                                            className="w-4 h-4 rounded border-gray-300 text-destructive focus:ring-destructive"
                                        />
                                        <label htmlFor="confirm" className="text-sm text-muted-foreground select-none">
                                            I understand that this action is irreversible.
                                        </label>
                                    </div>
                                </div>
                            )}

                            {error && (
                                <p className="text-sm text-destructive font-medium mt-1">{error}</p>
                            )}

                            <div className="flex flex-col gap-3 pt-2">
                                <Button
                                    type="submit"
                                    variant="destructive"
                                    className="w-full h-11 text-base font-semibold"
                                    disabled={loading}
                                >
                                    {loading ? (
                                        <>
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            Deleting Account...
                                        </>
                                    ) : (
                                        'Permanently Delete My Account'
                                    )}
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="w-full h-11"
                                    onClick={() => router.back()}
                                    disabled={loading}
                                >
                                    Cancel
                                </Button>
                            </div>
                        </form>
                    </div>
                </Card>
            </div>
        </div>
    );
}
