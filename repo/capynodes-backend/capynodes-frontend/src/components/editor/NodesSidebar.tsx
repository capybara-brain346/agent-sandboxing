'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { Search, ChevronDown, ChevronRight, PanelRightClose, PanelRight, LayoutGrid } from 'lucide-react';
import {
    nodeDefinitions,
    categoryLabels,
    categoryColors,
    NodeCategory,
    NodeDefinition,
} from '@/data/node-definitions';
import * as LucideIcons from 'lucide-react';
import { Plus, Edit2, Trash2, Box } from 'lucide-react';
import CustomNodeModal from '@/components/modals/CustomNodeModal';
import { CustomNodeDefinition } from '@/lib/api';

import { useEditorStore } from '@/store/editor-store';
import { cn } from '@/lib/cn';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

function NodeItem({ node }: { node: NodeDefinition }) {
    const colors = categoryColors[node.category];
    const Icon = node.icon;

    const onDragStart = (event: React.DragEvent) => {
        event.dataTransfer.setData('application/reactflow', node.type);
        event.dataTransfer.effectAllowed = 'move';
    };

    return (
        <div
            draggable
            onDragStart={onDragStart}
            className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-lg cursor-grab',
                'border border-border/50 bg-card/50',
                'hover:bg-accent hover:border-border transition-all duration-200',
                'active:cursor-grabbing active:scale-[0.98]'
            )}
            title={node.tooltip}
        >
            <div className={cn('p-1.5 rounded-md', colors.bg, colors.text)}>
                <Icon size={16} />
            </div>
            <span className="text-[13px] text-foreground/80 truncate">{node.label}</span>
        </div>
    );
}

function CustomNodeItem({
    node,
    onEdit,
    onDelete
}: {
    node: CustomNodeDefinition;
    onEdit: () => void;
    onDelete: () => void;
}) {
    const Icon = (LucideIcons as any)[node.icon_name] || Box;

    const onDragStart = (event: React.DragEvent) => {
        event.dataTransfer.setData('application/reactflow', node.type);
        event.dataTransfer.effectAllowed = 'move';
    };

    return (
        <div
            draggable
            onDragStart={onDragStart}
            className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-lg cursor-grab group relative',
                'border border-border/50 bg-card/50',
                'hover:bg-accent hover:border-border transition-all duration-200',
                'active:cursor-grabbing active:scale-[0.98]'
            )}
            title={node.tooltip || node.description}
        >
            <div className={cn('p-1.5 rounded-md bg-amber-500/10 text-amber-400')}>
                <Icon size={16} />
            </div>
            <span className="text-[13px] text-foreground/80 truncate pr-12">{node.label}</span>

            <div className="absolute right-2 opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity">
                <button
                    onClick={(e) => { e.stopPropagation(); onEdit(); }}
                    className="p-1 hover:text-primary transition-colors"
                >
                    <Edit2 size={12} />
                </button>
                <button
                    onClick={(e) => { e.stopPropagation(); onDelete(); }}
                    className="p-1 hover:text-destructive transition-colors"
                >
                    <Trash2 size={12} />
                </button>
            </div>
        </div>
    );
}

function CategorySection({
    category,
    nodes,
    isExpanded,
    onToggle,
}: {
    category: NodeCategory;
    nodes: NodeDefinition[];
    isExpanded: boolean;
    onToggle: () => void;
}) {
    const colors = categoryColors[category];

    return (
        <div className="mb-2">
            <button
                onClick={onToggle}
                className={cn(
                    'w-full flex items-center gap-2 px-3 py-2 rounded-lg',
                    'hover:bg-accent transition-colors',
                    colors.text
                )}
            >
                {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                <span className="text-[13px] font-medium">{categoryLabels[category]}</span>
                <span className="ml-auto text-xs text-muted-foreground">{nodes.length}</span>
            </button>
            {isExpanded && (
                <div className="mt-1 ml-2 space-y-1.5">
                    {nodes.map((node) => (
                        <NodeItem key={node.type} node={node} />
                    ))}
                </div>
            )}
        </div>
    );
}

export default function NodesSidebar() {
    const [searchQuery, setSearchQuery] = useState('');
    const [expandedCategories, setExpandedCategories] = useState<Set<NodeCategory>>(
        new Set(['data-ingestion', 'storage', 'models'])
    );
    const [isResizing, setIsResizing] = useState(false);
    const sidebarRef = useRef<HTMLDivElement>(null);
    const [isCustomModalOpen, setIsCustomModalOpen] = useState(false);
    const [editingNode, setEditingNode] = useState<CustomNodeDefinition | undefined>(undefined);
    const {
        nodesSidebarCollapsed,
        setNodesSidebarCollapsed,
        rightSidebarWidth,
        setRightSidebarWidth,
        customNodeDefinitions,
        fetchCustomNodes,
        deleteCustomNode,
    } = useEditorStore();

    useEffect(() => {
        fetchCustomNodes();
    }, [fetchCustomNodes]);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizing) return;
            const newWidth = window.innerWidth - e.clientX;
            setRightSidebarWidth(newWidth);
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
    }, [isResizing, setRightSidebarWidth]);

    const filteredNodesByCategory = useMemo(() => {
        const filtered = nodeDefinitions.filter(
            (node) =>
                node.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
                node.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
                node.description?.toLowerCase().includes(searchQuery.toLowerCase())
        );

        return filtered.reduce(
            (acc, node) => {
                if (!acc[node.category]) {
                    acc[node.category] = [];
                }
                acc[node.category].push(node);
                return acc;
            },
            {} as Record<NodeCategory, NodeDefinition[]>
        );
    }, [searchQuery]);

    const filteredCustomNodes = useMemo(() => {
        if (!searchQuery) return customNodeDefinitions;
        return customNodeDefinitions.filter(n =>
            n.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
            n.description.toLowerCase().includes(searchQuery.toLowerCase())
        );
    }, [customNodeDefinitions, searchQuery]);


    const categories = Object.keys(filteredNodesByCategory) as NodeCategory[];

    const toggleCategory = (category: NodeCategory | 'user-custom') => {
        const newExpanded = new Set(expandedCategories);
        if (newExpanded.has(category as any)) {
            newExpanded.delete(category as any);
        } else {
            newExpanded.add(category as any);
        }
        setExpandedCategories(newExpanded as any);
    };

    const handleDeleteCustom = async (id: number) => {
        if (confirm('Are you sure you want to delete this custom node?')) {
            try {
                const { apiClient } = await import('@/lib/api');
                await apiClient.deleteCustomNode(id);
                deleteCustomNode(id);
            } catch (error) {
                console.error('Error deleting custom node:', error);
            }
        }
    };


    if (nodesSidebarCollapsed) {
        return (
            <div className="w-12 h-full bg-background border-l border-border flex flex-col items-center py-4 gap-2 flex-shrink-0">
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10"
                    onClick={() => setNodesSidebarCollapsed(false)}
                    title="Expand nodes sidebar"
                >
                    <PanelRight size={20} />
                </Button>
                <Button
                    variant="secondary"
                    size="icon"
                    onClick={() => setNodesSidebarCollapsed(false)}
                >
                    <LayoutGrid size={18} />
                </Button>
            </div>
        );
    }

    return (
        <div
            ref={sidebarRef}
            className="h-full bg-background border-l border-border flex flex-col relative flex-shrink-0"
            style={{ width: `${rightSidebarWidth}px` }}
        >
            <div className="p-4 border-b border-border">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <LayoutGrid size={18} className="text-primary" />
                        <h2 className="text-sm font-semibold text-foreground">Nodes</h2>
                    </div>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setNodesSidebarCollapsed(true)}
                        title="Collapse nodes sidebar"
                    >
                        <PanelRightClose size={16} />
                    </Button>
                </div>

                <div className="relative">
                    <Search
                        size={16}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    />
                    <Input
                        type="text"
                        placeholder="Search nodes..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9 bg-card"
                    />
                </div>
            </div>

            <ScrollArea className="flex-1">
                <div className="p-4 space-y-4">
                    {categories.map((category) => (
                        <CategorySection
                            key={category}
                            category={category}
                            nodes={filteredNodesByCategory[category]}
                            isExpanded={expandedCategories.has(category) || searchQuery.length > 0}
                            onToggle={() => toggleCategory(category)}
                        />
                    ))}

                    {/* User Custom Section */}
                    <div className="mb-2">
                        <button
                            onClick={() => toggleCategory('user-custom' as any)}
                            className={cn(
                                'w-full flex items-center gap-2 px-3 py-2 rounded-lg',
                                'hover:bg-accent transition-colors text-amber-400'
                            )}
                        >
                            {expandedCategories.has('user-custom' as any) || searchQuery.length > 0 ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            <span className="text-[13px] font-medium">Custom</span>
                            <span className="ml-auto text-xs text-muted-foreground">{filteredCustomNodes.length}</span>
                        </button>
                        {(expandedCategories.has('user-custom' as any) || searchQuery.length > 0) && (
                            <div className="mt-1 ml-2 space-y-1.5">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="w-full h-8 border-dashed border-amber-500/30 text-amber-500/70 hover:text-amber-500 hover:border-amber-500/50 hover:bg-amber-500/5 transition-all text-[11px]"
                                    onClick={() => {
                                        setEditingNode(undefined);
                                        setIsCustomModalOpen(true);
                                    }}
                                >
                                    <Plus size={14} className="mr-1" /> Create Custom Node
                                </Button>
                                {filteredCustomNodes.map((node) => (
                                    <CustomNodeItem
                                        key={node.id}
                                        node={node}
                                        onEdit={() => {
                                            setEditingNode(node);
                                            setIsCustomModalOpen(true);
                                        }}
                                        onDelete={() => handleDeleteCustom(node.id)}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </ScrollArea>

            <CustomNodeModal
                isOpen={isCustomModalOpen}
                onClose={() => setIsCustomModalOpen(false)}
                editingNode={editingNode}
            />


            <div className="p-3 border-t border-border">
                <p className="text-xs text-muted-foreground text-center">
                    Drag nodes to canvas to add
                </p>
            </div>

            <div
                className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/50 transition-colors group z-50"
                onMouseDown={(e) => {
                    e.preventDefault();
                    setIsResizing(true);
                }}
            >
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary/0 group-hover:bg-primary/50 transition-colors" />
            </div>
        </div >
    );
}

