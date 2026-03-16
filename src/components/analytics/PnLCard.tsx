'use client';

import { useTranslations } from 'next-intl';
import { Download } from 'lucide-react';

const AR_MONTHS: Record<string, string> = {
  '01': 'يناير', '02': 'فبراير', '03': 'مارس', '04': 'أبريل', '05': 'مايو', '06': 'يونيو',
  '07': 'يوليو', '08': 'أغسطس', '09': 'سبتمبر', '10': 'أكتوبر', '11': 'نوفمبر', '12': 'ديسمبر',
};

export interface PnLCardProps {
  incomeByMonth: Record<string, number>;
  expensesByMonth: Record<string, { rent: number; salaries: number; utilities: number; other: number }>;
  pnlMonths: string[];
  locale?: string;
}

function formatMonth(key: string, locale: string): string {
  const [y, m] = key.split('-');
  if (locale === 'ar') return `${AR_MONTHS[m ?? '01'] ?? m} ${y}`;
  const d = new Date(parseInt(y ?? '0', 10), parseInt(m ?? '1', 10) - 1, 1);
  return d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
}

export default function PnLCard({
  incomeByMonth,
  expensesByMonth,
  pnlMonths,
  locale = 'ar',
}: PnLCardProps) {
  const t = useTranslations('analytics');

  const totalIncome = pnlMonths.reduce((s, m) => s + (incomeByMonth[m] ?? 0), 0);
  const totalExpenses = pnlMonths.reduce((s, m) => {
    const e = expensesByMonth[m];
    if (!e) return s;
    return s + (e.rent + e.salaries + e.utilities + e.other);
  }, 0);
  const net = totalIncome - totalExpenses;

  const exportCsv = () => {
    const rows: string[][] = [
      [t('month'), t('income'), t('rent'), t('salaries'), t('utilities'), t('other'), t('expenses'), t('net')],
    ];
    for (const m of pnlMonths) {
      const inc = incomeByMonth[m] ?? 0;
      const e = expensesByMonth[m];
      const rent = e?.rent ?? 0;
      const salaries = e?.salaries ?? 0;
      const utilities = e?.utilities ?? 0;
      const other = e?.other ?? 0;
      const exp = rent + salaries + utilities + other;
      rows.push([
        formatMonth(m, locale),
        inc.toLocaleString('en-US'),
        rent.toLocaleString('en-US'),
        salaries.toLocaleString('en-US'),
        utilities.toLocaleString('en-US'),
        other.toLocaleString('en-US'),
        exp.toLocaleString('en-US'),
        (inc - exp).toLocaleString('en-US'),
      ]);
    }
    rows.push([
      t('total'),
      totalIncome.toLocaleString('en-US'),
      '',
      '',
      '',
      '',
      totalExpenses.toLocaleString('en-US'),
      net.toLocaleString('en-US'),
    ]);
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pnl-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b bg-muted/30">
        <h3 className="font-semibold">{t('pnl')}</h3>
        <button
          type="button"
          onClick={exportCsv}
          className="inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium hover:bg-muted"
        >
          <Download className="h-4 w-4" />
          {t('exportCsv')}
        </button>
      </div>
      <div className="p-4 space-y-4">
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-xs text-muted-foreground">{t('income')}</p>
            <p className="text-lg font-semibold text-green-600 dark:text-green-400">
              {totalIncome.toLocaleString('en-US')} ج.م
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('expenses')}</p>
            <p className="text-lg font-semibold text-red-600 dark:text-red-400">
              {totalExpenses.toLocaleString('en-US')} ج.م
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('net')}</p>
            <p className={`text-lg font-semibold ${net >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
              {net.toLocaleString('en-US')} ج.م
            </p>
          </div>
        </div>
        {pnlMonths.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-right py-2 px-2 font-medium">{t('month')}</th>
                  <th className="text-right py-2 px-2 font-medium">{t('income')}</th>
                  <th className="text-right py-2 px-2 font-medium">{t('expenses')}</th>
                  <th className="text-right py-2 px-2 font-medium">{t('net')}</th>
                </tr>
              </thead>
              <tbody>
                {pnlMonths.map((m) => {
                  const inc = incomeByMonth[m] ?? 0;
                  const e = expensesByMonth[m];
                  const exp = e ? e.rent + e.salaries + e.utilities + e.other : 0;
                  return (
                    <tr key={m} className="border-b">
                      <td className="py-2 px-2">{formatMonth(m, locale)}</td>
                      <td className="py-2 px-2 font-mono">{inc.toLocaleString('en-US')}</td>
                      <td className="py-2 px-2 font-mono">{exp.toLocaleString('en-US')}</td>
                      <td className={`py-2 px-2 font-mono ${inc - exp >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {(inc - exp).toLocaleString('en-US')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
