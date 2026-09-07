'use client';

import { useState, useEffect } from 'react';
import { Loader2, HelpCircle, RefreshCw, Brain } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { apiClient, Question } from '@/lib/api';
import { cn } from '@/lib/cn';

interface FollowUpQuestionsModalProps {
    isOpen: boolean;
    onClose: () => void;
    question: Question | null;
    nodes: any[];
    edges: any[];
    onCreditsUpdate?: (credits: any) => void;
}

export default function FollowUpQuestionsModal({
    isOpen,
    onClose,
    question,
    nodes,
    edges,
    onCreditsUpdate,
}: FollowUpQuestionsModalProps) {
    const [questions, setQuestions] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [hasGenerated, setHasGenerated] = useState(false);

    useEffect(() => {
        if (isOpen && question) {
            const storageKey = `follow-up-questions-${question.id}`;
            const cached = localStorage.getItem(storageKey);

            if (cached) {
                try {
                    const parsed = JSON.parse(cached);
                    setQuestions(parsed);
                    setHasGenerated(true);
                } catch (e) {
                    console.error('Failed to parse cached questions', e);
                    generateQuestions();
                }
            } else {
                // If no cache, always generate fresh for this question
                setQuestions([]);
                setHasGenerated(false);
                generateQuestions();
            }
        }
    }, [isOpen, question?.id]);

    // Reset state when modal closes
    useEffect(() => {
        if (!isOpen) {
            setError(null);
            setHasGenerated(false);
        }
    }, [isOpen]);

    const generateQuestions = async () => {
        if (!question) return;

        setLoading(true);
        setError(null);

        try {
            const questionId = question.id <= 0 ? 0 : question.id;
            const customQuestion = question.id <= 0 ? {
                title: question.title,
                description: question.description,
                constraints: question.constraints,
            } : undefined;

            const response = await apiClient.getFollowUpQuestions(
                questionId,
                { nodes, edges },
                customQuestion
            );

            const newQuestions = response.questions || [];
            setQuestions(newQuestions);
            setHasGenerated(true);

            // Persist to local storage
            localStorage.setItem(`follow-up-questions-${question.id}`, JSON.stringify(newQuestions));

            if (response.credits && onCreditsUpdate) {
                onCreditsUpdate(response.credits);
            }
        } catch (err: any) {
            console.error('Failed to generate follow-up questions:', err);
            if (err.statusCode === 402) {
                setError('No credits remaining. Please wait for credits to reset.');
            } else {
                setError(err.message || 'Failed to generate questions. Please try again.');
            }
        } finally {
            setLoading(false);
        }
    };

    const handleRegenerate = () => {
        setHasGenerated(false);
        generateQuestions();
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Brain size={20} className="text-primary" />
                        Follow-up Questions
                    </DialogTitle>
                    <DialogDescription>
                        AI-generated questions to help you think deeper about your design.
                    </DialogDescription>
                </DialogHeader>

                <ScrollArea className="max-h-[400px]">
                    <div className="space-y-4 py-4">
                        {loading ? (
                            <div className="flex flex-col items-center justify-center py-12">
                                <Loader2 size={32} className="animate-spin text-primary mb-4" />
                                <p className="text-sm text-muted-foreground">Analyzing your design...</p>
                                <p className="text-xs text-muted-foreground mt-1">Generating thoughtful questions</p>
                            </div>
                        ) : error ? (
                            <div className="flex flex-col items-center justify-center py-8">
                                <div className="p-3 rounded-full bg-destructive/10 mb-4">
                                    <HelpCircle size={24} className="text-destructive" />
                                </div>
                                <p className="text-sm text-destructive text-center mb-4">{error}</p>
                                <Button variant="outline" size="sm" onClick={handleRegenerate}>
                                    <RefreshCw size={14} className="mr-2" />
                                    Try Again
                                </Button>
                            </div>
                        ) : questions.length > 0 ? (
                            <div className="space-y-4">
                                {questions.map((q, index) => (
                                    <div
                                        key={index}
                                        className={cn(
                                            "p-4 rounded-lg border transition-all duration-300",
                                            "bg-gradient-to-br from-accent/50 to-accent/30",
                                            "border-border/50 hover:border-primary/30",
                                            "animate-in fade-in slide-in-from-bottom-2"
                                        )}
                                        style={{ animationDelay: `${index * 100}ms` }}
                                    >
                                        <div className="flex items-start gap-3">
                                            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">
                                                {index + 1}
                                            </div>
                                            <p className="text-sm text-foreground leading-relaxed">
                                                {q}
                                            </p>
                                        </div>
                                    </div>
                                ))}

                                <div className="pt-4 border-t border-border/50">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={handleRegenerate}
                                        disabled={loading}
                                        className="w-full"
                                    >
                                        <RefreshCw size={14} className={cn("mr-2", loading && "animate-spin")} />
                                        Generate New Questions
                                    </Button>
                                    <p className="text-[10px] text-muted-foreground text-center mt-2">
                                        Uses 1 credit per generation
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center py-12">
                                <HelpCircle size={32} className="text-muted-foreground mb-4" />
                                <p className="text-sm text-muted-foreground">No questions generated yet</p>
                            </div>
                        )}
                    </div>
                </ScrollArea>
            </DialogContent>
        </Dialog>
    );
}
