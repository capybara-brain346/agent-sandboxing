import { Metadata } from 'next';

type Props = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata(
  { params }: Props
): Promise<Metadata> {
  const id = (await params).id;

  if (id === 'custom') {
    return {
      title: 'Custom Design Editor',
      description: 'Create and practice your own custom AI system design architectures.',
    };
  }

  // Note: We can expand this to fetch the actual question title if needed
  return {
    title: `Editor - Problem #${id}`,
    description: 'Master AI Engineering System Design by practicing on our interactive visual editor.',
  };
}

export default function EditorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
