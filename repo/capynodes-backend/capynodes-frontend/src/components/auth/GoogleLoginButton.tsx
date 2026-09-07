'use client';

import React, { useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';

declare global {
    interface Window {
        google: any;
    }
}

export const GoogleLoginButton: React.FC = () => {
    const { googleLogin } = useAuth();

    useEffect(() => {
        const loadGoogleScript = () => {
            const script = document.createElement('script');
            script.src = 'https://accounts.google.com/gsi/client';
            script.async = true;
            script.defer = true;
            script.onload = initializeGoogleSignIn;
            document.body.appendChild(script);
        };

        const initializeGoogleSignIn = () => {
            if (window.google) {
                window.google.accounts.id.initialize({
                    client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
                    callback: handleCredentialResponse,
                });
                window.google.accounts.id.renderButton(
                    document.getElementById('google-signin-button'),
                    { theme: 'outline', size: 'large', width: '100%' }
                );
            }
        };

        const handleCredentialResponse = async (response: any) => {
            try {
                await googleLogin(response.credential);
            } catch (error) {
                console.error('Google login failed:', error);
            }
        };

        if (!document.querySelector('script[src="https://accounts.google.com/gsi/client"]')) {
            loadGoogleScript();
        } else {
            initializeGoogleSignIn();
        }
    }, [googleLogin]);

    return <div id="google-signin-button" className="w-full"></div>;
};
