'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Lock, Users, Layers } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatNumber } from '@/lib/formatNumber';

type Counts = { privateGroups: number; privateStudents: number };

/**
 * Teacher private-engine LOCK SUMMARY — the teacher equivalent of the center
 * /suspended screen. Shown when a previously-subscribed teacher lapses past the
 * single-day lock: headline numbers only (total private students, total private
 * groups) + a pay button. No private records until paid. The free zone (center
 * monitoring) is unaffected — it renders normally elsewhere.
 */
export default function PrivateLockSummary({
  title,
  payLabel,
  onPay,
}: {
  title: string;
  payLabel: string;
  onPay: () => void;
}) {
  const t = useTranslations('teacherPortal.lockSummary');
  const locale = useLocale();
  const [counts, setCounts] = useState<Counts | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session || cancelled) return;
      const res = await fetch('/api/teacher/private-summary', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      }).catch(() => null);
      if (!cancelled && res?.ok) {
        setCounts((await res.json()) as Counts);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const num = (n: number | undefined) => (counts ? formatNumber(n ?? 0, locale) : '—');

  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--color-teal)]/40 bg-[var(--color-teal-soft)] p-6">
      <div className="mb-1 flex items-center gap-2">
        <Lock size={18} className="text-[var(--color-teal-deep)]" aria-hidden />
        <h2 className="text-lg font-bold text-[var(--color-text-primary)]">{title}</h2>
      </div>
      <p className="mb-4 text-sm text-[var(--color-text-secondary)]">{t('body')}</p>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-[var(--color-text-muted)]">
            <Users size={14} aria-hidden />
            {t('students')}
          </div>
          <div className="num text-2xl font-bold text-[var(--color-text-primary)]">
            {num(counts?.privateStudents)}
          </div>
        </div>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-[var(--color-text-muted)]">
            <Layers size={14} aria-hidden />
            {t('groups')}
          </div>
          <div className="num text-2xl font-bold text-[var(--color-text-primary)]">
            {num(counts?.privateGroups)}
          </div>
        </div>
      </div>

      <p className="mt-3 text-xs text-[var(--color-text-muted)]">{t('hint')}</p>

      <button
        type="button"
        onClick={onPay}
        className="mt-4 rounded-lg bg-teal-600 px-5 py-2 font-medium text-white transition-opacity hover:opacity-90"
      >
        {payLabel}
      </button>
    </section>
  );
}
