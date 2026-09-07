'use client';

import { useCallback, useState } from 'react';
import {
    Undo2,
    Redo2,
    LayoutGrid,
    Download,
    Upload,
    Trash2,
    Sun,
    Moon,
    Image as ImageIcon,
    FileImage,
} from 'lucide-react';
import { useReactFlow } from '@xyflow/react';
import { useRouter } from 'next/navigation';
import dagre from '@dagrejs/dagre';
import { toPng, toSvg } from 'html-to-image';
import { useEditorStore } from '@/store/editor-store';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from 'next-themes';
import { Node, Edge } from '@xyflow/react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { Play, Loader2, Sparkles, Clock } from 'lucide-react';
import { useEffect } from 'react';

function formatTimeRemainingShort(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

export default function ControlsBar() {
    const { getNodes, getEdges, setNodes, fitView } = useReactFlow();
    const { theme, setTheme } = useTheme();
    const {
        undo,
        redo,
        history,
        historyIndex,
        exportDiagram,
        importDiagram,
        clearDiagram,
        pushHistory,
    } = useEditorStore();
    const { logout } = useAuth();
    const router = useRouter();

    const {
        credits,
        creditsLoading,
        fetchCredits,
        isEvaluating,
        evaluationResult,
        submitForEvaluation,
        currentQuestion,
        isQuestionIncomplete,
        nodes
    } = useEditorStore();

    useEffect(() => {
        fetchCredits();
    }, [fetchCredits]);

    const isIncomplete = isQuestionIncomplete();
    const isCanvasEmpty = nodes.length === 0;

    const canUndo = historyIndex > 0;
    const canRedo = historyIndex < history.length - 1;


    // Auto-layout using dagre
    const onAutoLayout = useCallback(() => {
        const nodes = getNodes();
        const edges = getEdges();

        if (nodes.length === 0) return;

        pushHistory();

        const dagreGraph = new dagre.graphlib.Graph();
        dagreGraph.setDefaultEdgeLabel(() => ({}));
        dagreGraph.setGraph({ rankdir: 'LR', nodesep: 80, ranksep: 120 });

        nodes.forEach((node) => {
            dagreGraph.setNode(node.id, { width: 200, height: 80 });
        });

        edges.forEach((edge) => {
            dagreGraph.setEdge(edge.source, edge.target);
        });

        dagre.layout(dagreGraph);

        const layoutedNodes = nodes.map((node) => {
            const nodeWithPosition = dagreGraph.node(node.id);
            return {
                ...node,
                position: {
                    x: nodeWithPosition.x - 100,
                    y: nodeWithPosition.y - 40,
                },
            };
        });

        setNodes(layoutedNodes);
        setTimeout(() => fitView({ padding: 0.2 }), 50);
    }, [getNodes, getEdges, setNodes, fitView, pushHistory]);

    // Export as PNG
    const onExportPng = useCallback(async () => {
        const element = document.querySelector('.react-flow') as HTMLElement;
        if (!element) return;

        try {
            const dataUrl = await toPng(element, {
                backgroundColor: theme === 'dark' ? '#000000' : '#fafafa',
                quality: 1,
            });
            const link = document.createElement('a');
            link.download = 'ai-design-diagram.png';
            link.href = dataUrl;
            link.click();
        } catch (error) {
            console.error('Export failed:', error);
        }
    }, [theme]);

    // Export as SVG
    const onExportSvg = useCallback(async () => {
        const element = document.querySelector('.react-flow') as HTMLElement;
        if (!element) return;

        try {
            const dataUrl = await toSvg(element, {
                backgroundColor: theme === 'dark' ? '#000000' : '#fafafa',
            });
            const link = document.createElement('a');
            link.download = 'ai-design-diagram.svg';
            link.href = dataUrl;
            link.click();
        } catch (error) {
            console.error('Export failed:', error);
        }
    }, [theme]);

    // Export as JSON
    const onExportJson = useCallback(() => {
        const data = exportDiagram();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = 'ai-design-diagram.json';
        link.href = url;
        link.click();
        URL.revokeObjectURL(url);
    }, [exportDiagram]);

    // Import JSON
    const onImportJson = useCallback(() => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;

            try {
                const text = await file.text();
                const data = JSON.parse(text) as {
                    nodes: Node[];
                    edges: Edge[];
                    problemStatement?: string;
                    constraints?: {
                        targetQPS: string;
                        latencyRequirement: string;
                        monthlyBudget: string;
                        dataVolume: string;
                        other: string;
                    };
                };
                importDiagram(data);
                setTimeout(() => fitView({ padding: 0.2 }), 50);
            } catch (error) {
                console.error('Import failed:', error);
                alert('Failed to import diagram. Please check the file format.');
            }
        };
        input.click();
    }, [importDiagram, fitView]);

    return (
        <>
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 px-2 py-1.5 bg-card border border-border rounded-xl shadow-lg">
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={undo}
                    disabled={!canUndo}
                    title="Undo (Ctrl+Z)"
                    className="h-8 w-8"
                >
                    <Undo2 size={16} />
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={redo}
                    disabled={!canRedo}
                    title="Redo (Ctrl+Y)"
                    className="h-8 w-8"
                >
                    <Redo2 size={16} />
                </Button>

                <div className="w-px h-5 bg-border mx-1" />

                <Button
                    variant="ghost"
                    size="icon"
                    onClick={onAutoLayout}
                    title="Auto Layout"
                    className="h-8 w-8"
                >
                    <LayoutGrid size={16} />
                </Button>

                <div className="w-px h-5 bg-border mx-1" />

                <Button
                    variant="ghost"
                    size="icon"
                    onClick={onExportPng}
                    title="Export PNG"
                    className="h-8 w-8"
                >
                    <ImageIcon size={16} />
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={onExportSvg}
                    title="Export SVG"
                    className="h-8 w-8"
                >
                    <FileImage size={16} />
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={onExportJson}
                    title="Export JSON"
                    className="h-8 w-8"
                >
                    <Download size={16} />
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={onImportJson}
                    title="Import JSON"
                    className="h-8 w-8"
                >
                    <Upload size={16} />
                </Button>

                <div className="w-px h-5 bg-border mx-1" />

                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                    title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
                    className="h-8 w-8"
                >
                    {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
                </Button>

                <div className="w-px h-5 bg-border mx-1" />

                <Button
                    variant="ghost"
                    size="icon"
                    onClick={clearDiagram}
                    title="Clear Diagram"
                    className={cn("h-8 w-8", "hover:bg-destructive/10 hover:text-destructive")}
                >
                    <Trash2 size={16} />
                </Button>

                <div className="w-px h-5 bg-border mx-1" />

                {/* Evaluate Button */}
                <Button
                    onClick={submitForEvaluation}
                    disabled={isEvaluating || !currentQuestion || isIncomplete || isCanvasEmpty || (credits !== null && credits.credits_remaining === 0)}
                    title={
                        isCanvasEmpty ? "Add at least one node to evaluate your design" :
                            isIncomplete ? "Please fill in all question fields in the sidebar" :
                                "Evaluate Design"
                    }
                    className={cn(
                        "h-8 px-3 relative overflow-hidden transition-all duration-300 group font-bold uppercase tracking-widest text-[10px] border rounded-lg",
                        currentQuestion && !isIncomplete && !isCanvasEmpty && (!credits || credits.credits_remaining > 0)
                            ? "bg-zinc-950 text-white border-zinc-800 hover:bg-zinc-900 dark:bg-white dark:text-black dark:border-zinc-200 dark:hover:bg-zinc-100 shadow-[0_1px_2px_rgba(0,0,0,0.05)] active:scale-[0.98]"
                            : "bg-zinc-100/50 text-zinc-400 border-zinc-200 dark:bg-zinc-900/50 dark:text-zinc-600 dark:border-zinc-800"
                    )}
                >

                    <div className="flex items-center justify-center gap-1.5">
                        {isEvaluating ? (
                            <Loader2 size={12} className="animate-spin" />
                        ) : (
                            <Play size={12} fill="currentColor" className={cn((!credits || credits.credits_remaining > 0) ? "" : "opacity-50")} />
                        )}
                        <span>{isEvaluating ? "EVALUATING" : "EVALUATE"}</span>
                        {credits && !isEvaluating && (
                            <>
                                <span className="opacity-50">|</span>
                                <span className="tabular-nums">{credits.credits_remaining}/{credits.max_credits}</span>
                            </>
                        )}
                    </div>
                </Button>

                {/* Reset Countdown (when 0 credits) */}
                {credits !== null && credits.credits_remaining === 0 && credits.seconds_until_reset !== null && (
                    <div className="flex items-center gap-1.5 ml-1 px-2.5 py-1 rounded-lg bg-zinc-950/50 border border-zinc-800/50 text-zinc-400 animate-in fade-in slide-in-from-left-2 duration-300">
                        <Clock size={12} className="animate-pulse" />
                        <span className="text-[10px] font-bold uppercase tracking-widest">
                            {formatTimeRemainingShort(credits.seconds_until_reset)}
                        </span>
                    </div>
                )}

                {/* Score Display (after evaluation) */}
                {evaluationResult && !isEvaluating && (
                    <div className="flex items-center gap-2 ml-2 pl-2 border-l border-border animate-in zoom-in duration-300">
                        <div className="flex flex-col items-center">
                            <span className="text-[10px] uppercase font-black text-muted-foreground leading-none mb-1">Score</span>
                            <div className={cn(
                                "flex items-center justify-center w-6 h-6 rounded-full border-2 text-[10px] font-black",
                                evaluationResult.overallScore >= 80 ? "border-green-500 text-green-500" :
                                    evaluationResult.overallScore >= 60 ? "border-yellow-500 text-yellow-500" :
                                        "border-red-500 text-red-500"
                            )}>
                                {evaluationResult.overallScore}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </>
    );
}
