'use client';

import { useMemo } from 'react';
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from 'recharts';
import { Card } from '@/components/ui/card';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface ScoreTrendChartProps {
    data: Array<{
        week: string;
        avg_score: number;
        submissions: number;
    }>;
}

export function ScoreTrendChart({ data }: ScoreTrendChartProps) {
    const chartData = useMemo(() => {
        return data.map((item) => ({
            ...item,
            // Format week for display (e.g., "Jan 13")
            displayWeek: new Date(item.week).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
            }),
        }));
    }, [data]);

    const trend = useMemo(() => {
        if (chartData.length < 2) return 'neutral';
        const firstHalf = chartData.slice(0, Math.floor(chartData.length / 2));
        const secondHalf = chartData.slice(Math.floor(chartData.length / 2));

        const firstAvg = firstHalf.reduce((sum, d) => sum + d.avg_score, 0) / firstHalf.length;
        const secondAvg = secondHalf.reduce((sum, d) => sum + d.avg_score, 0) / secondHalf.length;

        if (secondAvg > firstAvg + 3) return 'up';
        if (secondAvg < firstAvg - 3) return 'down';
        return 'neutral';
    }, [chartData]);

    const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;
    const trendColor = trend === 'up' ? 'text-green-500' : trend === 'down' ? 'text-red-500' : 'text-muted-foreground';
    const trendText = trend === 'up' ? 'Improving' : trend === 'down' ? 'Declining' : 'Stable';

    if (!data || data.length === 0) {
        return (
            <Card className="p-6">
                <h2 className="text-heading mb-4">Score Trend</h2>
                <div className="flex items-center justify-center h-[200px] text-muted-foreground">
                    Not enough data to show trends. Keep practicing!
                </div>
            </Card>
        );
    }

    return (
        <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-heading">Score Trend</h2>
                <div className={`flex items-center gap-1 text-sm ${trendColor}`}>
                    <TrendIcon className="w-4 h-4" />
                    <span>{trendText}</span>
                </div>
            </div>
            <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                        data={chartData}
                        margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                    >
                        <defs>
                            <linearGradient id="scoreGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis
                            dataKey="displayWeek"
                            tick={{ fontSize: 12 }}
                            tickLine={false}
                            axisLine={false}
                            className="fill-muted-foreground"
                        />
                        <YAxis
                            domain={[0, 100]}
                            tick={{ fontSize: 12 }}
                            tickLine={false}
                            axisLine={false}
                            className="fill-muted-foreground"
                        />
                        <Tooltip
                            content={({ active, payload, label }) => {
                                if (active && payload && payload.length) {
                                    const data = payload[0].payload;
                                    return (
                                        <div className="bg-background border rounded-lg shadow-lg p-3">
                                            <p className="font-semibold">{label}</p>
                                            <p className="text-primary">Avg Score: {data.avg_score.toFixed(1)}</p>
                                            <p className="text-muted-foreground text-sm">
                                                {data.submissions} submission{data.submissions !== 1 ? 's' : ''}
                                            </p>
                                        </div>
                                    );
                                }
                                return null;
                            }}
                        />
                        <Area
                            type="monotone"
                            dataKey="avg_score"
                            stroke="hsl(var(--primary))"
                            strokeWidth={2}
                            fill="url(#scoreGradient)"
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
            <p className="text-sm text-muted-foreground mt-2 text-center">
                Weekly average scores (last {data.length} weeks)
            </p>
        </Card>
    );
}
