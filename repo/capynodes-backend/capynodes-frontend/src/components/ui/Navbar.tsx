'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { LayoutGrid, User, AlertTriangle, X, PlusCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { useAuth } from '@/contexts/AuthContext';
import { useState } from 'react';

interface NavbarProps {
  maintenanceMode?: boolean;
}

export default function Navbar({ maintenanceMode = false }: NavbarProps) {
  const pathname = usePathname();
  const { isAuthenticated, user, resendVerification } = useAuth();
  const [showBanner, setShowBanner] = useState(true);
  const [resending, setResending] = useState(false);
  const [resendSent, setResendSent] = useState(false);

  const handleResend = async () => {
    setResending(true);
    try {
      await resendVerification();
      setResendSent(true);
      setTimeout(() => setResendSent(false), 5000);
    } catch (err) {
      console.error('Failed to resend verification:', err);
    } finally {
      setResending(false);
    }
  };

  if (pathname === '/login' || pathname === '/register' || pathname === '/onboarding' || pathname?.startsWith('/editor/')) {
    return null;
  }

  const isUnverified = isAuthenticated && user && !user.email_verified;

  const navLinks = [
    {
      name: 'Problems',
      href: '/problems',
      icon: LayoutGrid,
      show: isAuthenticated,
    },
    {
      name: 'Profile',
      href: user ? `/u/${user.username}` : '/profile',
      icon: User,
      show: isAuthenticated,
    },
  ];

  return (
    <>
      {isUnverified && showBanner && (
        <div className="fixed top-0 w-full z-[110] bg-amber-500 text-white px-4 py-2 flex items-center justify-between shadow-md">
          <div className="flex items-center gap-2 text-sm font-medium mx-auto">
            <AlertTriangle size={16} />
            <span>Please verify your email address to access all features.</span>
            <button
              onClick={handleResend}
              disabled={resending || resendSent}
              className="ml-4 underline hover:text-amber-100 transition-colors disabled:opacity-50"
            >
              {resending ? 'Sending...' : resendSent ? 'Verification link sent!' : 'Resend link'}
            </button>
          </div>
          <button
            onClick={() => setShowBanner(false)}
            className="p-1 hover:bg-white/20 rounded-full transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      )}
      <nav className={cn(
        "fixed w-full z-[100] border-b border-border bg-background/80 backdrop-blur-md transition-all",
        maintenanceMode && isUnverified && showBanner ? "top-[88px]" :
        maintenanceMode ? "top-12" :
        isUnverified && showBanner ? "top-10" : "top-0"
      )}>
        <div className="container mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2 group">
              <div className="w-8 h-8 rounded-full overflow-hidden flex items-center justify-center group-hover:scale-110 group-active:scale-95 transition-all duration-300">
                <Image
                  src="/logo.png"
                  alt="CapyNodes"
                  width={32}
                  height={32}
                  className="w-full h-full object-cover"
                />
              </div>
              <span className="font-bold text-xl tracking-tighter font-display hidden sm:block">CapyNodes</span>
            </Link>

            <div className="flex items-center gap-1">
              {navLinks.filter(link => link.show).map((link) => {
                const Icon = link.icon;
                const isActive = pathname === link.href;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={cn(
                      "px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 flex items-center gap-2",
                      isActive
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent"
                    )}
                  >
                    <Icon size={16} />
                    <span>{link.name}</span>
                  </Link>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-4">
            {!isAuthenticated && pathname === '/' && (
              <div className="hidden sm:flex items-center gap-3 mr-2">
                <Link href="/login" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                  Log in
                </Link>
                <Link
                  href="/register"
                  className="px-4 py-1.5 rounded-full bg-foreground text-background text-sm font-bold hover:scale-105 active:scale-95 transition-all"
                >
                  Sign up
                </Link>
              </div>
            )}
            <ThemeToggle />
          </div>
        </div>
      </nav>
    </>
  );
}
