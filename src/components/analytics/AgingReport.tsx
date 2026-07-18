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

  const sendAllReminders = async () => {
    const session = await getSession();
    if (!session || data.length === 0) return;

    setSendingAll(true);
    try {
      for (const row of data) {
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
