'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import { X, Trash2 } from 'lucide-react';
import { useEditorStore } from '@/store/editor-store';
import { getNodeDefinition, categoryColors, PropertyDefinition } from '@/data/node-definitions';
import * as LucideIcons from 'lucide-react';
import { Box } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';

function PropertyInput({
    property,
    value,
    onChange,
}: {
    property: PropertyDefinition;
    value: unknown;
    onChange: (value: unknown) => void;
}) {
    const inputClasses = "bg-background/50";

    switch (property.type) {
        case 'text':
            return (
                <Input
                    type="text"
                    value={(value as string) || ''}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={property.placeholder}
                    className={inputClasses}
                />
            );
        case 'number':
            return (
                <Input
                    type="number"
                    value={(value as number) ?? ''}
                    onChange={(e) => onChange(e.target.value ? Number(e.target.value) : '')}
                    placeholder={property.placeholder}
                    className={inputClasses}
                />
            );
        case 'select':
            return (
                <select
                    value={(value as string) || String(property.defaultValue || '')}
                    onChange={(e) => onChange(e.target.value)}
                    className={cn(
                        "flex h-9 w-full rounded-md border border-input bg-background/50 px-3 py-1 text-sm shadow-sm transition-colors",
                        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    )}
                >
                    {property.options?.map((option) => (
                        <option key={option} value={option}>
                            {option}
                        </option>
                    ))}
                </select>
            );
        case 'boolean':
            return (
                <label className="flex items-center gap-2 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={(value as boolean) ?? property.defaultValue ?? false}
                        onChange={(e) => onChange(e.target.checked)}
                        className="w-4 h-4 rounded border-border bg-background text-primary focus:ring-ring"
                    />
                    <span className="text-sm text-muted-foreground">Enabled</span>
                </label>
            );
        default:
            return null;
    }
}

export default function PropertiesPanel() {
    const [isResizing, setIsResizing] = useState(false);
    const sidebarRef = useRef<HTMLDivElement>(null);
    const {
        nodes,
        selectedNodeId,
        setSelectedNodeId,
        updateNodeData,
        deleteNode,
        propertiesPanelCollapsed,
        rightSidebarWidth,
        setRightSidebarWidth,
        customNodeDefinitions,
    } = useEditorStore();


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

    const selectedNode = useMemo(() => {
        if (!selectedNodeId) return null;
        return nodes.find((n) => n.id === selectedNodeId);
    }, [nodes, selectedNodeId]);

    const definition = useMemo(() => {
        if (!selectedNode?.type) return null;
        const staticDef = getNodeDefinition(selectedNode.type);
        if (staticDef) return staticDef;

        const customDef = customNodeDefinitions.find(d => d.type === selectedNode.type);
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
        return null;
    }, [selectedNode, customNodeDefinitions]);


    if (propertiesPanelCollapsed || !selectedNode || !definition) {
        return null;
    }

    // @ts-ignore
    const colors = categoryColors[definition.category as NodeCategory];
    const Icon = definition.icon;

    const handlePropertyChange = (key: string, value: unknown) => {
        updateNodeData(selectedNodeId!, { [key]: value });
    };

    const handleDelete = () => {
        deleteNode(selectedNodeId!);
    };

    const handleClose = () => {
        setSelectedNodeId(null);
    };

    return (
        <div
            ref={sidebarRef}
            className="h-full bg-background border-l border-border flex flex-col relative flex-shrink-0"
            style={{ width: `${rightSidebarWidth}px` }}
        >
            {/* Header */}
            <div className="p-4 border-b border-border">
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                        <div className={cn("p-2 rounded-lg", colors.bg, colors.text)}>
                            <Icon size={18} />
                        </div>
                        <div>
                            <h3 className="text-sm font-semibold text-foreground">{definition.label}</h3>
                            <p className="text-xs text-muted-foreground capitalize">
                                {definition.category.replace('-', ' ')}
                            </p>
                        </div>
                    </div>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={handleClose}
                    >
                        <X size={16} />
                    </Button>
                </div>
                <p className="text-xs text-muted-foreground">{definition.description}</p>
            </div>

            {/* Properties */}
            <ScrollArea className="flex-1 p-4">
                <div className="space-y-4">
                    {/* Custom Label */}
                    <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                            Display Label
                        </label>
                        <Input
                            type="text"
                            value={(selectedNode.data.label as string) || ''}
                            onChange={(e) => handlePropertyChange('label', e.target.value)}
                            placeholder={definition.label}
                            className="bg-background/50"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                            Description
                        </label>
                        <textarea
                            value={(selectedNode.data.description as string) || ''}
                            onChange={(e) => {
                                const value = e.target.value;
                                if (value.length <= 280) {
                                    handlePropertyChange('description', value);
                                }
                            }}
                            placeholder="Explain your choice for this component..."
                            maxLength={280}
                            className={cn(
                                "flex min-h-[80px] w-full rounded-md border border-input bg-background/50 px-3 py-2 text-sm shadow-sm transition-colors",
                                "placeholder:text-muted-foreground",
                                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                                "resize-none"
                            )}
                        />
                        <div className="flex justify-between items-center mt-1">
                            <p className="text-xs text-muted-foreground/70">
                                Why did you choose this component?
                            </p>
                            <span className={cn(
                                "text-xs",
                                ((selectedNode.data.description as string) || '').length > 250
                                    ? "text-orange-500"
                                    : "text-muted-foreground"
                            )}>
                                {((selectedNode.data.description as string) || '').length}/280
                            </span>
                        </div>
                    </div>

                    {/* Dynamic Properties */}
                    {definition.properties.map((property: PropertyDefinition) => (
                        <div key={property.key}>
                            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                                {property.label}
                            </label>
                            {property.description && (
                                <p className="text-xs text-muted-foreground/70 mb-1.5">{property.description}</p>
                            )}
                            <PropertyInput
                                property={property}
                                value={selectedNode.data[property.key]}
                                onChange={(value) => handlePropertyChange(property.key, value)}
                            />
                        </div>
                    ))}
                </div>
            </ScrollArea>

            {/* Footer */}
            <div className="p-4 border-t border-border">
                <Button
                    variant="outline"
                    onClick={handleDelete}
                    className="w-full border-destructive/30 text-destructive hover:bg-destructive/10 hover:border-destructive/50"
                >
                    <Trash2 size={16} />
                    Delete Node
                </Button>
            </div>

            {/* Tooltip */}
            <div className="p-3 border-t border-border bg-card/50">
                <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground/70">Tip:</span> {definition.tooltip}
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
        </div>
    );
}
