'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import {
    X,
    Play,
    Loader2,
    ChevronDown,
    ChevronUp,
    AlertCircle,
    CheckCircle,
    ArrowLeft,
    FileText,
    History,
    Sparkles,
    Clock,
    Brain,
} from 'lucide-react';
import { useEditorStore } from '@/store/editor-store';
import { apiClient, Submission } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import FollowUpQuestionsModal from '@/components/modals/FollowUpQuestionsModal';

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

function formatTimeRemainingShort(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

export default function ProblemOverlay() {
    const [activeTab, setActiveTab] = useState<'description' | 'submissions'>('description');
    const [isResultsExpanded, setIsResultsExpanded] = useState(false);
    const [submissions, setSubmissions] = useState<Submission[]>([]);
    const [loadingSubmissions, setLoadingSubmissions] = useState(false);
    const [isFollowUpModalOpen, setIsFollowUpModalOpen] = useState(false);
    const router = useRouter();
    const pathname = usePathname();
    const {
        currentQuestion,
        setCurrentQuestion,
        evaluationResult,
        isEvaluating,
        evaluationError,
        submitForEvaluation,
        setNodes,
        setEdges,
        credits,
        creditsLoading,
        fetchCredits,
        isQuestionIncomplete,
        nodes,
        edges,
        setCredits,
    } = useEditorStore();

    useEffect(() => {
        fetchCredits();
    }, [fetchCredits]);

    const isIncomplete = isQuestionIncomplete();
    const isCanvasEmpty = nodes.length === 0;


    useEffect(() => {
        if (currentQuestion && activeTab === 'submissions') {
            fetchSubmissions();
        }
    }, [currentQuestion, activeTab]);

    const fetchSubmissions = async () => {
        if (!currentQuestion) return;

        try {
            setLoadingSubmissions(true);
            const data = await apiClient.getQuestionSubmissions(currentQuestion.id);
            setSubmissions(data);
        } catch (error) {
            console.error('Failed to fetch submissions:', error);
        } finally {
            setLoadingSubmissions(false);
        }
    };

    if (!currentQuestion) return null;

    const handleEvaluate = async () => {
        await submitForEvaluation();
        if (useEditorStore.getState().evaluationResult) {
            setIsResultsExpanded(true);
            if (activeTab === 'submissions') {
                await fetchSubmissions();
            }
        }
    };

    const handleLoadSubmission = (submission: Submission) => {
        setNodes(submission.diagram.nodes);
        setEdges(submission.diagram.edges);
    };

    const handleBack = () => {
        const isEditorPage = pathname?.startsWith('/editor/');
        if (isEditorPage) {
            router.push('/problems');
        } else {
            setCurrentQuestion(null);
        }
    };

    const getDifficultyColor = (difficulty: string) => {
        switch (difficulty) {
            case 'Beginner':
                return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';
            case 'Intermediate':
                return 'bg-amber-500/10 text-amber-500 border-amber-500/20';
            case 'Advanced':
                return 'bg-rose-500/10 text-rose-500 border-rose-500/20';
            default:
                return 'bg-gray-500/10 text-gray-500 border-gray-500/20';
        }
    };

    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        return new Intl.DateTimeFormat('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
        }).format(date);
    };

    const getScoreColor = (score: number) => {
        if (score >= 80) return 'text-green-500';
        if (score >= 60) return 'text-yellow-500';
        if (score >= 40) return 'text-orange-500';
        return 'text-red-500';
    };

    return (
        <>
            <div className="h-full flex flex-col bg-background">
                <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card/50">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={handleBack}
                        className="h-8 w-8"
                    >
                        <ArrowLeft size={18} />
                    </Button>
                    <div className="flex-1">
                        <h2 className="text-small font-semibold text-foreground tracking-wide">Problem</h2>
                    </div>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={handleBack}
                        className="h-8 w-8"
                    >
                        <X size={18} />
                    </Button>
                </div>

                <div className="flex border-b border-border">
                    <button
                        onClick={() => setActiveTab('description')}
                        className={cn(
                            "flex-1 px-4 py-2.5 text-small font-semibold transition-colors flex items-center justify-center gap-2",
                            activeTab === 'description'
                                ? "text-foreground border-b-2 border-primary bg-accent/50"
                                : "text-muted-foreground hover:text-foreground hover:bg-accent/30"
                        )}
                    >
                        <FileText size={16} />
                        Description
                    </button>
                    {!(currentQuestion.id <= 0) && (
                        <button
                            onClick={() => setActiveTab('submissions')}
                            className={cn(
                                "flex-1 px-4 py-2.5 text-small font-semibold transition-colors flex items-center justify-center gap-2",
                                activeTab === 'submissions'
                                    ? "text-foreground border-b-2 border-primary bg-accent/50"
                                    : "text-muted-foreground hover:text-foreground hover:bg-accent/30"
                            )}
                        >
                            <History size={16} />
                            Submissions
                        </button>
                    )}
                </div>

                {activeTab === 'description' ? (
                    <ScrollArea className="flex-1">
                        <div className="p-4 space-y-4">
                            <div>
                                <div className="flex items-start justify-between gap-3 mb-3">
                                    <Badge className={cn('border', getDifficultyColor(currentQuestion.difficulty))}>
                                        {currentQuestion.difficulty}
                                    </Badge>
                                    <span className="text-xs text-muted-foreground">{currentQuestion.category}</span>
                                </div>
                                {currentQuestion.id <= 0 ? (
                                    <div className="space-y-4">
                                        <div className="flex items-center gap-2 p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 animate-in fade-in slide-in-from-top-1 duration-300">
                                            <AlertCircle size={14} className="text-red-500 shrink-0" />
                                            <p className="text-[10px] font-bold uppercase tracking-widest text-red-500">
                                                All fields are required to evaluate your design
                                            </p>
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Title</label>
                                            <input
                                                value={currentQuestion.title}
                                                placeholder="Enter problem title (e.g. Design a Notification System)"
                                                onChange={(e) => {
                                                    const { updateCustomQuestion } = useEditorStore.getState();
                                                    updateCustomQuestion(currentQuestion.id, { title: e.target.value });
                                                }}
                                                className="w-full bg-card border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Description</label>
                                            <textarea
                                                value={currentQuestion.description}
                                                placeholder="Describe the problem requirements, functional and non-functional requirements..."
                                                onChange={(e) => {
                                                    const { updateCustomQuestion } = useEditorStore.getState();
                                                    updateCustomQuestion(currentQuestion.id, { description: e.target.value });
                                                }}
                                                rows={5}
                                                className="w-full bg-card border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                                            />
                                        </div>
                                        <div className="space-y-4">
                                            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Constraints</label>
                                            <div className="grid grid-cols-2 gap-3">
                                                {['targetQPS', 'latencyRequirement', 'monthlyBudget', 'dataVolume', 'other'].map((field) => (
                                                    <div key={field} className="space-y-1">
                                                        <label className="text-[10px] text-muted-foreground capitalize">{field.replace(/([A-Z])/g, ' $1')}</label>
                                                        <input
                                                            value={currentQuestion.constraints[field] || ''}
                                                            placeholder={`Enter ${field.replace(/([A-Z])/g, ' $1').toLowerCase()}...`}
                                                            onChange={(e) => {
                                                                const { updateCustomQuestion, currentQuestion: q } = useEditorStore.getState();
                                                                if (q) {
                                                                    updateCustomQuestion(q.id, {
                                                                        constraints: { ...q.constraints, [field]: e.target.value }
                                                                    });
                                                                }
                                                            }}
                                                            className="w-full bg-card border border-border rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                                                        />
                                                    </div>
                                                ))}
                                                <div className="space-y-1">
                                                    <label className="text-[10px] text-muted-foreground">Difficulty</label>
                                                    <select
                                                        value={currentQuestion.difficulty}
                                                        onChange={(e) => {
                                                            const { updateCustomQuestion } = useEditorStore.getState();
                                                            updateCustomQuestion(currentQuestion.id, { difficulty: e.target.value as any });
                                                        }}
                                                        className="w-full bg-card border border-border rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                                                    >
                                                        <option>Beginner</option>
                                                        <option>Intermediate</option>
                                                        <option>Advanced</option>
                                                    </select>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        <h3 className="text-subheading font-bold text-foreground mb-3">
                                            {currentQuestion.title}
                                        </h3>
                                        <p className="text-body text-muted-foreground leading-relaxed whitespace-pre-wrap">
                                            {currentQuestion.description}
                                        </p>
                                    </>
                                )}
                            </div>

                            {currentQuestion.id > 0 && Object.keys(currentQuestion.constraints).length > 0 && (
                                <div className="space-y-2">
                                    <h4 className="text-caption font-bold text-foreground">
                                        Constraints
                                    </h4>
                                    <div className="space-y-2">
                                        {currentQuestion.constraints.targetQPS && (
                                            <div className="flex items-center gap-2">
                                                <Badge variant="outline" className="text-caption font-semibold">
                                                    Target QPS
                                                </Badge>
                                                <span className="text-small text-muted-foreground">
                                                    {currentQuestion.constraints.targetQPS}
                                                </span>
                                            </div>
                                        )}
                                        {currentQuestion.constraints.latencyRequirement && (
                                            <div className="flex items-center gap-2">
                                                <Badge variant="outline" className="text-caption font-semibold">
                                                    Latency
                                                </Badge>
                                                <span className="text-small text-muted-foreground">
                                                    {currentQuestion.constraints.latencyRequirement}
                                                </span>
                                            </div>
                                        )}
                                        {currentQuestion.constraints.monthlyBudget && (
                                            <div className="flex items-center gap-2">
                                                <Badge variant="outline" className="text-caption font-semibold">
                                                    Budget
                                                </Badge>
                                                <span className="text-small text-muted-foreground">
                                                    {currentQuestion.constraints.monthlyBudget}
                                                </span>
                                            </div>
                                        )}
                                        {currentQuestion.constraints.dataVolume && (
                                            <div className="flex items-center gap-2">
                                                <Badge variant="outline" className="text-caption font-semibold">
                                                    Data Volume
                                                </Badge>
                                                <span className="text-small text-muted-foreground">
                                                    {currentQuestion.constraints.dataVolume}
                                                </span>
                                            </div>
                                        )}
                                        {currentQuestion.constraints.other && (
                                            <div className="flex items-center gap-2">
                                                <Badge variant="outline" className="text-caption font-semibold">
                                                    Other
                                                </Badge>
                                                <span className="text-small text-muted-foreground">
                                                    {currentQuestion.constraints.other}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            <div className="pt-2">
                                <div className="flex items-center gap-2 mb-3 p-2.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                                    <AlertCircle size={14} className="text-yellow-500 shrink-0" />
                                    <div className="space-y-1">
                                        <p className="text-[10px] font-medium text-yellow-500">
                                            Results may vary per evaluation as AI is being used to score
                                        </p>
                                        <p className="text-[10px] font-bold text-yellow-500 uppercase tracking-widest">
                                            Score &gt; 70 required to solve
                                        </p>
                                    </div>
                                </div>
                                {isCanvasEmpty && (
                                    <div className="flex items-center gap-2 mb-3 p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 animate-in fade-in slide-in-from-top-1 duration-300">
                                        <AlertCircle size={14} className="text-red-500 shrink-0" />
                                        <p className="text-[10px] font-bold uppercase tracking-widest text-red-500">
                                            Insert nodes to start designing and evaluate
                                        </p>
                                    </div>
                                )}
                                <Button

                                    onClick={handleEvaluate}
                                    disabled={isEvaluating || isIncomplete || isCanvasEmpty || (credits !== null && credits.credits_remaining === 0)}
                                    title={
                                        isCanvasEmpty ? "Add at least one node to evaluate your design" :
                                            isIncomplete ? "Please fill in all question fields above" :
                                                "Evaluate Design"
                                    }
                                    className={cn(
                                        'w-full h-11 relative overflow-hidden transition-all duration-300 group px-4 font-bold uppercase tracking-widest text-[10px] border rounded-lg',
                                        (!credits || credits.credits_remaining > 0) && !isIncomplete && !isCanvasEmpty
                                            ? 'bg-zinc-950 text-white border-zinc-800 hover:bg-zinc-900 dark:bg-white dark:text-black dark:border-zinc-200 dark:hover:bg-zinc-100 shadow-[0_1px_2px_rgba(0,0,0,0.05)] active:scale-[0.98]'
                                            : 'bg-zinc-100/50 text-zinc-400 border-zinc-200 dark:bg-zinc-900/50 dark:text-zinc-600 dark:border-zinc-800'
                                    )}
                                >

                                    <div className="flex items-center justify-center gap-2">
                                        {isEvaluating ? (
                                            <>
                                                <Loader2 size={14} className="animate-spin" />
                                                <span>EVALUATING</span>
                                            </>
                                        ) : (
                                            <>
                                                <Play size={14} fill="currentColor" className={cn((!credits || credits.credits_remaining > 0) ? "" : "opacity-50")} />
                                                <span>EVALUATE DESIGN</span>
                                                {credits && (
                                                    <>
                                                        <span className="opacity-50 mx-1">|</span>
                                                        <span className="tabular-nums">{credits.credits_remaining}/{credits.max_credits}</span>
                                                    </>
                                                )}
                                            </>
                                        )}
                                    </div>
                                </Button>

                                {/* Reset Countdown (when 0 credits) */}
                                {credits !== null && credits.credits_remaining === 0 && credits.seconds_until_reset !== null && (
                                    <div className="mt-2 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-zinc-950/50 border border-zinc-800/50 text-zinc-400 animate-in fade-in slide-in-from-top-2 duration-300">
                                        <Clock size={12} className="animate-pulse" />
                                        <span className="text-[10px] font-bold uppercase tracking-widest">
                                            Refill in: {formatTimeRemainingShort(credits.seconds_until_reset)}
                                        </span>
                                    </div>
                                )}

                                {/* Follow-up Questions Button */}
                                {!isCanvasEmpty && (
                                    <Button
                                        variant="outline"
                                        onClick={() => setIsFollowUpModalOpen(true)}
                                        disabled={isCanvasEmpty || isIncomplete || (credits !== null && credits.credits_remaining === 0)}
                                        className="w-full mt-3 h-10 text-[10px] font-bold uppercase tracking-widest"
                                    >
                                        <Brain size={14} className="mr-2" />
                                        View Follow-up Questions
                                    </Button>
                                )}
                            </div>

                            {evaluationError && (
                                <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                                    <div className="flex items-start gap-2">
                                        <AlertCircle size={16} className="text-destructive mt-0.5 flex-shrink-0" />
                                        <div className="flex-1">
                                            <p className="text-sm text-destructive">{evaluationError}</p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {evaluationResult && (
                                <div className="border border-border rounded-lg overflow-hidden bg-card/50">
                                    <button
                                        onClick={() => setIsResultsExpanded(!isResultsExpanded)}
                                        className="w-full flex items-center justify-between px-4 py-3 hover:bg-accent transition-colors"
                                    >
                                        <div className="flex items-center gap-3">
                                            <ScoreRing score={evaluationResult.overallScore} size={48} />
                                            <div className="text-left">
                                                <p className="text-small font-semibold text-foreground">
                                                    Overall Score
                                                </p>
                                                <p className="text-caption text-muted-foreground normal-case tracking-normal">
                                                    Click to view details
                                                </p>
                                            </div>
                                        </div>
                                        {isResultsExpanded ? (
                                            <ChevronUp size={18} className="text-muted-foreground" />
                                        ) : (
                                            <ChevronDown size={18} className="text-muted-foreground" />
                                        )}
                                    </button>

                                    {isResultsExpanded && (
                                        <div className="px-4 pb-4 space-y-4 border-t border-border">
                                            <div className="pt-4">
                                                <h4 className="text-caption font-bold text-muted-foreground mb-2">
                                                    Score Breakdown
                                                </h4>
                                                <div className="space-y-2">
                                                    {evaluationResult.breakdown.map((item, index) => (
                                                        <div key={index} className="space-y-1">
                                                            <div className="flex items-center justify-between text-caption normal-case tracking-normal">
                                                                <span className="text-foreground/80 font-medium">{item.category}</span>
                                                                <span className="text-muted-foreground font-normal">
                                                                    {item.score}/100 ({Math.round(item.weight * 100)}%)
                                                                </span>
                                                            </div>
                                                            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                                                                <div
                                                                    className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full transition-all duration-500"
                                                                    style={{ width: `${item.score}%` }}
                                                                />
                                                            </div>
                                                            <p className="text-caption normal-case tracking-normal text-muted-foreground font-normal">
                                                                {item.explanation}
                                                            </p>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>

                                            {evaluationResult.strengths.length > 0 && (
                                                <div>
                                                    <h4 className="text-caption font-bold text-green-400 mb-2 flex items-center gap-1">
                                                        <CheckCircle size={12} />
                                                        Strengths
                                                    </h4>
                                                    <ul className="space-y-1">
                                                        {evaluationResult.strengths.map((strength, index) => (
                                                            <li
                                                                key={index}
                                                                className="text-caption normal-case tracking-normal font-normal text-muted-foreground pl-4 relative before:absolute before:left-0 before:content-['•'] before:text-green-400"
                                                            >
                                                                {strength}
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            )}

                                            {evaluationResult.improvements.length > 0 && (
                                                <div>
                                                    <h4 className="text-caption font-bold text-yellow-400 mb-2 flex items-center gap-1">
                                                        <AlertCircle size={12} />
                                                        Improvements
                                                    </h4>
                                                    <ul className="space-y-1">
                                                        {evaluationResult.improvements.map((improvement, index) => (
                                                            <li
                                                                key={index}
                                                                className="text-caption normal-case tracking-normal font-normal text-muted-foreground pl-4 relative before:absolute before:left-0 before:content-['•'] before:text-yellow-400"
                                                            >
                                                                {improvement}
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </ScrollArea>
                ) : (
                    <ScrollArea className="flex-1">
                        <div className="p-4">
                            {loadingSubmissions ? (
                                <div className="flex flex-col items-center justify-center py-12">
                                    <Loader2 size={24} className="animate-spin text-muted-foreground mb-2" />
                                    <p className="text-small text-muted-foreground">Loading submissions...</p>
                                </div>
                            ) : submissions.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-12 text-center">
                                    <History size={32} className="text-muted-foreground mb-3" />
                                    <p className="text-body text-muted-foreground">No submissions yet</p>
                                    <p className="text-caption normal-case tracking-normal text-muted-foreground mt-1 font-normal">
                                        Submit your solution to see it here
                                    </p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {submissions.map((submission) => (
                                        <div
                                            key={submission.id}
                                            className="border border-border rounded-lg p-3 bg-card/50 hover:bg-accent/50 transition-colors cursor-pointer"
                                            onClick={() => handleLoadSubmission(submission)}
                                        >
                                            <div className="flex items-start justify-between mb-2">
                                                <div className="flex items-center gap-2">
                                                    <span className={cn("text-lg font-bold", getScoreColor(submission.score))}>
                                                        {submission.score}
                                                    </span>
                                                    <span className="text-xs text-muted-foreground">/ 100</span>
                                                </div>
                                                <Badge variant="outline" className="text-xs">
                                                    {formatDate(submission.created_at)}
                                                </Badge>
                                            </div>

                                            {submission.evaluation_result && (
                                                <div className="space-y-1">
                                                    {submission.evaluation_result.breakdown?.slice(0, 2).map((item: any, index: number) => (
                                                        <div key={index} className="flex items-center justify-between text-caption normal-case tracking-normal font-normal">
                                                            <span className="text-muted-foreground">{item.category}</span>
                                                            <span className="text-foreground font-medium">{item.score}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            <div className="mt-2 pt-2 border-t border-border/50">
                                                <p className="text-caption normal-case tracking-normal text-muted-foreground font-normal">
                                                    {submission.diagram.nodes.length} nodes, {submission.diagram.edges.length} connections
                                                </p>
                                            </div>

                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="w-full mt-2 text-caption normal-case tracking-normal font-semibold h-7"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleLoadSubmission(submission);
                                                }}
                                            >
                                                Load Submission
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </ScrollArea>
                )}
            </div>

            <FollowUpQuestionsModal
                isOpen={isFollowUpModalOpen}
                onClose={() => setIsFollowUpModalOpen(false)}
                question={currentQuestion}
                nodes={nodes}
                edges={edges}
                onCreditsUpdate={(newCredits) => setCredits(newCredits)}
            />
        </>
    );
}

