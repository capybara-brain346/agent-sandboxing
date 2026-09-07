'use client';

import { useState } from 'react';
import { Layers, ChevronDown, X, Play } from 'lucide-react';
import { templates } from '@/data/templates';
import { useEditorStore } from '@/store/editor-store';
import { useReactFlow } from '@xyflow/react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

export default function TemplateSelector() {
    const [isOpen, setIsOpen] = useState(false);
    const { importDiagram, setProblemStatement, setConstraints, pushHistory } = useEditorStore();
    const { fitView } = useReactFlow();

    const handleSelectTemplate = (templateId: string) => {
        const template = templates.find((t) => t.id === templateId);
        if (!template) return;

        pushHistory();
        importDiagram({
            nodes: template.nodes,
            edges: template.edges,
        });
        setProblemStatement(template.problem);
        setConstraints(template.constraints);
        setIsOpen(false);

        setTimeout(() => fitView({ padding: 0.2 }), 50);
    };

    if (!isOpen) {
        return (
            <Button
                variant="outline"
                onClick={() => setIsOpen(true)}
                className="absolute top-4 left-[calc(18rem+1rem)] z-10 bg-card"
            >
                <Layers size={16} />
                Templates
                <ChevronDown size={14} />
            </Button>
        );
    }

    return (
        <Card className="absolute top-4 left-[calc(18rem+1rem)] z-20 w-80 bg-card/95 backdrop-blur-xl shadow-xl overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between p-4 pb-0">
                <div className="flex items-center gap-2 text-foreground">
                    <Layers size={18} />
                    <span className="text-small font-semibold">Starter Templates</span>
                </div>
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setIsOpen(false)}
                    className="h-8 w-8"
                >
                    <X size={16} />
                </Button>
            </CardHeader>

            <ScrollArea className="p-3 max-h-80">
                <div className="space-y-2">
                    {templates.map((template) => (
                        <button
                            key={template.id}
                            onClick={() => handleSelectTemplate(template.id)}
                            className={cn(
                                "w-full text-left p-3 rounded-lg border border-border",
                                "hover:border-border/80 hover:bg-accent transition-colors group"
                            )}
                        >
                            <div className="flex items-center justify-between mb-1">
                                <span className="text-small font-semibold text-foreground">{template.name}</span>
                                <Play size={14} className="text-muted-foreground group-hover:text-foreground transition-colors" />
                            </div>
                            <p className="text-caption normal-case tracking-normal text-muted-foreground font-normal">{template.description}</p>
                            <div className="mt-2 flex gap-2">
                                <Badge variant="blue">
                                    {template.nodes.length} nodes
                                </Badge>
                                <Badge variant="purple">
                                    {template.edges.length} connections
                                </Badge>
                            </div>
                        </button>
                    ))}
                </div>
            </ScrollArea>

            <div className="px-4 py-2 border-t border-border bg-card/50">
                <p className="text-caption normal-case tracking-normal text-muted-foreground text-center font-normal">
                    Click to load template
                </p>
            </div>
        </Card>
    );
}
