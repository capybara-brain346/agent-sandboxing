'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { apiClient } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';

export default function OnboardingPage() {
    const router = useRouter();
    const { user, refreshUser, loading: authLoading } = useAuth();
    const [formData, setFormData] = useState({
        username: '',
        first_name: '',
        last_name: '',
    });
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!authLoading && !user) {
            router.push('/login');
        } else if (user && user.onboarding_completed) {
            router.push('/');
        } else if (user) {
            setFormData({
                username: user.username || '',
                first_name: user.first_name || '',
                last_name: user.last_name || '',
            });
        }
    }, [user, authLoading, router]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            await apiClient.completeOnboarding(formData);
            await refreshUser();
            router.push('/');
        } catch (err: any) {
            setError(err.message || 'Failed to complete onboarding. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    if (authLoading || !user) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
            <Card className="w-full max-w-md p-8 space-y-6">
                <div className="text-center space-y-2">
                    <h1 className="text-2xl font-bold">Complete Your Profile</h1>
                    <p className="text-sm text-muted-foreground">
                        Just a few more details to get you started
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <label htmlFor="username" className="text-sm font-semibold block">
                            Username
                        </label>
                        <Input
                            id="username"
                            type="text"
                            value={formData.username}
                            onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                            placeholder="Choose a username"
                            required
                            disabled={loading}
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label htmlFor="first_name" className="text-sm font-semibold block">
                                First Name
                            </label>
                            <Input
                                id="first_name"
                                type="text"
                                value={formData.first_name}
                                onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                                placeholder="First name"
                                disabled={loading}
                            />
                        </div>
                        <div className="space-y-2">
                            <label htmlFor="last_name" className="text-sm font-semibold block">
                                Last Name
                            </label>
                            <Input
                                id="last_name"
                                type="text"
                                value={formData.last_name}
                                onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                                placeholder="Last name"
                                disabled={loading}
                            />
                        </div>
                    </div>

                    {error && (
                        <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded">
                            {error}
                        </div>
                    )}

                    <Button type="submit" className="w-full font-semibold" disabled={loading}>
                        {loading ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Saving...
                            </>
                        ) : (
                            'Complete Signup'
                        )}
                    </Button>
                </form>
            </Card>
        </div>
    );
}
