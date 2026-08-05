'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { formatCurrency, formatNumber } from '@/lib/formatNumber';
import { supabase } from '@/lib/supabase';
import { getCsrfHeaders } from '@/lib/csrf-client';
import { MessageCircle, Loader2 } from 'lucide-react';

export interface AgingRow {
  student_id: string;
  student_name: string;
  group_name: string;
  days_overdue: number;
  amount: number;
}

export interface AgingReportProps {
  data: AgingRow[];
  onRefresh?: () => void;
}

function getRowBg(days: number): string {
  if (days <= 30) return 'bg-yellow-50';
  if (days <= 60) return 'bg-orange-50';
  return 'bg-red-50';
}

/**
 * `Merged-Center-Insight` §01's "Aging · outstanding" card draws three age
 * BANDS (`0–30`, `31–60` with a `watch` pill, `60+` with an `overdue` pill),
 * each carrying that band's outstanding total.
 *
 * THOSE BANDS ARE NOT BUILT, DELIBERATELY, AND THIS IS THE SECOND ATTEMPT.
 *
 * An earlier version of this component DID render them, by grouping the rows
 * the API returns on `days_overdue` and summing `amount`. That produced a
 * distribution the data cannot support, and it was caught in adversarial
 * re-verification:
 *
 *   · `amount` is `balances.get(id).balance` from `getStudentBalances(...)` —
 *     ONE RUNNING TOTAL PER STUDENT (`api/analytics/revenue/route.ts:159-168`),
 *     not a per-invoice figure. It has no internal structure to split.
 *   · `days_overdue` is ONE PROXY AGE PER STUDENT: days since the student's
 *     last confirmed payment + 30d, falling back to the 1st of the current
 *     month when they have never paid (`route.ts:272-283`).
 *
 * So a student five months in arrears who paid anything 20 days ago had their
 * ENTIRE balance rendered under "0–30 days". A real aging report splits ONE
 * student's balance ACROSS bands by invoice date; this data cannot, because
 * per-invoice allocation does not exist yet.
 *
 * It was also degenerate in production, not merely imprecise: `payments` holds
 * 0 rows, so every student falls back to the 1st of the month, every balance
 * lands in `0–30`, and `31–60` and `60+` printed EGP 0 for every centre,
 * always. Eyad's call, 5 August: **an honest empty state, not a relabel and
 * not the chart.** A zero reads as a fact, and two bands reading zero
 * unconditionally is worse than showing nothing.
 *
 * Tracked as its own feature entry with the migration it requires in
 * `design/BUILD-AFTER-REDESIGN.md` (F45 · per-invoice allocation). When that
 * lands, the bands come back here and this notice goes away.
 *
 * The per-student table below is untouched: it predates this pass, is real
 * per-student data, and is strictly more capability than the summary.
 */
export default function AgingReport({ data = [], onRefresh }: AgingReportProps) {
  const t = useTranslations('analytics');
  const locale = useLocale();
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [sendingAll, setSendingAll] = useState(false);

  const getSession = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session;
  };

  const sendReminder = async (studentId: string) => {
    const session = await getSession();
    if (!session) return;

    setSendingId(studentId);
    try {
      const res = await fetch('/api/whatsapp/send-balance-reminder', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          ...(await getCsrfHeaders(session.access_token)),
        },
        body: JSON.stringify({ student_id: studentId }),
      });
      const json = await res.json();
      if (json.ok && onRefresh) onRefresh();
    } finally {
      setSendingId(null);
    }
  };

  const sendBatch = async (rows: AgingRow[]) => {
    const session = await getSession();
    if (!session || rows.length === 0) return;

    for (const row of rows) {
      await fetch('/api/whatsapp/send-balance-reminder', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          ...(await getCsrfHeaders(session.access_token)),
        },
        body: JSON.stringify({ student_id: row.student_id }),
      });
      await new Promise((r) => setTimeout(r, 500));
    }
    if (onRefresh) onRefresh();
  };

  const sendAllReminders = async () => {
    if (data.length === 0) return;
    setSendingAll(true);
    try {
      await sendBatch(data);
    } finally {
      setSendingAll(false);
    }
  };

  if (!data?.length) {
    return (
      <div className="rounded-lg border bg-[var(--color-surface-1)] p-6 text-center text-[var(--color-text-secondary)]">
        <p className="text-sm">{t('noAgingItems')}</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-[var(--color-surface-1)] overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b bg-[var(--color-surface-2)]/30">
        <h3 className="font-semibold">{t('agingReport')}</h3>
        <button
          type="button"
          onClick={sendAllReminders}
          disabled={sendingAll}
          className="inline-flex items-center gap-2 rounded-md bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
        >
          {sendingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
          {t('sendReminderToAll')}
        </button>
      </div>

      {/* §01 "Aging · outstanding" — empty state, not the bands.

          Deliberately renders NO figure. The whole point is that no per-band
          amount is derivable: a zero here would read as "nothing is that old",
          which is a claim about the world, not about the data. See the block
          comment at the top of this file for why, and F45 in
          design/BUILD-AFTER-REDESIGN.md for what unblocks it. */}
      <div className="border-b border-[var(--color-border)] px-4 py-4">
        <p className="text-sm font-medium text-[var(--color-text-primary)]">
          {t('agingBandsTitle')}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-secondary)]">
          {t('agingBandsUnavailable')}
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-[var(--color-surface-2)]">
              <th className="text-end py-3 px-4 font-medium">{t('studentName')}</th>
              <th className="text-end py-3 px-4 font-medium">{t('group')}</th>
              <th className="text-end py-3 px-4 font-medium">{t('daysOverdue')}</th>
              <th className="text-end py-3 px-4 font-medium">{t('amount')}</th>
              <th className="w-12" />
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.student_id} className={`border-b ${getRowBg(row.days_overdue)}`}>
                <td className="py-2 px-4">{row.student_name}</td>
                <td className="py-2 px-4">{row.group_name}</td>
                <td className="py-2 px-4 font-mono">{formatNumber(row.days_overdue, locale)}</td>
                <td className="py-2 px-4 font-mono">{formatCurrency(row.amount, locale)}</td>
                <td className="py-2 px-2">
                  <button
                    type="button"
                    onClick={() => sendReminder(row.student_id)}
                    disabled={sendingId === row.student_id}
                    className="p-1.5 rounded hover:bg-[var(--color-surface-2)] disabled:opacity-50"
                    title={t('sendReminder')}
                  >
                    {sendingId === row.student_id ? (
                      <Loader2 className="h-4 w-4 animate-spin text-[var(--color-text-secondary)]" />
                    ) : (
                      <MessageCircle className="h-4 w-4 text-[var(--color-text-secondary)]" />
                    )}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
