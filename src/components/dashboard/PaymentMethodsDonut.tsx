'use client';

import { useTranslations, useLocale } from 'next-intl';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { formatPercent } from '@/lib/formatNumber';

interface PaymentMethodsDonutProps {
  data: { method: string; amount: number }[];
}

const METHOD_COLORS: Record<string, string> = {
  cash: '#16A34A',
  instapay: '#0D9488',
  vodafone_cash: '#DC2626',
  vodacash: '#DC2626',
  orange: '#F59E0B',
  orange_cash: '#F59E0B',
  fawry: '#7C3AED',
  bank_transfer: '#1E293B',
  bank: '#1E293B',
  other: '#64748B',
};

const METHOD_KEYS: Record<string, string> = {
  cash: 'methodCash',
  instapay: 'methodInstapay',
  vodafone_cash: 'methodVodafone',
  vodacash: 'methodVodafone',
  orange: 'methodOrange',
  orange_cash: 'methodOrange',
  fawry: 'methodFawry',
  bank_transfer: 'methodBank',
  bank: 'methodBank',
};

export default function PaymentMethodsDonut({ data = [] }: PaymentMethodsDonutProps) {
  const t = useTranslations('dashboard');
  const locale = useLocale();

  const safeData = data ?? [];
  const total = safeData.reduce((sum, d) => sum + (d.amount || 0), 0);
  const pieData = safeData
    .filter(d => (d.amount || 0) > 0)
    .map(d => {
      const method = (d.method || 'other').toLowerCase();
      const key = METHOD_KEYS[method] || 'methodOther';
      return {
        name: t(key as 'methodCash'),
        value: total > 0 ? Math.round((d.amount / total) * 100) : 0,
        color: METHOD_COLORS[method] || METHOD_COLORS.other,
      };
    })
    .filter(p => p.value > 0);

  if (pieData.length === 0) {
    return (
        <div className="flex items-center justify-center h-[180px] text-[var(--color-text-secondary)]">
        <p className="text-sm">---</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col md:flex-row items-center gap-6">
      <ResponsiveContainer width={220} height={180}>
        <PieChart>
          <Pie
            data={pieData}
            cx="50%"
            cy="50%"
            innerRadius={55}
            outerRadius={80}
            paddingAngle={3}
            dataKey="value"
          >
            {pieData.map((entry, i) => (
              <Cell key={i} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip formatter={(v: number | undefined) => formatPercent(v ?? 0, locale)} />
        </PieChart>
      </ResponsiveContainer>
      <div className="grid grid-cols-2 gap-2 flex-1">
        {pieData.map(({ name, value, color }) => (
          <div key={name} className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full shrink-0" style={{ background: color }} />
            <span className="text-sm text-[var(--color-text-secondary)] flex-1 truncate">{name}</span>
            <span className="text-sm font-bold font-mono">{formatPercent(value, locale)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
