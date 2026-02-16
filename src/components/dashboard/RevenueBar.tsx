'use client';

import { useTranslations, useLocale } from 'next-intl';
import { toAr } from '@/lib/number-utils';

interface RevenueBarProps {
  data: { method: string; amount: number }[];
}

const METHODS: { key: string; method: string; color: string }[] = [
  { key: 'methodCash', method: 'cash', color: '#22c55e' },
  { key: 'methodInstapay', method: 'instapay', color: '#6366f1' },
  { key: 'methodVodafone', method: 'vodacash', color: '#ef4444' },
  { key: 'methodFawry', method: 'fawry', color: '#f59e0b' },
];

export default function RevenueBar({ data }: RevenueBarProps) {
  const t = useTranslations('dashboard');
  const locale = useLocale();

  const total = data.reduce((sum, d) => sum + (d.amount || 0), 0);
  const rawMap = new Map(data.map(d => [d.method, d.amount]));
  const methodMap = new Map<string, number>([
    ['cash', rawMap.get('cash') || 0],
    ['instapay', rawMap.get('instapay') || 0],
    ['vodacash', (rawMap.get('vodacash') || 0) + (rawMap.get('vodafone_cash') || 0)],
    ['fawry', rawMap.get('fawry') || 0],
  ]);

  if (data.length === 0 || total === 0) {
    return (
      <div className="space-y-4">
        <p className="text-center text-slate-400 text-sm mb-4">
          {t('noPaymentData')}
        </p>
        <div className="space-y-3">
          {METHODS.map(({ key, method, color }) => (
            <div key={method} className="flex items-center gap-3">
              <span className="text-sm text-slate-300 w-28 flex-shrink-0">
                {t(key as 'methodCash')}
              </span>
              <div className="flex-1 h-6 bg-slate-700/50 rounded overflow-hidden">
                <div
                  className="h-full rounded transition-all"
                  style={{ width: '0%', backgroundColor: color }}
                />
              </div>
              <span className="text-sm font-mono text-slate-400 w-10 text-end" style={{ fontFamily: 'var(--font-jetbrains-mono), monospace' }}>
                {locale === 'ar' ? toAr(0) : 0}%
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {METHODS.map(({ key, method, color }) => {
        const amount = methodMap.get(method) || methodMap.get('vodacash') || 0;
        const pct = total > 0 ? Math.round((amount / total) * 100) : 0;
        return (
          <div key={method} className="flex items-center gap-3">
            <span className="text-sm text-slate-300 w-28 flex-shrink-0">
              {t(key as 'methodCash')}
            </span>
            <div className="flex-1 h-6 bg-slate-700/50 rounded overflow-hidden">
              <div
                className="h-full rounded transition-all"
                style={{ width: `${pct}%`, backgroundColor: color }}
              />
            </div>
            <span className="text-sm font-mono text-slate-400 w-10 text-end" style={{ fontFamily: 'var(--font-jetbrains-mono), monospace' }}>
              {locale === 'ar' ? toAr(pct) : pct}%
            </span>
          </div>
        );
      })}
    </div>
  );
}
