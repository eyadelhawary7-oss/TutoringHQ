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
 * Merged-Center-Insight §01's "Aging · outstanding" card is three age BANDS
 * (`0–30`, `31–60` with a `watch` pill, `60+` with an `overdue` pill), each
 * carrying that band's outstanding total and its own Remind button — not the
 * flat per-student table this component shipped as. Both are kept: the bands
 * are the design's summary and the answer an owner actually wants first, the
 * table underneath is the live screen's existing per-student detail and is
 * strictly more capability, so replacing it with the summary would be a
 * regression dressed as design fidelity.
 *
 * The band totals are a pure client-side grouping of rows the API already
 * returns (`days_overdue`, `amount`). Nothing here is derived from a figure
 * the payload does not carry.
 *
 * Not a `patterns/ListRow`: a band is an aggregate summary line with one
 * inline action, not a record row — there is no entity behind it to open, no
 * three-dot sheet, and the design draws `.agerow`/`.wabtn`, which is a
 * different shape from `.lrow`. The per-student rows below keep the inline
 * reminder button they already had.
 */
const AGING_BANDS = [
  { id: 'b0_30', min: 0, max: 30, tone: 'none' },
  { id: 'b31_60', min: 31, max: 60, tone: 'watch' },
  { id: 'b60_plus', min: 61, max: Infinity, tone: 'overdue' },
] as const;

export default function AgingReport({ data = [], onRefresh }: AgingReportProps) {
  const t = useTranslations('analytics');
  const locale = useLocale();
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [sendingAll, setSendingAll] = useState(false);
  const [sendingBand, setSendingBand] = useState<string | null>(null);

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

  const sendBandReminders = async (bandId: string, rows: AgingRow[]) => {
    if (rows.length === 0) return;
    setSendingBand(bandId);
    try {
      await sendBatch(rows);
    } finally {
      setSendingBand(null);
    }
  };

  const bands = AGING_BANDS.map((band) => {
    const rows = data.filter((r) => r.days_overdue >= band.min && r.days_overdue <= band.max);
    return {
      ...band,
      rows,
      total: rows.reduce((s, r) => s + (Number(r.amount) || 0), 0),
    };
  });

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

      {/* §01 "Aging · outstanding": the three age bands, each with its own total
          and Remind action. Band labels take their digits through formatNumber
          so AR renders Eastern Arabic numerals. */}
      <div className="border-b border-[var(--color-border)] px-4 py-1">
        {bands.map((band) => {
          const label =
            band.max === Infinity
              ? t('agingBandPlus', { from: formatNumber(band.min - 1, locale) })
              : t('agingBandRange', {
                  from: formatNumber(band.min, locale),
                  to: formatNumber(band.max, locale),
                });
          const busy = sendingBand === band.id;
          return (
            <div
              key={band.id}
              className="flex items-center gap-2 border-t border-[var(--color-border)] py-3 first:border-t-0"
            >
              <span className="text-sm text-[var(--color-text-primary)]">{label}</span>
              {band.tone === 'watch' && <span className="badge badge-gold">{t('agingBandWatch')}</span>}
              {band.tone === 'overdue' && <span className="badge badge-danger">{t('agingBandOverdue')}</span>}
              <b className="ms-auto text-sm font-semibold tabular-nums text-[var(--color-text-primary)]">
                {formatCurrency(band.total, locale)}
              </b>
              <button
                type="button"
                onClick={() => sendBandReminders(band.id, band.rows)}
                disabled={busy || band.rows.length === 0}
                title={t('agingBandRemindTitle', { count: formatNumber(band.rows.length, locale) })}
                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-teal-500/12 px-3 py-1.5 text-[11px] font-semibold text-teal-700 hover:bg-teal-500/20 disabled:opacity-40"
              >
                {busy ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <MessageCircle className="h-3 w-3" />
                )}
                {t('remind')}
              </button>
            </div>
          );
        })}
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
