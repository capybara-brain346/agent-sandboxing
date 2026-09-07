'use client';

import { useState, useEffect } from 'react';
import {
    Plus,
    Trash2,
    Box,
    Settings,
    Type,
    Hash,
    CheckSquare,
    List,
    Save,
    X
} from 'lucide-react';
import * as LucideIcons from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogDescription
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useEditorStore } from '@/store/editor-store';
import { apiClient, CustomNodeDefinition } from '@/lib/api';
import { cn } from '@/lib/cn';
import { ScrollArea } from '@/components/ui/scroll-area';

interface CustomNodeModalProps {
    isOpen: boolean;
    onClose: () => void;
    editingNode?: CustomNodeDefinition;
}

const ICON_OPTIONS = [
    'Box', 'Cpu', 'Database', 'Server', 'Cloud', 'Zap', 'Brain', 'Shield', 'Globe', 'Radio',
    'Lock', 'BarChart3', 'Terminal', 'Workflow', 'Code', 'GitBranch', 'Activity', 'HardDrive',
    'Layers', 'Link', 'Network', 'Package', 'Search', 'Share2', 'Smartphone', 'Tv', 'Waves',
    'Wifi', 'Wind', 'Anchor', 'Aperture', 'Archive', 'AtSign', 'Award', 'Bell', 'Bluetooth',
    'Bookmark', 'Camera', 'Cast', 'Clipboard', 'Clock', 'Compass', 'CreditCard', 'Download',
    'ExternalLink', 'Eye', 'File', 'Filter', 'Flag', 'Folder', 'Heart', 'Home', 'Image',
    'Inbox', 'Info', 'Key', 'LifeBuoy', 'Mail', 'Maximize', 'Menu', 'Mic', 'Minimize',
    'Moon', 'MoreHorizontal', 'Music', 'Navigation', 'Paperclip', 'Phone', 'Play', 'Power',
    'Printer', 'RefreshCcw', 'Repeat', 'Settings', 'Shuffle', 'Speaker', 'Star', 'Sun',
    'Sunrise', 'Sunset', 'Tag', 'Target', 'ThumbsDown', 'ThumbsUp', 'Trash', 'Unlock',
    'Upload', 'User', 'Video', 'Watch', 'Table', 'Tablet', 'Tally1', 'Tally2', 'Tally3',
    'Tally4', 'Tally5', 'Thermometer', 'Ticket', 'Timer', 'ToggleLeft', 'ToggleRight',
    'ToyBrick', 'Train', 'Trash2', 'TrendingDown', 'TrendingUp', 'Trophy', 'Truck', 'Undo',
    'Undo2', 'UserCheck', 'UserMinus', 'UserPlus', 'UserX', 'Volume', 'Wallet', 'Webcam',
    'Wrench', 'XOctagon', 'Youtube'
];

const CATEGORY_OPTIONS = [
    { value: 'data-ingestion', label: 'Data Ingestion' },
    { value: 'storage', label: 'Storage' },
    { value: 'processing', label: 'Processing' },
    { value: 'ml-components', label: 'ML Components' },
    { value: 'models', label: 'Models' },
    { value: 'serving', label: 'Serving' },
    { value: 'scaling', label: 'Scaling & Reliability' },
    { value: 'monitoring', label: 'Monitoring' },
    { value: 'compute', label: 'Compute' },
    { value: 'agents', label: 'AI Agents' },
    { value: 'misc', label: 'Miscellaneous' },
];

export default function CustomNodeModal({ isOpen, onClose, editingNode }: CustomNodeModalProps) {
    const [loading, setLoading] = useState(false);
    const addCustomNode = useEditorStore(state => state.addCustomNode);
    const updateStoreCustomNode = useEditorStore(state => state.updateCustomNode);

    const [formData, setFormData] = useState<Partial<CustomNodeDefinition>>({
        label: '',
        description: '',
        tooltip: '',
        category: 'misc',
        icon_name: 'Box',
        inputs: 1,
        outputs: 1,
        properties: [],
    });

    useEffect(() => {
        if (editingNode) {
            setFormData(editingNode);
        } else {
            setFormData({
                label: '',
                description: '',
                tooltip: '',
                category: 'misc',
                icon_name: 'Box',
                inputs: 1,
                outputs: 1,
                properties: [],
            });
        }
    }, [editingNode, isOpen]);

    const addProperty = () => {
        const newProperty = {
            key: `prop_${formData.properties?.length || 0}`,
            label: `Property ${formData.properties?.length || 0}`,
            type: 'text' as const,
            defaultValue: '',
            placeholder: '',
            description: '',
        };
        setFormData({
            ...formData,
            properties: [...(formData.properties || []), newProperty]
        });
    };

    const updateProperty = (index: number, updates: any) => {
        const newProperties = [...(formData.properties || [])];
        newProperties[index] = { ...newProperties[index], ...updates };
        setFormData({ ...formData, properties: newProperties });
    };

    const removeProperty = (index: number) => {
        const newProperties = [...(formData.properties || [])];
        newProperties.splice(index, 1);
        setFormData({ ...formData, properties: newProperties });
    };

    const handleSave = async () => {
        if (!formData.label) return;

        setLoading(true);
        try {
            if (editingNode) {
                const updated = await apiClient.updateCustomNode(editingNode.id, formData);
                updateStoreCustomNode(editingNode.id, updated);
            } else {
                // Generate a simple type identifier if not present
                const dataToSave = {
                    ...formData,
                    type: `custom-${Math.random().toString(36).substring(2, 9)}`,
                };
                const created = await apiClient.createCustomNode(dataToSave);
                addCustomNode(created);
            }
            onClose();
        } catch (error) {
            console.error('Error saving custom node:', error);
            alert('Failed to save custom node');
        } finally {
            setLoading(false);
        }
    };

    const IconComponent = (LucideIcons as any)[formData.icon_name || 'Box'] || Box;

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0">
                <DialogHeader className="p-6 pb-0">
                    <DialogTitle>{editingNode ? 'Edit Custom Node' : 'Create Custom Node'}</DialogTitle>
                    <DialogDescription>
                        Define your own node with custom properties, inputs, and outputs.
                    </DialogDescription>
                </DialogHeader>

                <ScrollArea className="flex-1 px-6 py-4">
                    <div className="space-y-6">
                        {/* Basic Info */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="label">Node Label</Label>
                                <Input
                                    id="label"
                                    value={formData.label}
                                    onChange={e => setFormData({ ...formData, label: e.target.value })}
                                    placeholder="e.g. My Custom Database"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="category">Category</Label>
                                <Select
                                    value={formData.category}
                                    onValueChange={v => setFormData({ ...formData, category: v })}
                                >
                                    <SelectTrigger id="category">
                                        <SelectValue placeholder="Select Category" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {CATEGORY_OPTIONS.map(cat => (
                                            <SelectItem key={cat.value} value={cat.value}>
                                                {cat.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="description">Description</Label>
                            <Textarea
                                id="description"
                                value={formData.description}
                                onChange={e => setFormData({ ...formData, description: e.target.value })}
                                placeholder="Briefly describe what this node does..."
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="inputs">Inputs</Label>
                                <Input
                                    id="inputs"
                                    type="number"
                                    min={0}
                                    max={10}
                                    value={formData.inputs}
                                    onChange={e => setFormData({ ...formData, inputs: parseInt(e.target.value) })}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="outputs">Outputs</Label>
                                <Input
                                    id="outputs"
                                    type="number"
                                    min={0}
                                    max={10}
                                    value={formData.outputs}
                                    onChange={e => setFormData({ ...formData, outputs: parseInt(e.target.value) })}
                                />
                            </div>
                        </div>

                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <Label>Icon Selection</Label>
                                <div className="flex items-center gap-2 px-2 py-1 rounded bg-accent/50 text-xs text-muted-foreground border border-border/50">
                                    <span>Preview:</span>
                                    <IconComponent size={14} className="text-primary" />
                                    <span className="font-medium text-foreground">{formData.icon_name}</span>
                                </div>
                            </div>
                            <ScrollArea className="h-[200px] w-full rounded-md border border-border/50 bg-card/30 p-4">
                                <div className="grid grid-cols-8 gap-2">
                                    {ICON_OPTIONS.map(iconName => {
                                        const Icon = (LucideIcons as any)[iconName] || Box;
                                        const isSelected = formData.icon_name === iconName;
                                        return (
                                            <button
                                                key={iconName}
                                                type="button"
                                                onClick={() => setFormData({ ...formData, icon_name: iconName })}
                                                className={cn(
                                                    "h-10 w-10 flex items-center justify-center rounded-lg border transition-all",
                                                    isSelected
                                                        ? "bg-primary border-primary text-primary-foreground shadow-md scale-105 z-10"
                                                        : "bg-background border-border hover:bg-accent hover:border-accent text-foreground/70"
                                                )}
                                                title={iconName}
                                            >
                                                <Icon size={18} />
                                            </button>
                                        );
                                    })}
                                </div>
                            </ScrollArea>
                        </div>

                        {/* Properties */}
                        <div className="space-y-4 pt-4 border-t border-border">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 text-sm font-medium">
                                    <Settings size={16} className="text-primary" />
                                    <span>Custom Properties</span>
                                </div>
                                <Button variant="outline" size="sm" onClick={addProperty}>
                                    <Plus size={14} className="mr-1" /> Add Property
                                </Button>
                            </div>

                            <div className="space-y-4">
                                {formData.properties?.map((prop: any, idx: number) => (
                                    <div key={idx} className="p-4 rounded-lg bg-accent/20 border border-border/50 space-y-3 relative group">
                                        <button
                                            onClick={() => removeProperty(idx)}
                                            className="absolute top-2 right-2 p-1 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                                        >
                                            <Trash2 size={14} />
                                        </button>

                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="space-y-1">
                                                <Label className="text-[10px] uppercase text-muted-foreground">Key (ID)</Label>
                                                <Input
                                                    size={1}
                                                    className="h-8 text-xs"
                                                    value={prop.key}
                                                    onChange={e => updateProperty(idx, { key: e.target.value })}
                                                    placeholder="storage_size"
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <Label className="text-[10px] uppercase text-muted-foreground">Label (Display Name)</Label>
                                                <Input
                                                    className="h-8 text-xs"
                                                    value={prop.label}
                                                    onChange={e => updateProperty(idx, { label: e.target.value })}
                                                    placeholder="Storage Size (GB)"
                                                />
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="space-y-1">
                                                <Label className="text-[10px] uppercase text-muted-foreground">Type</Label>
                                                <Select
                                                    value={prop.type}
                                                    onValueChange={v => updateProperty(idx, { type: v })}
                                                >
                                                    <SelectTrigger className="h-8 text-xs">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="text"><div className="flex items-center gap-2"><Type size={12} /> Text</div></SelectItem>
                                                        <SelectItem value="number"><div className="flex items-center gap-2"><Hash size={12} /> Number</div></SelectItem>
                                                        <SelectItem value="boolean"><div className="flex items-center gap-2"><CheckSquare size={12} /> Boolean</div></SelectItem>
                                                        <SelectItem value="select"><div className="flex items-center gap-2"><List size={12} /> Select</div></SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div className="space-y-1">
                                                <Label className="text-[10px] uppercase text-muted-foreground">Default Value</Label>
                                                <Input
                                                    className="h-8 text-xs"
                                                    value={prop.defaultValue}
                                                    onChange={e => updateProperty(idx, { defaultValue: e.target.value })}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                ))}

                                {(!formData.properties || formData.properties.length === 0) && (
                                    <div className="py-8 text-center border-2 border-dashed border-border rounded-xl">
                                        <p className="text-xs text-muted-foreground">No custom properties defined yet.</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </ScrollArea>

                <DialogFooter className="p-6 border-t border-border mt-auto">
                    <Button variant="ghost" onClick={onClose} disabled={loading}>
                        Cancel
                    </Button>
                    <Button onClick={handleSave} disabled={loading || !formData.label}>
                        {loading && <span className="animate-spin mr-2">◌</span>}
                        <Save size={16} className="mr-2" />
                        {editingNode ? 'Update Node' : 'Create Node'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
