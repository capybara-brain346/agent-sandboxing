import { Metadata } from 'next';

type Props = {
  params: Promise<{ username: string }>;
};

export async function generateMetadata(
  { params }: Props
): Promise<Metadata> {
  const username = (await params).username;

  return {
    title: `${username}'s Profile`,
    description: `Check out ${username}'s AI engineering system design progress and solved problems on CapyNodes.`,
    openGraph: {
      title: `${username}'s Engineering Profile | CapyNodes`,
      description: `View ${username}'s total score, difficulty breakdown, and recent system design submissions.`,
    },
  };
}

export default function ProfileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
