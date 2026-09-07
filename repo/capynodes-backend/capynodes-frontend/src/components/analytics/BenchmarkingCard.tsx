'use client';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Trophy, TrendingUp, Percent } from 'lucide-react';

interface BenchmarkingCardProps {
    data: {
        overall_percentile: number;
        message: string;
        dimension_percentiles: Record<string, number>;
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

function getPercentileBadgeColor(percentile: number): string {
    if (percentile >= 90) return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    if (percentile >= 75) return 'bg-green-100 text-green-800 border-green-200';
    if (percentile >= 50) return 'bg-blue-100 text-blue-800 border-blue-200';
    if (percentile >= 25) return 'bg-orange-100 text-orange-800 border-orange-200';
    return 'bg-gray-100 text-gray-800 border-gray-200';
}

function getPercentileRank(percentile: number): string {
    if (percentile >= 90) return 'Top 10%';
    if (percentile >= 75) return 'Top 25%';
    if (percentile >= 50) return 'Above Average';
    if (percentile >= 25) return 'Average';
    return 'Developing';
}

export function BenchmarkingCard({ data }: BenchmarkingCardProps) {
    const percentile = data.overall_percentile;
    const dimensionPercentiles = Object.entries(data.dimension_percentiles || {})
        .filter(([key]) => DIMENSION_LABELS[key])
        .sort((a, b) => b[1] - a[1]);

    return (
        <Card className="p-6">
            <div className="flex items-center gap-2 mb-4">
                <Trophy className="w-5 h-5 text-primary" />
                <h2 className="text-heading">Your Ranking</h2>
            </div>

            {/* Main percentile display */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <div className="flex items-baseline gap-2">
                        <span className="text-4xl font-bold text-primary">{percentile}%</span>
                        <span className="text-muted-foreground">percentile</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{data.message}</p>
                </div>
                <Badge
                    variant="outline"
                    className={`text-sm px-3 py-1 ${getPercentileBadgeColor(percentile)}`}
                >
                    {getPercentileRank(percentile)}
                </Badge>
            </div>

            {/* Dimension percentiles */}
            {dimensionPercentiles.length > 0 && (
                <div className="space-y-2">
                    <p className="text-sm font-medium text-muted-foreground mb-2">By Dimension</p>
                    <div className="grid grid-cols-2 gap-2">
                        {dimensionPercentiles.map(([key, value]) => (
                            <div
                                key={key}
                                className="flex items-center justify-between p-2 bg-muted/30 rounded"
                            >
                                <span className="text-sm font-medium">
                                    {DIMENSION_LABELS[key]}
                                </span>
                                <div className="flex items-center gap-1">
                                    <Percent className="w-3 h-3 text-muted-foreground" />
                                    <span className={`text-sm font-bold ${value >= 75 ? 'text-green-600' :
                                            value >= 50 ? 'text-blue-600' :
                                                value >= 25 ? 'text-orange-600' :
                                                    'text-gray-600'
                                        }`}>
                                        {value}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </Card>
    );
}
