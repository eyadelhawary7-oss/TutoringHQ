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
  const tCommon = useTranslations('common');
  const egp = tCommon('egp');

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
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden card-shadow">
      <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40">
        <h3 className="font-semibold text-slate-800 dark:text-white">{t('pnl')}</h3>
        <button
          type="button"
          onClick={exportCsv}
          className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-200/80 dark:hover:bg-slate-800 transition-colors"
        >
          <Download className="h-4 w-4" />
          {t('exportCsv')}
        </button>
      </div>
      <div className="p-4 space-y-4">
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">{t('income')}</p>
            <p className="text-lg font-semibold text-green-600 dark:text-green-400">
              {totalIncome.toLocaleString('en-US')} {egp}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">{t('expenses')}</p>
            <p className="text-lg font-semibold text-red-600 dark:text-red-400">
              {totalExpenses.toLocaleString('en-US')} {egp}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">{t('net')}</p>
            <p
              className={`text-lg font-semibold ${
                net >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
              }`}
            >
              {net.toLocaleString('en-US')} {egp}
            </p>
          </div>
        </div>
        {pnlMonths.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-[1] bg-slate-50 dark:bg-slate-900/90 backdrop-blur-sm border-b border-slate-200 dark:border-slate-600">
                <tr>
                  <th className="py-2.5 px-3 font-medium text-slate-700 dark:text-slate-200 text-start">{t('month')}</th>
                  <th className="py-2.5 px-3 font-medium text-slate-700 dark:text-slate-200 text-end">{t('income')}</th>
                  <th className="py-2.5 px-3 font-medium text-slate-700 dark:text-slate-200 text-end">{t('expenses')}</th>
                  <th className="py-2.5 px-3 font-medium text-slate-700 dark:text-slate-200 text-end">{t('net')}</th>
                </tr>
              </thead>
              <tbody>
                {pnlMonths.map((m, idx) => {
                  const inc = incomeByMonth[m] ?? 0;
                  const e = expensesByMonth[m];
                  const exp = e ? e.rent + e.salaries + e.utilities + e.other : 0;
                  const rowNet = inc - exp;
                  const stripe = idx % 2 === 0 ? 'bg-white dark:bg-slate-800' : 'bg-slate-50 dark:bg-slate-700/40';
                  return (
                    <tr key={m} className={`border-b border-slate-100 dark:border-slate-700/80 last:border-0 ${stripe}`}>
                      <td className="py-2.5 px-3 text-slate-800 dark:text-slate-100">{formatMonth(m, locale)}</td>
                      <td className="py-2.5 px-3 font-mono text-end text-green-600 dark:text-green-400">
                        {inc.toLocaleString('en-US')}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-end text-red-600 dark:text-red-400">
                        {exp.toLocaleString('en-US')}
                      </td>
                      <td
                        className={`py-2.5 px-3 font-mono text-end ${
                          rowNet >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                        }`}
                      >
                        {rowNet.toLocaleString('en-US')}
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
