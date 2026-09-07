'use client';

import dynamic from 'next/dynamic';
import { ReactFlowProvider } from '@xyflow/react';
import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { apiClient, Question } from '@/lib/api';
import { EditorSkeleton } from '@/components/ui/editor-skeleton';
import Sidebar from '@/components/editor/Sidebar';
import NodesSidebar from '@/components/editor/NodesSidebar';
import PropertiesPanel from '@/components/editor/PropertiesPanel';
import ControlsBar from '@/components/editor/ControlsBar';

import { useEditorStore } from '@/store/editor-store';

const Editor = dynamic(() => import('@/components/editor/Editor'), {
  ssr: false,
  loading: () => <EditorSkeleton />,
});

function EditorContent() {
  const [question, setQuestion] = useState<Question | null>(null);
  const [loadingQuestion, setLoadingQuestion] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { isAuthenticated, loading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const questionId = params.id as string;
  const setCurrentQuestion = useEditorStore((state) => state.setCurrentQuestion);

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.push('/login');
    }
  }, [loading, isAuthenticated, router]);

  useEffect(() => {
    if (!isAuthenticated || !questionId) return;

    if (questionId === 'custom') {
      setLoadingQuestion(false);
      // If no current question is set, or it's not a custom one, create a new one
      const currentQ = useEditorStore.getState().currentQuestion;
      if (!currentQ || currentQ.id > 0) {
        const newQuestion: Question = {
          id: -Date.now(),
          title: 'New Custom Question',
          description: 'Enter your question description here...',
          constraints: {
            targetQPS: '',
            latencyRequirement: '',
            monthlyBudget: '',
            dataVolume: '',
            other: '',
          },
          difficulty: 'Intermediate',
          category: 'Practice',
          ideal_solution: null,
          created_at: new Date().toISOString(),
        };
        setCurrentQuestion(newQuestion);
      }
      return;
    }

    const fetchQuestion = async () => {
      try {
        setLoadingQuestion(true);
        const data = await apiClient.getQuestion(parseInt(questionId));
        setQuestion(data);
        setCurrentQuestion(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load question');
      } finally {
        setLoadingQuestion(false);
      }
    };

    fetchQuestion();
  }, [isAuthenticated, questionId, setCurrentQuestion]);

  if (loading || loadingQuestion) {
    return <EditorSkeleton />;
  }

  if (!isAuthenticated) {
    return null;
  }

  if (error) {
    return (
      <div className="w-full h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <p className="text-red-500">{error}</p>
          <button
            onClick={() => router.push('/problems')}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            Back to Problems
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      <Sidebar />

      <div className="flex-1 relative">
        <ControlsBar />

        <Editor />
      </div>

      <NodesSidebar />

      <PropertiesPanel />


    </div>
  );
}

export default function EditorPage() {
  return (
    <ReactFlowProvider>
      <EditorContent />
    </ReactFlowProvider>
  );
}

