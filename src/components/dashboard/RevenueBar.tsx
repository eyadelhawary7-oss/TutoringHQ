'use client';

import { useTranslations, useLocale } from 'next-intl';
import { toAr } from '@/lib/number-utils';

interface RevenueBarProps {
  data: { method: string; amount: number }[];
}

const METHODS: { key: string; method: string; gradient: string; color: string }[] = [
  { key: 'methodCash', method: 'cash', gradient: 'linear-gradient(90deg, #22c55e 0%, #16a34a 100%)', color: '#22c55e' },
  { key: 'methodInstapay', method: 'instapay', gradient: 'linear-gradient(90deg, #6366f1 0%, #4f46e5 100%)', color: '#6366f1' },
  { key: 'methodVodafone', method: 'vodacash', gradient: 'linear-gradient(90deg, #ef4444 0%, #dc2626 100%)', color: '#ef4444' },
  { key: 'methodFawry', method: 'fawry', gradient: 'linear-gradient(90deg, #f59e0b 0%, #d97706 100%)', color: '#f59e0b' },
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
        <p className="text-center text-[var(--text-secondary)] text-sm mb-4">
          {t('noPaymentData')}
        </p>
        <div className="space-y-3">
          {METHODS.map(({ key, method, gradient }) => (
            <div key={method} className="flex items-center gap-3">
              <span className="text-sm text-[var(--text-primary)] w-28 flex-shrink-0">
                {t(key as 'methodCash')}
              </span>
              <div className="flex-1 h-6 rounded-lg overflow-hidden bg-[var(--border-color)]/50">
                <div
                  className="h-full rounded-lg transition-all duration-500"
                  style={{ width: '0%', background: gradient }}
                />
              </div>
              <span className="text-sm font-mono text-[var(--text-secondary)] w-10 text-end" style={{ fontFamily: 'var(--font-jetbrains-mono), monospace' }}>
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
      {METHODS.map(({ key, method, gradient }) => {
        const amount = methodMap.get(method) || methodMap.get('vodacash') || 0;
        const pct = total > 0 ? Math.round((amount / total) * 100) : 0;
        return (
          <div key={method} className="flex items-center gap-3">
            <span className="text-sm text-[var(--text-primary)] w-28 flex-shrink-0">
              {t(key as 'methodCash')}
            </span>
            <div className="flex-1 h-6 rounded-lg overflow-hidden bg-[var(--border-color)]/50">
              <div
                className="h-full rounded-lg transition-all duration-500"
                style={{ width: `${pct}%`, background: gradient }}
              />
            </div>
            <span className="text-sm font-mono text-[var(--text-secondary)] w-10 text-end" style={{ fontFamily: 'var(--font-jetbrains-mono), monospace' }}>
              {locale === 'ar' ? toAr(pct) : pct}%
            </span>
          </div>
        );
      })}
    </div>
  );
}
