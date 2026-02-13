'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import { useTranslations } from 'next-intl';

interface PaymentDonutProps {
  paid: number;
  unpaid: number;
  pending?: number;
}

const COLORS = ['#10b981', '#eab308', '#ef4444'];

export default function PaymentDonut({ paid, unpaid, pending = 0 }: PaymentDonutProps) {
  const t = useTranslations('dashboard');

  const data = [
    { name: t('paid'), value: paid },
    { name: t('pending'), value: pending },
    { name: t('unpaid'), value: unpaid },
  ].filter(d => d.value > 0);

  if (paid === 0 && unpaid === 0 && pending === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400 dark:text-gray-500">
        <p className="text-sm">---</p>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={60}
          outerRadius={100}
          paddingAngle={5}
          dataKey="value"
          label={({ name, percent }: any) => `${name ?? ''} ${((percent ?? 0) * 100).toFixed(0)}%`}
        >
          {data.map((_, index) => (
            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}
