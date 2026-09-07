'use client';

import { useCallback, useRef, useEffect, useState, useMemo } from 'react';
import {
    ReactFlow,
    Background,
    Controls,
    MiniMap,
    BackgroundVariant,
    ReactFlowProvider,
    useReactFlow,
    Node,
    ConnectionMode,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Sparkles } from 'lucide-react';


import { useEditorStore } from '@/store/editor-store';
import { nodeTypes, BaseNode } from '@/components/nodes';
import { categoryColors, getNodeDefinition, NodeCategory, PropertyDefinition } from '@/data/node-definitions';
import { useTheme } from 'next-themes';

function EditorCanvas() {
    const reactFlowWrapper = useRef<HTMLDivElement>(null);
    const { screenToFlowPosition } = useReactFlow();
    const [isClient, setIsClient] = useState(false);
    const { theme } = useTheme();

    const {
        nodes,
        edges,
        onNodesChange,
        onEdgesChange,
        onConnect,
        addNode,
        setSelectedNodeId,
        deleteNode,
        deleteEdge,
        duplicateNode,
        undo,
        redo,
        history,
        pushHistory,
        selectedNodeId,
        customNodeDefinitions,
    } = useEditorStore();

    const allNodeTypes = useMemo(() => {
        const types = { ...nodeTypes };
        customNodeDefinitions.forEach((def) => {
            types[def.type] = BaseNode;
        });
        return types;
    }, [customNodeDefinitions]);

    useEffect(() => {
        setIsClient(true);
    }, []);

    // Seed history with initial state if it only contains the empty state but nodes exist
    // This happens after page reload/rehydration from persistent storage
    useEffect(() => {
        if (isClient && nodes.length > 0 && history.length === 1 && history[0].nodes.length === 0) {
            pushHistory();
        }
    }, [isClient, nodes.length, history.length, pushHistory]);

    // Handle drag and drop
    const onDragOver = useCallback((event: React.DragEvent) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
    }, []);

    const onDrop = useCallback(
        (event: React.DragEvent) => {
            event.preventDefault();

            const type = event.dataTransfer.getData('application/reactflow');
            if (!type) return;

            const position = screenToFlowPosition({
                x: event.clientX,
                y: event.clientY,
            });

            const definition = getNodeDefinition(type) || customNodeDefinitions.find(d => d.type === type);

            // Initialize node data with default property values
            const initialData: Record<string, unknown> = {};
            if (definition) {
                definition.properties.forEach((prop: PropertyDefinition) => {
                    if (prop.defaultValue !== undefined) {
                        initialData[prop.key] = prop.defaultValue;
                    }
                });
            }

            const newNode: Node = {
                id: `${type}-${Date.now()}`,
                type,
                position,
                data: initialData,
            };

            addNode(newNode);
        },
        [screenToFlowPosition, addNode, customNodeDefinitions]
    );

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            // Ignore if typing in an input
            if (
                event.target instanceof HTMLInputElement ||
                event.target instanceof HTMLTextAreaElement
            ) {
                return;
            }

            // Undo: Ctrl/Cmd + Z
            if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey) {
                event.preventDefault();
                undo();
            }

            // Redo: Ctrl/Cmd + Shift + Z or Ctrl/Cmd + Y
            if (
                ((event.ctrlKey || event.metaKey) && event.key === 'z' && event.shiftKey) ||
                ((event.ctrlKey || event.metaKey) && event.key === 'y')
            ) {
                event.preventDefault();
                redo();
            }

            // Delete selected node
            if ((event.key === 'Delete' || event.key === 'Backspace') && selectedNodeId) {
                event.preventDefault();
                deleteNode(selectedNodeId);
            }

            // Duplicate: Ctrl/Cmd + D
            if ((event.ctrlKey || event.metaKey) && event.key === 'd' && selectedNodeId) {
                event.preventDefault();
                duplicateNode(selectedNodeId);
            }

            // Clear selection: Escape
            if (event.key === 'Escape') {
                setSelectedNodeId(null);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedNodeId, undo, redo, deleteNode, duplicateNode, setSelectedNodeId]);

    // Handle node selection
    const onNodeClick = useCallback(
        (_: React.MouseEvent, node: Node) => {
            setSelectedNodeId(node.id);
        },
        [setSelectedNodeId]
    );

    // Handle background click to deselect
    const onPaneClick = useCallback(() => {
        setSelectedNodeId(null);
    }, [setSelectedNodeId]);

    // Handle edge click for deletion
    const onEdgeClick = useCallback(
        (_: React.MouseEvent, edge: { id: string }) => {
            deleteEdge(edge.id);
        },
        [deleteEdge]
    );

    // MiniMap node color based on category
    const nodeColor = useCallback((node: Node) => {
        const definition = getNodeDefinition(node.type || '') || customNodeDefinitions.find(d => d.type === node.type);
        if (definition) {
            return categoryColors[definition.category as NodeCategory]?.accent || '#64748b';
        }
        return '#64748b';
    }, [customNodeDefinitions]);

    if (!isClient) {
        return (
            <div className="w-full h-full bg-background flex items-center justify-center">
                <div className="text-muted-foreground">Loading editor...</div>
            </div>
        );
    }

    return (
        <div ref={reactFlowWrapper} className="w-full h-full">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onDragOver={onDragOver}
                onDrop={onDrop}
                onNodeClick={onNodeClick}
                onNodeDragStop={() => pushHistory()}
                onPaneClick={onPaneClick}
                onEdgeClick={onEdgeClick}
                nodeTypes={allNodeTypes}
                fitView
                snapToGrid
                snapGrid={[15, 15]}
                connectionRadius={30}
                connectionMode={ConnectionMode.Loose}
                defaultEdgeOptions={{
                    type: 'smoothstep',
                    animated: true,
                    style: { stroke: '#64748b', strokeWidth: 2 },
                }}
                connectionLineStyle={{ stroke: '#64748b', strokeWidth: 2 }}
                proOptions={{ hideAttribution: true }}
                className={theme === 'dark' ? 'bg-slate-950' : 'bg-slate-50'}
            >
                <Background
                    variant={BackgroundVariant.Dots}
                    gap={20}
                    size={1}
                    color={theme === 'dark' ? '#334155' : '#cbd5e1'}
                />
                <Controls
                    className="!bg-background !border-border !rounded-xl overflow-hidden [&>button]:!bg-background [&>button]:!border-border [&>button]:!text-foreground hover:[&>button]:!bg-accent"
                />
                <MiniMap
                    nodeColor={nodeColor}
                    maskColor={theme === 'dark' ? 'rgba(0, 0, 0, 0.8)' : 'rgba(255, 255, 255, 0.8)'}
                    className="!bg-background !border-border !rounded-xl"
                    pannable
                    zoomable
                />
            </ReactFlow>
            {nodes.length === 0 && (
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-20">
                    <div className="flex flex-col items-center gap-4 p-8 rounded-2xl bg-background/20 backdrop-blur-sm border border-border/50 animate-in fade-in zoom-in duration-700">
                        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20">
                            <Sparkles className="w-8 h-8 text-primary opacity-50" />
                        </div>
                        <div className="text-center space-y-2">
                            <h3 className="text-lg font-bold text-foreground">Design your architecture</h3>
                            <p className="text-sm text-muted-foreground max-w-[240px]">
                                Drag components from the sidebar on the right to start building your solution.
                            </p>
                        </div>
                        <div className="mt-4 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-primary/50">
                            <div className="w-8 h-px bg-primary/20" />
                            <span>Ready to Evaluate?</span>
                            <div className="w-8 h-px bg-primary/20" />
                        </div>
                        <p className="text-[10px] text-muted-foreground italic">Add at least one node to begin scoring</p>
                    </div>
                </div>
            )}
        </div>

    );
}

export default function Editor() {
    return (
        <ReactFlowProvider>
            <EditorCanvas />
        </ReactFlowProvider>
    );
}
