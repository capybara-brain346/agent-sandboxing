'use client';

import { useEffect, useState, Suspense, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { apiClient, Question } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ProblemsSkeleton } from '@/components/ui/problems-skeleton';
import { Search, Loader2, ArrowUpDown, ArrowUp, ArrowDown, X, PlusCircle } from 'lucide-react';
import { useEditorStore } from '@/store/editor-store';

function ProblemsContent() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc' | 'none'>('none');
  const [hasMore, setHasMore] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const { isAuthenticated, loading: authLoading } = useAuth();
  const router = useRouter();
  const setSidebarActiveTab = useEditorStore((state) => state.setSidebarActiveTab);
  const setCurrentQuestion = useEditorStore((state) => state.setCurrentQuestion);
  const observerTarget = useRef<HTMLDivElement>(null);
  const pageSize = 20;

  const handleCreateCustom = () => {
    // Initialize a new custom question
    const newQuestion = {
      id: -Date.now(),
      title: '',
      description: '',
      constraints: {
        targetQPS: '',
        latencyRequirement: '',
        monthlyBudget: '',
        dataVolume: '',
        other: '',
      },
      difficulty: 'Intermediate' as const,
      category: 'Practice',
      ideal_solution: null,
      created_at: new Date().toISOString(),
    };

    setCurrentQuestion(newQuestion);
    setSidebarActiveTab('custom');
    router.push('/editor/custom');
  };

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [authLoading, isAuthenticated, router]);

  const fetchQuestions = useCallback(async (page: number, isInitial: boolean = false) => {
    if (!isAuthenticated) return;

    try {
      if (isInitial) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }

      const data = await apiClient.getQuestions(page, pageSize, searchQuery || undefined);
      let fetchedQuestions = data.results;

      setHasMore(data.next !== null);

      if (isInitial) {
        setQuestions(fetchedQuestions);
      } else {
        setQuestions(prev => [...prev, ...fetchedQuestions]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load questions');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [isAuthenticated, pageSize, searchQuery]);

  useEffect(() => {
    setCurrentPage(1);
    setQuestions([]);
    setHasMore(true);
    fetchQuestions(1, true);
  }, [searchQuery, fetchQuestions]);

  const getSortedQuestions = useCallback(() => {
    if (sortOrder === 'none') {
      return questions;
    }

    const difficultyOrder = { 'Beginner': 1, 'Intermediate': 2, 'Advanced': 3 };
    return [...questions].sort((a, b) => {
      const orderA = difficultyOrder[a.difficulty];
      const orderB = difficultyOrder[b.difficulty];
      return sortOrder === 'asc' ? orderA - orderB : orderB - orderA;
    });
  }, [questions, sortOrder]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore && !loading) {
          const nextPage = currentPage + 1;
          setCurrentPage(nextPage);
          fetchQuestions(nextPage, false);
        }
      },
      { threshold: 0.1 }
    );

    const currentTarget = observerTarget.current;
    if (currentTarget) {
      observer.observe(currentTarget);
    }

    return () => {
      if (currentTarget) {
        observer.unobserve(currentTarget);
      }
    };
  }, [hasMore, loadingMore, loading, currentPage, fetchQuestions]);

  const getDifficultyColor = (difficulty: string) => {
    switch (difficulty) {
      case 'Beginner':
        return 'text-green-500';
      case 'Intermediate':
        return 'text-yellow-500';
      case 'Advanced':
        return 'text-red-500';
      default:
        return 'text-gray-500';
    }
  };

  if (authLoading || (loading && questions.length === 0)) {
    return <ProblemsSkeleton />;
  }

  if (!isAuthenticated) {
    return null;
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchQuery(searchInput.trim());
  };

  const handleClearSearch = () => {
    setSearchInput('');
    setSearchQuery('');
  };

  const toggleSort = () => {
    if (sortOrder === 'none') {
      setSortOrder('asc');
    } else if (sortOrder === 'asc') {
      setSortOrder('desc');
    } else {
      setSortOrder('none');
    }
  };

  const getSortIcon = () => {
    if (sortOrder === 'asc') {
      return <ArrowUp className="h-4 w-4 ml-1 inline" />;
    } else if (sortOrder === 'desc') {
      return <ArrowDown className="h-4 w-4 ml-1 inline" />;
    }
    return <ArrowUpDown className="h-4 w-4 ml-1 inline opacity-50" />;
  };

  const displayedQuestions = getSortedQuestions();

  return (
    <div className="min-h-screen bg-background px-4 md:px-8 pt-28 md:pt-24 pb-12">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold font-display tracking-tight">Problems</h1>
          <Button
            onClick={handleCreateCustom}
            className="w-full sm:w-auto px-6 h-12 flex items-center justify-center gap-2 font-semibold shadow-lg hover:scale-105 active:scale-95 transition-all"
          >
            <PlusCircle className="h-5 w-5" />
            Create Custom
          </Button>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <form onSubmit={handleSearch} className="flex-1 flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search problems by title..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pl-10 pr-10 h-12"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={handleClearSearch}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <Button
              type="submit"
              variant="outline"
              className="px-6 h-12"
            >
              Go
            </Button>
          </form>
        </div>

        {error ? (
          <Card className="p-6">
            <p className="text-red-500">{error}</p>
          </Card>
        ) : (
          <>
            <Card>
              <div className="overflow-hidden">
                <table className="w-full">
                  <thead className="border-b border-border">
                    <tr className="text-left text-caption text-muted-foreground">
                      <th className="py-3 px-4 md:px-6 font-semibold hidden md:table-cell">ID</th>
                      <th className="py-3 px-4 md:px-6 font-semibold">Title</th>
                      <th className="py-3 px-4 md:px-6 font-semibold hidden lg:table-cell">Category</th>
                      <th
                        className="py-3 px-4 md:px-6 font-semibold cursor-pointer hover:text-foreground transition-colors select-none"
                        onClick={toggleSort}
                      >
                        Difficulty{getSortIcon()}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedQuestions.map((question) => (
                      <tr
                        key={question.id}
                        onClick={() => router.push(`/editor/${question.id}`)}
                        className="border-b border-border last:border-0 hover:bg-accent/50 cursor-pointer transition-colors"
                      >
                        <td className="py-4 px-4 md:px-6 text-small text-muted-foreground hidden md:table-cell">
                          #{question.id}
                        </td>
                        <td className="py-4 px-4 md:px-6">
                          <span className="text-body font-medium hover:text-blue-500 transition-colors line-clamp-1">
                            {question.title}
                          </span>
                        </td>
                        <td className="py-4 px-4 md:px-6 text-small text-muted-foreground hidden lg:table-cell">
                          {question.category}
                        </td>
                        <td className="py-4 px-4 md:px-6">
                          <span className={`text-small font-semibold ${getDifficultyColor(question.difficulty)}`}>
                            {question.difficulty}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {displayedQuestions.length === 0 && !loading && (
                      <tr>
                        <td colSpan={4} className="py-12 text-center text-body text-muted-foreground">
                          No questions available
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            {loadingMore && (
              <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            )}

            <div ref={observerTarget} className="h-4" />

            {!hasMore && displayedQuestions.length > 0 && (
              <div className="text-center py-8 text-small text-muted-foreground">
                Thats All Folks!
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function ProblemsPage() {
  return (
    <Suspense fallback={<ProblemsSkeleton />}>
      <ProblemsContent />
    </Suspense>
  );
}

