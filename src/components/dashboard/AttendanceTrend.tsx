'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface AttendanceTrendProps {
  data: { date: string; count: number }[];
}

const BAR_COLOR = '#818CF8';

export default function AttendanceTrend({ data }: AttendanceTrendProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        <p className="text-sm">---</p>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#94a3b8' }} stroke="#475569" />
        <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} stroke="#475569" allowDecimals={false} />
        <Tooltip
          contentStyle={{ backgroundColor: '#0F172A', border: '1px solid #334155', borderRadius: '8px' }}
          labelStyle={{ color: '#e2e8f0' }}
        />
        <Bar dataKey="count" fill={BAR_COLOR} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
