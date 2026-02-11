'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface RevenueBarProps {
  data: { method: string; amount: number }[];
}

const METHOD_LABELS: Record<string, string> = {
  cash: 'كاش',
  instapay: 'إنستاباي',
  vodafone_cash: 'فودافون',
  orange: 'أورانج',
  fawry: 'فوري',
  bank_transfer: 'تحويل',
};

export default function RevenueBar({ data }: RevenueBarProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400 dark:text-gray-500">
        <p className="text-sm">---</p>
      </div>
    );
  }

  const chartData = data.map(d => ({
    method: METHOD_LABELS[d.method] || d.method,
    amount: d.amount,
  }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis dataKey="method" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} />
        <Tooltip />
        <Bar dataKey="amount" fill="#6366f1" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
