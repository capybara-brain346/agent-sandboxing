'use client';

import { useState, useEffect, useRef } from 'react';
import { Search, PanelLeftClose, PanelLeft, BookOpen, Trophy, Plus, Edit2, Trash2, Globe } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEditorStore } from '@/store/editor-store';
import { Question } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import ProblemOverlay from '@/components/problem/ProblemOverlay';

export default function Sidebar() {
    const [searchQuery, setSearchQuery] = useState('');
    const [isResizing, setIsResizing] = useState(false);
    const sidebarRef = useRef<HTMLDivElement>(null);
    const sidebarCollapsed = useEditorStore((state) => state.sidebarCollapsed);
    const setSidebarCollapsed = useEditorStore((state) => state.setSidebarCollapsed);
    const questions = useEditorStore((state) => state.questions) as Question[];
    const customQuestions = useEditorStore((state) => state.customQuestions) as Question[];
    const fetchQuestions = useEditorStore((state) => state.fetchQuestions);
    const currentQuestion = useEditorStore((state) => state.currentQuestion) as (Question & { isCustom?: boolean }) | null;
    const setCurrentQuestion = useEditorStore((state) => state.setCurrentQuestion);
    const addCustomQuestion = useEditorStore((state) => state.addCustomQuestion);
    const deleteCustomQuestion = useEditorStore((state) => state.deleteCustomQuestion);
    const activeTab = useEditorStore((state) => state.sidebarActiveTab);
    const setActiveTab = useEditorStore((state) => state.setSidebarActiveTab);
    const leftSidebarWidth = useEditorStore((state) => state.leftSidebarWidth);
    const setLeftSidebarWidth = useEditorStore((state) => state.setLeftSidebarWidth);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizing) return;
            const newWidth = e.clientX;
            setLeftSidebarWidth(newWidth);
        };

        const handleMouseUp = () => {
            setIsResizing(false);
        };

        if (isResizing) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        }

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };
    }, [isResizing, setLeftSidebarWidth]);

    useEffect(() => {
        fetchQuestions();
    }, [fetchQuestions]);

    const filteredQuestions: Question[] = (activeTab === 'platform' ? questions : customQuestions)
        .filter((q: Question) =>
            q.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            q.category.toLowerCase().includes(searchQuery.toLowerCase())
        );

    const handleCreateCustom = () => {
        const newQuestion: Question = {
            id: -Date.now(), // Generate a unique negative ID for custom questions
            title: '',
            description: '',
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
        addCustomQuestion(newQuestion);
        setCurrentQuestion(newQuestion);
        setActiveTab('custom');
    };

    if (sidebarCollapsed) {
        return (
            <div className="w-12 h-full bg-background border-r border-border flex flex-col items-center py-4 gap-4 flex-shrink-0">
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setSidebarCollapsed(false)}
                    title="Expand sidebar"
                >
                    <PanelLeft size={20} />
                </Button>
                <Button
                    variant="secondary"
                    size="icon"
                    onClick={() => setSidebarCollapsed(false)}
                >
                    <BookOpen size={18} />
                </Button>
            </div>
        );
    }

    if (currentQuestion) {
        return (
            <div
                ref={sidebarRef}
                className="h-full bg-background border-r border-border flex flex-col relative flex-shrink-0"
                style={{ width: `${leftSidebarWidth}px` }}
            >
                <ProblemOverlay />
                <div
                    className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/50 transition-colors group"
                    onMouseDown={(e) => {
                        e.preventDefault();
                        setIsResizing(true);
                    }}
                >
                    <div className="absolute right-0 top-0 bottom-0 w-1 bg-primary/0 group-hover:bg-primary/50 transition-colors" />
                </div>
            </div>
        );
    }

    return (
        <div
            ref={sidebarRef}
            className="h-full bg-background border-r border-border flex flex-col relative flex-shrink-0"
            style={{ width: `${leftSidebarWidth}px` }}
        >
            {/* Header */}
            <div className="p-4 border-b border-border space-y-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <BookOpen size={18} className="text-primary" />
                        <h2 className="text-sm font-semibold text-foreground">Explorer</h2>
                    </div>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setSidebarCollapsed(true)}
                        title="Collapse sidebar"
                    >
                        <PanelLeftClose size={16} />
                    </Button>
                </div>

                {/* Tabs */}
                <div className="flex bg-muted/50 p-1 rounded-lg">
                    <button
                        onClick={() => setActiveTab('platform')}
                        className={cn(
                            "flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-medium rounded-md transition-all",
                            activeTab === 'platform'
                                ? "bg-background text-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground"
                        )}
                    >
                        <Globe size={14} />
                        Platform
                    </button>
                    <button
                        onClick={() => setActiveTab('custom')}
                        className={cn(
                            "flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-medium rounded-md transition-all",
                            activeTab === 'custom'
                                ? "bg-background text-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground"
                        )}
                    >
                        <Trophy size={14} />
                        Mine
                    </button>
                </div>

                {/* Search & Actions */}
                <div className="flex gap-2">
                    <div className="relative flex-1">
                        <Search
                            size={16}
                            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                        />
                        <Input
                            type="text"
                            placeholder={activeTab === 'platform' ? "Search problems..." : "Search mine..."}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-9 bg-card h-9"
                        />
                    </div>
                    {activeTab === 'custom' && (
                        <Button
                            size="icon"
                            className="h-9 w-9 flex-shrink-0"
                            onClick={handleCreateCustom}
                            title="New custom question"
                        >
                            <Plus size={18} />
                        </Button>
                    )}
                </div>
            </div>

            <ScrollArea className="flex-1">
                <div className="p-3 space-y-2">
                    {filteredQuestions.map((q: Question) => (
                        <div key={q.id} className="relative group">
                            <button
                                onClick={() => setCurrentQuestion(q)}
                                className={cn(
                                    "w-full text-left p-3 rounded-lg border transition-all duration-200",
                                    (currentQuestion as any)?.id === q.id
                                        ? "bg-accent/80 border-primary/50 ring-1 ring-primary/20"
                                        : "bg-card/50 border-border/50 hover:bg-accent hover:border-border"
                                )}
                            >
                                <div className="flex justify-between items-start mb-1">
                                    <span className={cn(
                                        "text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded",
                                        q.difficulty === 'Beginner' ? "bg-emerald-500/10 text-emerald-500" :
                                            q.difficulty === 'Intermediate' ? "bg-amber-500/10 text-amber-500" :
                                                "bg-rose-500/10 text-rose-500"
                                    )}>
                                        {q.difficulty}
                                    </span>
                                    {activeTab === 'platform' && (
                                        <span className="text-[10px] text-muted-foreground">{q.category}</span>
                                    )}
                                </div>
                                <h3 className={cn(
                                    "text-sm font-medium pr-8 line-clamp-2",
                                    q.title ? "text-foreground/90 group-hover:text-foreground" : "text-muted-foreground italic"
                                )}>
                                    {q.title || 'Untitled Question'}
                                </h3>
                            </button>

                            {activeTab === 'custom' && (
                                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            deleteCustomQuestion(q.id);
                                        }}
                                        title="Delete question"
                                    >
                                        <Trash2 size={12} />
                                    </Button>
                                </div>
                            )}
                        </div>
                    ))}
                    {filteredQuestions.length === 0 && (
                        <div className="py-8 text-center">
                            <p className="text-sm text-muted-foreground">No questions found</p>
                        </div>
                    )}
                </div>
            </ScrollArea>

            {/* Footer */}
            <div className="p-3 border-t border-border">
                <p className="text-xs text-muted-foreground text-center">
                    Drag nodes to canvas to add
                </p>
            </div>

            <div
                className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/50 transition-colors group"
                onMouseDown={(e) => {
                    e.preventDefault();
                    setIsResizing(true);
                }}
            >
                <div className="absolute right-0 top-0 bottom-0 w-1 bg-primary/0 group-hover:bg-primary/50 transition-colors" />
            </div>
        </div>
    );
}
