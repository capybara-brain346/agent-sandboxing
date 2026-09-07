'use client';

import { memo, useMemo } from 'react';
import { Handle, Position, NodeProps, useConnection } from '@xyflow/react';
import { getNodeDefinition, categoryColors, NodeCategory } from '@/data/node-definitions';
import * as LucideIcons from 'lucide-react';
import { Box } from 'lucide-react';
import { useEditorStore } from '@/store/editor-store';
import { cn } from '@/lib/cn';
import { X } from 'lucide-react';

interface CustomNodeData {
    label?: string;
    description?: string;
    isDemo?: boolean;
    onDemoClick?: (id: string) => void;
    onDemoDelete?: (id: string) => void;
    [key: string]: unknown;
}

function BaseNode({ id, data, selected, type }: NodeProps) {
    const customNodeDefinitions = useEditorStore((state) => state.customNodeDefinitions);
    const definition = useMemo(() => {
        const staticDef = getNodeDefinition(type || '');
        if (staticDef) return staticDef;

        const customDef = customNodeDefinitions.find(d => d.type === type);
        if (customDef) {
            return {
                type: customDef.type,
                label: customDef.label,
                category: customDef.category as any,
                icon: (LucideIcons as any)[customDef.icon_name] || Box,
                description: customDef.description,
                tooltip: customDef.tooltip || customDef.description,
                properties: customDef.properties,
                inputs: customDef.inputs,
                outputs: customDef.outputs,
            } as any;
        }
        return undefined;
    }, [type, customNodeDefinitions]);

    const connection = useConnection();
    const setSelectedNodeId = useEditorStore((state) => state.setSelectedNodeId);
    const deleteNode = useEditorStore((state) => state.deleteNode);

    const nodeData = data as CustomNodeData;

    if (!definition) {
        return (
            <div className="px-4 py-2 bg-destructive/20 border border-destructive rounded-lg text-destructive text-sm">
                Unknown node: {type}
            </div>
        );
    }

    const colors = categoryColors[definition.category as NodeCategory];
    const Icon = definition.icon;
    const nodeLabel = nodeData.label || definition.label;

    // Check if this node is being connected to
    const isTarget = connection.inProgress && connection.fromNode?.id !== id;

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (nodeData.isDemo && nodeData.onDemoClick) {
            nodeData.onDemoClick(id);
        } else if (!nodeData.isDemo) {
            setSelectedNodeId(id);
        }
    };

    const handleDelete = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (nodeData.isDemo && nodeData.onDemoDelete) {
            nodeData.onDemoDelete(id);
        } else if (!nodeData.isDemo) {
            deleteNode(id);
        }
    };

    return (
        <div
            onClick={handleClick}
            className={cn(
                "relative px-4 py-3 min-w-[160px] rounded-xl transition-all duration-200 group/node",
                "bg-card border",
                selected
                    ? "border-foreground/60 shadow-lg shadow-foreground/5"
                    : "border-border hover:border-foreground/30",
                isTarget && "ring-1 ring-foreground/50",
                "cursor-pointer"
            )}
            title={definition.tooltip}
        >
            {/* Delete Button */}
            <button
                onClick={handleDelete}
                className={cn(
                    "absolute -top-2 -right-2 w-5 h-5 rounded-full bg-destructive text-destructive-foreground items-center justify-center shadow-md",
                    "hidden group-hover/node:flex transition-all hover:scale-110 active:scale-95 z-50",
                    selected && "flex"
                )}
            >
                <X size={12} strokeWidth={3} />
            </button>

            {/* Input Handles */}
            {Array.from({ length: definition.inputs }).map((_, index) => (
                <Handle
                    key={`input-${index}`}
                    type="target"
                    position={Position.Left}
                    id={`input-${index}`}
                    className="!w-4 !h-4 !bg-foreground/20 !border-2 !border-background hover:!bg-foreground/50 hover:!scale-125 transition-all nodrag"
                    style={{
                        top: definition.inputs === 1 ? '50%' : `${((index + 1) / (definition.inputs + 1)) * 100}%`,
                    }}
                />
            ))}

            {/* Node Content */}
            <div className="flex items-center gap-3">
                <div className={cn("p-2 rounded-lg", colors.bg, colors.text)}>
                    <Icon size={20} />
                </div>
                <div className="flex flex-col">
                    <span className="text-sm font-medium text-foreground whitespace-nowrap">
                        {nodeLabel}
                    </span>
                    <span className="text-xs text-muted-foreground capitalize">
                        {definition.category.replace('-', ' ')}
                    </span>
                </div>
            </div>

            {/* Output Handles */}
            {Array.from({ length: definition.outputs }).map((_, index) => (
                <Handle
                    key={`output-${index}`}
                    type="source"
                    position={Position.Right}
                    id={`output-${index}`}
                    className="!w-4 !h-4 !bg-foreground/20 !border-2 !border-background hover:!bg-foreground/50 hover:!scale-125 transition-all nodrag"
                    style={{
                        top: definition.outputs === 1 ? '50%' : `${((index + 1) / (definition.outputs + 1)) * 100}%`,
                    }}
                />
            ))}

            {/* Selection Indicator */}
            {selected && (
                <div className="absolute -inset-px rounded-xl bg-gradient-to-r from-foreground/10 to-transparent pointer-events-none" />
            )}
        </div>
    );
}

export default memo(BaseNode);
