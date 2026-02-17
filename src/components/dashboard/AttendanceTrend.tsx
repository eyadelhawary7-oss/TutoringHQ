'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface AttendanceTrendProps {
  data: { date: string; count: number }[];
}

export default function AttendanceTrend({ data }: AttendanceTrendProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[250px] text-[var(--text-secondary)]">
        <p className="text-sm">---</p>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={250}>
      <BarChart data={data}>
        <defs>
          <linearGradient id="barGradient" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="#6366f1" />
            <stop offset="100%" stopColor="#818cf8" />
          </linearGradient>
        </defs>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--border-color)"
          vertical={false}
        />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 12, fill: 'var(--text-secondary)' }}
          stroke="var(--border-color)"
        />
        <YAxis
          tick={{ fontSize: 12, fill: 'var(--text-secondary)' }}
          stroke="var(--border-color)"
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={{ backgroundColor: 'var(--chart-tooltip-bg)', border: '1px solid var(--chart-tooltip-border)', borderRadius: '10px' }}
          labelStyle={{ color: 'var(--chart-tooltip-text)' }}
        />
        <Bar
          dataKey="count"
          fill="url(#barGradient)"
          radius={[4, 4, 0, 0]}
          isAnimationActive
          animationDuration={500}
          animationBegin={0}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
