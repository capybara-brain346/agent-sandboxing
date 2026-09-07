'use client';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Lightbulb, AlertTriangle, Target, Sparkles } from 'lucide-react';

interface ImprovementSummaryProps {
    data: {
        recurring_issues?: Array<{ theme: string; count: number }>;
        recurring_strengths?: Array<{ theme: string; count: number }>;
        suggested_focus?: {
            dimension: string;
            avg_score: number;
            reason: string;
        } | null;
    };
}

const DIMENSION_LABELS: Record<string, string> = {
    scalability: 'Scalability',
    performance: 'Performance',
    cost: 'Cost',
    reliability: 'Reliability',
    completeness: 'Completeness',
    security: 'Security',
};

export function ImprovementSummary({ data }: ImprovementSummaryProps) {
    const issues = data.recurring_issues || [];
    const strengths = data.recurring_strengths || [];
    const focus = data.suggested_focus;

    const hasContent = issues.length > 0 || strengths.length > 0 || focus;

    if (!hasContent) {
        return (
            <Card className="p-6">
                <div className="flex items-center gap-2 mb-4">
                    <Lightbulb className="w-5 h-5 text-primary" />
                    <h2 className="text-heading">Insights & Recommendations</h2>
                </div>
                <p className="text-muted-foreground text-center py-4">
                    Complete more evaluations to get personalized improvement suggestions.
                </p>
            </Card>
        );
    }

    return (
        <Card className="p-6">
            <div className="flex items-center gap-2 mb-4">
                <Lightbulb className="w-5 h-5 text-primary" />
                <h2 className="text-heading">Insights & Recommendations</h2>
            </div>

            <div className="space-y-4">
                {/* Suggested Focus Area */}
                {focus && (
                    <div className="p-4 bg-primary/5 border border-primary/20 rounded-lg">
                        <div className="flex items-start gap-3">
                            <Target className="w-5 h-5 text-primary mt-0.5" />
                            <div>
                                <p className="font-semibold text-primary">Suggested Focus Area</p>
                                <p className="text-sm mt-1">
                                    Improve your <span className="font-medium">{DIMENSION_LABELS[focus.dimension] || focus.dimension}</span> skills.
                                </p>
                                <p className="text-sm text-muted-foreground mt-1">{focus.reason}</p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Recurring Strengths */}
                {strengths.length > 0 && (
                    <div>
                        <div className="flex items-center gap-2 mb-2">
                            <Sparkles className="w-4 h-4 text-green-600" />
                            <span className="text-sm font-medium text-green-700">Your Strengths</span>
                        </div>
                        <div className="space-y-1.5">
                            {strengths.slice(0, 3).map((item, idx) => (
                                <div
                                    key={idx}
                                    className="flex items-center justify-between p-2 bg-green-50 border border-green-100 rounded"
                                >
                                    <span className="text-sm text-green-800 truncate max-w-[80%]">
                                        {item.theme}
                                    </span>
                                    <Badge variant="outline" className="bg-green-100 text-green-700 border-green-200">
                                        {item.count}x
                                    </Badge>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Recurring Issues */}
                {issues.length > 0 && (
                    <div>
                        <div className="flex items-center gap-2 mb-2">
                            <AlertTriangle className="w-4 h-4 text-orange-600" />
                            <span className="text-sm font-medium text-orange-700">Areas for Improvement</span>
                        </div>
                        <div className="space-y-1.5">
                            {issues.slice(0, 3).map((item, idx) => (
                                <div
                                    key={idx}
                                    className="flex items-center justify-between p-2 bg-orange-50 border border-orange-100 rounded"
                                >
                                    <span className="text-sm text-orange-800 truncate max-w-[80%]">
                                        {item.theme}
                                    </span>
                                    <Badge variant="outline" className="bg-orange-100 text-orange-700 border-orange-200">
                                        {item.count}x
                                    </Badge>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </Card>
    );
}
