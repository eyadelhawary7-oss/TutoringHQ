'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import { useTranslations, useLocale } from 'next-intl';
import { toAr } from '@/lib/number-utils';

interface PaymentDonutProps {
  paid: number;
  unpaid: number;
  pending?: number;
}

export default function PaymentDonut({ paid, unpaid, pending = 0 }: PaymentDonutProps) {
  const t = useTranslations('dashboard');
  const locale = useLocale();

  const data = [
    { name: t('paid'), value: paid, key: 'paid', fill: 'url(#paidGradient)' },
    { name: t('unpaid'), value: unpaid, key: 'unpaid', fill: 'url(#unpaidGradient)' },
    { name: t('pending'), value: pending, key: 'pending', fill: 'url(#pendingGradient)' },
  ].filter(d => d.value > 0);

  const total = paid + unpaid + pending;
  const paidPct = total > 0 ? Math.round((paid / total) * 100) : 0;
  const pctDisplay = locale === 'ar' ? `%${toAr(paidPct)}` : `${paidPct}%`;

  if (paid === 0 && unpaid === 0 && pending === 0) {
    return (
      <div className="flex items-center justify-center h-[250px] text-[var(--text-secondary)]">
        <p className="text-sm">---</p>
      </div>
    );
  }

  return (
    <div className="relative w-full" style={{ height: 250 }}>
      <ResponsiveContainer width="100%" height={250}>
        <PieChart>
          <defs>
            <linearGradient id="paidGradient" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#34d399" />
              <stop offset="100%" stopColor="#10b981" />
            </linearGradient>
            <linearGradient id="unpaidGradient" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#f87171" />
              <stop offset="100%" stopColor="#ef4444" />
            </linearGradient>
            <linearGradient id="pendingGradient" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#fcd34d" />
              <stop offset="100%" stopColor="#eab308" />
            </linearGradient>
            <filter id="donutShadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="2" stdDeviation="4" floodOpacity="0.2" />
            </filter>
          </defs>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={55}
            outerRadius={90}
            paddingAngle={4}
            dataKey="value"
            label={false}
            isAnimationActive
            animationBegin={0}
            animationDuration={600}
          >
            {data.map((entry) => (
              <Cell key={entry.key} fill={entry.fill} filter="url(#donutShadow)" />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{ backgroundColor: 'var(--chart-tooltip-bg)', border: '1px solid var(--chart-tooltip-border)', borderRadius: '10px' }}
            labelStyle={{ color: 'var(--chart-tooltip-text)' }}
          />
          <Legend wrapperStyle={{ color: 'var(--text-primary)' }} />
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <span className="text-3xl font-bold text-[var(--text-primary)]" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>
          {pctDisplay}
        </span>
      </div>
    </div>
  );
}
