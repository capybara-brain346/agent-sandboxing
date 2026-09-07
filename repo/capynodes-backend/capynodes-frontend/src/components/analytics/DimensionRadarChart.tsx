'use client';

import { useMemo } from 'react';
import {
    RadarChart,
    PolarGrid,
    PolarAngleAxis,
    PolarRadiusAxis,
    Radar,
    ResponsiveContainer,
    Tooltip,
} from 'recharts';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface DimensionRadarChartProps {
    data: {
        [key: string]: {
            avg_score: number;
        };
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

const DIMENSION_ORDER = [
    'scalability',
    'performance',
    'cost',
    'reliability',
    'completeness',
    'security',
];

export function DimensionRadarChart({ data }: DimensionRadarChartProps) {
    const chartData = useMemo(() => {
        return DIMENSION_ORDER.map((key) => ({
            dimension: DIMENSION_LABELS[key] || key,
            key,
            score: data[key]?.avg_score || 0,
            fullMark: 100,
        }));
    }, [data]);

    const { strengths, weaknesses } = useMemo(() => {
        const sorted = [...chartData].sort((a, b) => b.score - a.score);
        return {
            strengths: sorted.filter((d) => d.score >= 60).slice(0, 2),
            weaknesses: sorted.filter((d) => d.score < 50).slice(-2).reverse(),
        };
    }, [chartData]);

    const hasData = chartData.some((d) => d.score > 0);

    if (!hasData) {
        return (
            <Card className="p-6">
                <h2 className="text-heading mb-4">Evaluation Dimensions</h2>
                <div className="flex items-center justify-center h-[250px] text-muted-foreground">
                    No dimension data yet. Complete evaluations to see your skill profile.
                </div>
            </Card>
        );
    }

    return (
        <Card className="p-6">
            <h2 className="text-heading mb-4">Evaluation Dimensions</h2>
            <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={chartData} cx="50%" cy="50%" outerRadius="75%">
                        <PolarGrid className="stroke-muted" />
                        <PolarAngleAxis
                            dataKey="dimension"
                            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                        />
                        <PolarRadiusAxis
                            angle={30}
                            domain={[0, 100]}
                            tick={{ fontSize: 10 }}
                            tickCount={5}
                            className="fill-muted-foreground"
                        />
                        <Radar
                            name="Score"
                            dataKey="score"
                            stroke="hsl(var(--primary))"
                            fill="hsl(var(--primary))"
                            fillOpacity={0.3}
                            strokeWidth={2}
                        />
                        <Tooltip
                            content={({ active, payload }) => {
                                if (active && payload && payload.length) {
                                    const d = payload[0].payload;
                                    return (
                                        <div className="bg-background border rounded-lg shadow-lg p-3">
                                            <p className="font-semibold">{d.dimension}</p>
                                            <p className="text-primary">Avg Score: {d.score.toFixed(1)}</p>
                                        </div>
                                    );
                                }
                                return null;
                            }}
                        />
                    </RadarChart>
                </ResponsiveContainer>
            </div>
            <div className="mt-4 space-y-2">
                {strengths.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-green-600">Strengths:</span>
                        {strengths.map((s) => (
                            <Badge key={s.key} variant="outline" className="bg-green-50 text-green-700 border-green-200">
                                {s.dimension} ({s.score.toFixed(0)})
                            </Badge>
                        ))}
                    </div>
                )}
                {weaknesses.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-orange-600">Focus areas:</span>
                        {weaknesses.map((w) => (
                            <Badge key={w.key} variant="outline" className="bg-orange-50 text-orange-700 border-orange-200">
                                {w.dimension} ({w.score.toFixed(0)})
                            </Badge>
                        ))}
                    </div>
                )}
            </div>
        </Card>
    );
}
