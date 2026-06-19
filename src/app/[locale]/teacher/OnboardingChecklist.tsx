'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CheckCircle2, Circle, ChevronDown, ChevronUp, ListChecks } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { getCsrfHeaders } from '@/lib/csrf-client';
import { formatNumber } from '@/lib/formatNumber';
import { useToast } from '@/components/ui/ToastProvider';

type ChecklistData = {
  subjectDone: boolean;
  centerOrGroupDone: boolean;
  scheduleDone: boolean;
  referralDone: boolean;
  dismissed: boolean;
};

type Step = { key: string; done: boolean; href?: string };

/**
 * Onboarding checklist (free zone home). Five steps; hides itself once every
 * step is complete OR the teacher dismisses it. Dismissal is server-side
 * (teacher_profiles.checklist_dismissed via PATCH /api/teacher/profile) - no
 * browser storage - so it stays dismissed across devices.
 */
export default function OnboardingChecklist() {
  const t = useTranslations('teacherPortal.checklist');
  const locale = useLocale();
  const { toast } = useToast();

  const [data, setData] = useState<ChecklistData | null>(null);
  const [hidden, setHidden] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [dismissing, setDismissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) return;
        const res = await fetch('/api/teacher/checklist', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) return;
        const json = (await res.json()) as ChecklistData;
        if (!cancelled) setData(json);
      } catch {
        // Non-fatal: the card just stays hidden.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // One-way latch persisted in teacher_profiles.checklist_dismissed: the card
  // hides only after the server confirms, so a failed PATCH never leaves the
  // teacher believing it was dismissed when it will reappear on refresh.
  const handleDismiss = async () => {
    if (dismissing) return;
    setDismissing(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error('no session');
      const res = await fetch('/api/teacher/profile', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          ...(await getCsrfHeaders(session.access_token)),
        },
        body: JSON.stringify({ checklist_dismissed: true }),
      });
      if (!res.ok) throw new Error(`dismiss failed: ${res.status}`);
      setHidden(true);
    } catch {
      toast.error(t('dismissError'));
    } finally {
      setDismissing(false);
    }
  };

  if (!data || data.dismissed || hidden) return null;

  const steps: Step[] = [
    { key: 'step1', done: true },
    { key: 'step2', done: data.subjectDone, href: '/teacher/settings' },
    { key: 'step3', done: data.centerOrGroupDone },
    { key: 'step4', done: data.scheduleDone, href: '/teacher/schedule' },
    { key: 'step5', done: data.referralDone },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null;

  const pct = Math.round((doneCount / steps.length) * 100);

  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-6 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-bold text-[var(--color-text-primary)]">
          <ListChecks size={18} className="text-[var(--color-brass)]" aria-hidden />
          {t('title')}
        </h2>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? t('collapse') : t('expand')}
          className="rounded-lg p-1.5 text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-2)]"
        >
          {expanded ? <ChevronUp size={18} aria-hidden /> : <ChevronDown size={18} aria-hidden />}
        </button>
      </div>

      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between text-xs text-[var(--color-text-muted)]">
          <span>
            {t('progress', {
              done: formatNumber(doneCount, locale),
              total: formatNumber(steps.length, locale),
            })}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-[var(--color-brass-soft)]">
          <div
            className="h-full rounded-full bg-[var(--color-brass)] transition-all"
            style={{ inlineSize: `${pct}%` }}
          />
        </div>
      </div>

      {expanded && (
        <>
          <ul className="mt-4 flex flex-col gap-2">
            {steps.map((s) => {
              const icon = s.done ? (
                <CheckCircle2 size={18} className="text-[var(--color-teal-deep)]" aria-hidden />
              ) : (
                <Circle size={18} className="text-[var(--color-text-muted)]" aria-hidden />
              );
              const label = (
                <span
                  className={
                    s.done
                      ? 'text-sm text-[var(--color-text-muted)] line-through'
                      : 'text-sm font-medium text-[var(--color-text-primary)]'
                  }
                >
                  {t(s.key)}
                </span>
              );
              return (
                <li key={s.key} className="flex items-center gap-3">
                  {icon}
                  {s.href && !s.done ? (
                    <Link href={s.href} className="hover:underline">
                      {label}
                    </Link>
                  ) : (
                    label
                  )}
                </li>
              );
            })}
          </ul>

          <button
            type="button"
            onClick={handleDismiss}
            disabled={dismissing}
            className="mt-4 text-xs font-medium text-[var(--color-text-muted)] hover:underline disabled:opacity-50"
          >
            {t('dismiss')}
          </button>
        </>
      )}
    </section>
  );
}
