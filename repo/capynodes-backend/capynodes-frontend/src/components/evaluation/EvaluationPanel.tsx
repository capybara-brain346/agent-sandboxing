'use client';

import { useState, useEffect, useCallback } from 'react';
import {
    Play,
    Loader2,
    ChevronDown,
    ChevronUp,
    AlertCircle,
    CheckCircle,
    RefreshCw,
    Clock,
} from 'lucide-react';
import { useEditorStore } from '@/store/editor-store';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { apiClient, CreditStatus } from '@/lib/api';

function ScoreRing({ score, size = 80 }: { score: number; size?: number }) {
    const radius = (size - 8) / 2;
    const circumference = 2 * Math.PI * radius;
    const progress = (score / 100) * circumference;

    const getColor = (score: number) => {
        if (score >= 80) return '#22c55e';
        if (score >= 60) return '#eab308';
        if (score >= 40) return '#f97316';
        return '#ef4444';
    };

    return (
        <div className="relative" style={{ width: size, height: size }}>
            <svg className="transform -rotate-90" width={size} height={size}>
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    stroke="currentColor"
                    strokeWidth="3"
                    fill="none"
                    className="text-muted"
                />
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    stroke={getColor(score)}
                    strokeWidth="3"
                    fill="none"
                    strokeDasharray={circumference}
                    strokeDashoffset={circumference - progress}
                    strokeLinecap="round"
                    className="transition-all duration-1000 ease-out"
                />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-xl font-bold text-foreground">{score}</span>
            </div>
        </div>
    );
}

function formatTimeRemaining(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }
    if (minutes > 0) {
        return `${minutes}m ${secs}s`;
    }
    return `${secs}s`;
}

export default function EvaluationPanel() {
    const [isExpanded, setIsExpanded] = useState(false);
    const [creditStatus, setCreditStatus] = useState<CreditStatus | null>(null);
    const [creditLoading, setCreditLoading] = useState(true);
    const [timeRemaining, setTimeRemaining] = useState<number | null>(null);

    const {
        evaluationResult,
        isEvaluating,
        evaluationError,
        submitForEvaluation,
        currentQuestion
    } = useEditorStore();

    // Fetch credit status on mount and after evaluations
    const fetchCredits = useCallback(async () => {
        try {
            const status = await apiClient.getCreditStatus();
            setCreditStatus(status);
            setTimeRemaining(status.seconds_until_reset);
        } catch (e) {
            console.error('Failed to fetch credit status:', e);
        } finally {
            setCreditLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchCredits();
    }, [fetchCredits]);

    // Countdown timer for credit reset
    useEffect(() => {
        if (timeRemaining === null || timeRemaining <= 0) return;

        const interval = setInterval(() => {
            setTimeRemaining(prev => {
                if (prev === null || prev <= 1) {
                    // Credits should be reset now, refetch
                    fetchCredits();
                    return null;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(interval);
    }, [timeRemaining, fetchCredits]);

    // Update credits from evaluation response
    useEffect(() => {
        if (evaluationResult?.credits) {
            setCreditStatus(evaluationResult.credits);
            setTimeRemaining(evaluationResult.credits.seconds_until_reset);
        }
    }, [evaluationResult]);

    const handleEvaluate = async () => {
        await submitForEvaluation();
        const state = useEditorStore.getState();
        if (state.evaluationResult) {
            setIsExpanded(true);
            // Update credits from evaluation result
            if (state.evaluationResult.credits) {
                setCreditStatus(state.evaluationResult.credits);
                setTimeRemaining(state.evaluationResult.credits.seconds_until_reset);
            }
        }
        // If there was an error (including no credits), check the error message
        if (state.evaluationError?.includes('credits')) {
            fetchCredits();
        }
    };

    const hasCredits = creditStatus && creditStatus.credits_remaining > 0;
    const isDisabled = isEvaluating || !currentQuestion || !hasCredits;

    // Generate button text with credit count
    const getButtonText = () => {
        if (isEvaluating) {
            return (
                <div className="flex items-center justify-center gap-2">
                    <Loader2 size={14} className="animate-spin" />
                    <span>EVALUATING</span>
                </div>
            );
        }

        if (creditLoading) {
            return (
                <div className="flex items-center justify-center gap-2">
                    <Play size={14} fill="currentColor" />
                    <span>EVALUATE DESIGN</span>
                </div>
            );
        }

        if (creditStatus) {
            return (
                <div className="flex items-center justify-center gap-2">
                    <Play size={14} fill="currentColor" />
                    <span>EVALUATE</span>
                    <span className="opacity-50 mx-1">|</span>
                    <span className="tabular-nums">{creditStatus.credits_remaining}/{creditStatus.max_credits}</span>
                </div>
            );
        }

        return (
            <div className="flex items-center justify-center gap-2">
                <Play size={14} fill="currentColor" />
                <span>EVALUATE DESIGN</span>
            </div>
        );
    };

    return (
        <Card className="absolute bottom-4 right-4 z-10 w-96 bg-card/95 backdrop-blur-xl shadow-xl overflow-hidden">
            {/* Header with Evaluate Button */}
            <div className="p-4 border-b border-border">
                <div className="flex items-center gap-2">
                    <Button
                        onClick={handleEvaluate}
                        disabled={isDisabled}
                        className={cn(
                            "flex-1 h-10 font-bold uppercase tracking-widest text-[10px] transition-all duration-200 border rounded-lg",
                            currentQuestion && hasCredits
                                ? "bg-zinc-950 text-white border-zinc-800 hover:bg-zinc-900 dark:bg-white dark:text-black dark:border-zinc-200 dark:hover:bg-zinc-100 shadow-[0_1px_2px_rgba(0,0,0,0.05)] active:scale-[0.98]"
                                : "bg-zinc-100/50 text-zinc-400 border-zinc-200 dark:bg-zinc-900/50 dark:text-zinc-600 dark:border-zinc-800"
                        )}
                    >
                        {getButtonText()}
                    </Button>
                </div>

                {!currentQuestion && (
                    <p className="mt-2 text-xs text-yellow-400">
                        Select a problem to evaluate your design
                    </p>
                )}

                {/* Credit depleted message with countdown */}
                {creditStatus && creditStatus.credits_remaining === 0 && timeRemaining !== null && timeRemaining > 0 && (
                    <div className="mt-2 flex items-center gap-2 text-amber-400">
                        <Clock size={14} />
                        <p className="text-xs">
                            Credits exhausted. Reset in {formatTimeRemaining(timeRemaining)}
                        </p>
                    </div>
                )}
            </div>

            {/* Error */}
            {evaluationError && (
                <div className="p-4 bg-destructive/10 border-b border-destructive/20">
                    <div className="flex items-start gap-2">
                        <AlertCircle size={16} className="text-destructive mt-0.5" />
                        <div className="flex-1">
                            <p className="text-sm text-destructive">{evaluationError}</p>
                            {hasCredits && (
                                <button
                                    onClick={handleEvaluate}
                                    className="mt-2 flex items-center gap-1 text-xs text-destructive/80 hover:text-destructive"
                                >
                                    <RefreshCw size={12} />
                                    Retry
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Results */}
            {evaluationResult && (
                <>
                    <button
                        onClick={() => setIsExpanded(!isExpanded)}
                        className="w-full flex items-center justify-between px-4 py-3 hover:bg-accent transition-colors"
                    >
                        <div className="flex items-center gap-3">
                            <ScoreRing score={evaluationResult.overallScore} size={48} />
                            <div className="text-left">
                                <p className="text-sm font-medium text-foreground">Overall Score</p>
                                <p className="text-xs text-muted-foreground">Click to view details</p>
                            </div>
                        </div>
                        {isExpanded ? (
                            <ChevronUp size={18} className="text-muted-foreground" />
                        ) : (
                            <ChevronDown size={18} className="text-muted-foreground" />
                        )}
                    </button>

                    {isExpanded && (
                        <ScrollArea className="px-4 pb-4 max-h-96">
                            <div className="space-y-4">
                                {/* Category Breakdown */}
                                <div>
                                    <h4 className="text-xs font-medium text-muted-foreground mb-2">Score Breakdown</h4>
                                    <div className="space-y-2">
                                        {evaluationResult.breakdown.map((item, index) => (
                                            <div key={index} className="space-y-1">
                                                <div className="flex items-center justify-between text-xs">
                                                    <span className="text-foreground/80">{item.category}</span>
                                                    <span className="text-muted-foreground">
                                                        {item.score}/100 ({Math.round(item.weight * 100)}%)
                                                    </span>
                                                </div>
                                                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                                                    <div
                                                        className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full transition-all duration-500"
                                                        style={{ width: `${item.score}%` }}
                                                    />
                                                </div>
                                                <p className="text-xs text-muted-foreground">{item.explanation}</p>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Strengths */}
                                {evaluationResult.strengths.length > 0 && (
                                    <div>
                                        <h4 className="text-xs font-medium text-green-400 mb-2 flex items-center gap-1">
                                            <CheckCircle size={12} />
                                            Strengths
                                        </h4>
                                        <ul className="space-y-1">
                                            {evaluationResult.strengths.map((strength, index) => (
                                                <li key={index} className="text-xs text-muted-foreground pl-4 relative before:absolute before:left-0 before:content-['•'] before:text-green-400">
                                                    {strength}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                {/* Improvements */}
                                {evaluationResult.improvements.length > 0 && (
                                    <div>
                                        <h4 className="text-xs font-medium text-yellow-400 mb-2 flex items-center gap-1">
                                            <AlertCircle size={12} />
                                            Improvements
                                        </h4>
                                        <ul className="space-y-1">
                                            {evaluationResult.improvements.map((improvement, index) => (
                                                <li key={index} className="text-xs text-muted-foreground pl-4 relative before:absolute before:left-0 before:content-['•'] before:text-yellow-400">
                                                    {improvement}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        </ScrollArea>
                    )}
                </>
            )}
        </Card>
    );
}
