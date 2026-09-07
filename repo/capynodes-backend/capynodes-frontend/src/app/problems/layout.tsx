import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Problems Library',
  description: 'Browse our curated library of AI/ML system design problems. Practice building RAG pipelines, recommendation engines, and high-scale production ML deployments.',
  openGraph: {
    title: 'Problems Library | CapyNodes',
    description: 'Practice building complex AI architectures with our curated library of system design problems.',
  },
};

export default function ProblemsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

