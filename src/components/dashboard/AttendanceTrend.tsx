'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface AttendanceTrendProps {
  data: { date: string; count: number }[];
}

export default function AttendanceTrend({ data }: AttendanceTrendProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[250px] text-slate-400">
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
          stroke="rgba(148, 163, 184, 0.2)"
          vertical={false}
        />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 12, fill: '#94a3b8' }}
          stroke="rgba(71, 85, 105, 0.5)"
        />
        <YAxis
          tick={{ fontSize: 12, fill: '#94a3b8' }}
          stroke="rgba(71, 85, 105, 0.5)"
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={{ backgroundColor: '#0F172A', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px' }}
          labelStyle={{ color: '#e2e8f0' }}
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
