'use client';

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface AttendanceAreaChartProps {
  data: { date: string; count: number }[];
}

export default function AttendanceAreaChart({ data = [] }: AttendanceAreaChartProps) {
  if (!data?.length) {
    return (
        <div className="flex items-center justify-center h-[200px] text-muted-foreground">
        <p className="text-sm">---</p>
      </div>
    );
  }

  const chartData = data.map(d => ({ ...d, scans: d.count }));

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={chartData}>
        <defs>
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(174, 72%, 30%)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="hsl(174, 72%, 30%)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
        <YAxis tick={{ fontSize: 11 }} className="fill-muted-foreground" allowDecimals={false} />
        <Tooltip />
        <Area type="monotone" dataKey="scans" stroke="hsl(174, 72%, 30%)" fill="url(#areaGrad)" strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
