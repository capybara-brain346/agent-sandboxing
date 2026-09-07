'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { apiClient, User } from '@/lib/api';
import { useRouter } from 'next/navigation';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (data: {
    username: string;
    email: string;
    password: string;
    password_confirm: string;
    first_name?: string;
    last_name?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  resendVerification: () => Promise<void>;
  refreshUser: () => Promise<void>;
  googleLogin: (credential: string) => Promise<void>;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const initAuth = async () => {
      try {
        const currentUser = await apiClient.getCurrentUser();
        setUser(currentUser);
      } catch (error) {
        // Not authenticated or refresh failed
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    initAuth();
  }, []);

  const login = async (username: string, password: string) => {
    const response = await apiClient.login(username, password);
    setUser(response.user);
    router.push('/');
  };

  const googleLogin = async (credential: string) => {
    const response = await apiClient.googleLogin(credential);
    setUser(response.user);
    if (response.requires_onboarding) {
      router.push('/onboarding');
    } else {
      router.push('/');
    }
  };

  const register = async (data: {
    username: string;
    email: string;
    password: string;
    password_confirm: string;
    first_name?: string;
    last_name?: string;
  }) => {
    const response = await apiClient.register(data);
    setUser(response.user);
    router.push('/');
  };

  const logout = async () => {
    await apiClient.logout();
    setUser(null);
    router.push('/login');
  };

  const resendVerification = async () => {
    await apiClient.resendVerificationEmail();
  };

  const refreshUser = async () => {
    try {
      const currentUser = await apiClient.getCurrentUser();
      setUser(currentUser);
    } catch (error) {
      // If user is no longer valid, we might want to log out
      apiClient.setToken(null);
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        register,
        logout,
        resendVerification,
        refreshUser,
        googleLogin,
        isAuthenticated: !!user,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

