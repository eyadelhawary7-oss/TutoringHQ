'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import { useTranslations, useLocale } from 'next-intl';
import { toAr } from '@/lib/number-utils';

interface PaymentDonutProps {
  paid: number;
  unpaid: number;
  pending?: number;
}

const COLOR_MAP: Record<string, string> = {
  paid: '#10b981',
  pending: '#eab308',
  unpaid: '#ef4444',
};

export default function PaymentDonut({ paid, unpaid, pending = 0 }: PaymentDonutProps) {
  const t = useTranslations('dashboard');
  const locale = useLocale();

  const data = [
    { name: t('paid'), value: paid, key: 'paid' },
    { name: t('unpaid'), value: unpaid, key: 'unpaid' },
    { name: t('pending'), value: pending, key: 'pending' },
  ].filter(d => d.value > 0);

  const total = paid + unpaid + pending;
  const paidPct = total > 0 ? Math.round((paid / total) * 100) : 0;

  if (paid === 0 && unpaid === 0 && pending === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        <p className="text-sm">---</p>
      </div>
    );
  }

  return (
    <div className="relative w-full" style={{ height: 280 }}>
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
            label={false}
          >
            {data.map((entry) => (
              <Cell key={entry.key} fill={COLOR_MAP[entry.key]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{ backgroundColor: '#0F172A', border: '1px solid #334155', borderRadius: '8px' }}
            labelStyle={{ color: '#e2e8f0' }}
          />
          <Legend wrapperStyle={{ color: '#e2e8f0' }} />
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <span className="text-4xl font-bold text-slate-100" style={{ fontFamily: 'var(--font-jetbrains-mono), monospace' }}>
          %{locale === 'ar' ? toAr(paidPct) : paidPct}
        </span>
      </div>
    </div>
  );
}
