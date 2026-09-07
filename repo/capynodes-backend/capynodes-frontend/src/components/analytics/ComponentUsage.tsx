'use client';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Boxes, TrendingUp } from 'lucide-react';

interface ComponentUsageProps {
    data: {
        most_used?: Array<{
            name: string;
            count: number;
            percentage: number;
        }>;
        total_components?: number;
        unique_components?: number;
    };
}

export function ComponentUsage({ data }: ComponentUsageProps) {
    const mostUsed = data.most_used || [];
    const totalComponents = data.total_components || 0;
    const uniqueComponents = data.unique_components || 0;

    if (mostUsed.length === 0) {
        return (
            <Card className="p-6">
                <div className="flex items-center gap-2 mb-4">
                    <Boxes className="w-5 h-5 text-primary" />
                    <h2 className="text-heading">Component Usage</h2>
                </div>
                <p className="text-muted-foreground text-center py-4">
                    No component data yet. Complete some designs to see your usage patterns.
                </p>
            </Card>
        );
    }

    return (
        <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <Boxes className="w-5 h-5 text-primary" />
                    <h2 className="text-heading">Component Usage</h2>
                </div>
                <div className="text-sm text-muted-foreground">
                    {uniqueComponents} unique / {totalComponents} total
                </div>
            </div>

            <div className="space-y-2">
                {mostUsed.slice(0, 8).map((component, idx) => (
                    <div
                        key={idx}
                        className="flex items-center justify-between p-2 rounded hover:bg-muted/50 transition-colors"
                    >
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                            <span className="text-sm font-medium text-muted-foreground w-6">
                                #{idx + 1}
                            </span>
                            <span className="text-sm font-medium truncate">
                                {component.name}
                            </span>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-primary rounded-full transition-all"
                                    style={{ width: `${Math.min(100, component.percentage)}%` }}
                                />
                            </div>
                            <Badge variant="outline" className="min-w-[60px] justify-center">
                                {component.count}x
                            </Badge>
                        </div>
                    </div>
                ))}
            </div>

            {mostUsed.length > 8 && (
                <p className="text-sm text-muted-foreground text-center mt-3">
                    + {mostUsed.length - 8} more components
                </p>
            )}
        </Card>
    );
}
