import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Create Account',
  description: 'Join CapyNodes and start practicing AI/ML system design. Build architecture diagrams and receive instant AI-powered feedback on your designs.',
  robots: {
    index: false,
    follow: true,
  },
};

export default function RegisterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

