'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatDate, formatNumber } from '@/lib/formatNumber';

const TRIAL_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_KEY = 'teacher_trial_banner_dismissed';

/**
 * Slim trial countdown banner shown on every teacher portal page while the
 * subscription is trialing. Dismissible per browser session only
 * (sessionStorage - nothing persists across sessions). Renders nothing unless
 * the layout gate already granted private access AND the subscription is
 * actually in the trial window.
 */
export default function TeacherTrialBanner({ privateAccess }: { privateAccess: boolean }) {
  const t = useTranslations('teacherPortal.trialBanner');
  const locale = useLocale();

  // Resolved once, after the status fetch - never recomputed during render so
  // the component stays pure (no Date.now() in the render path).
  const [trial, setTrial] = useState<{ endsAt: string; dayNumber: number } | null>(null);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (!privateAccess) return;
    let cancelled = false;
    (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (cancelled) return;
        try {
          setDismissed(sessionStorage.getItem(SESSION_KEY) === '1');
        } catch {
          setDismissed(false);
        }
        if (!session) return;
        const res = await fetch('/api/teacher/subscription/status', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) return;
        const json = (await res.json()) as { status?: string | null; trial_ends_at?: string | null };
        if (!cancelled && json.status === 'trialing' && json.trial_ends_at) {
          const start = new Date(json.trial_ends_at).getTime() - TRIAL_DAYS * DAY_MS;
          const dayNumber = Math.min(
            TRIAL_DAYS,
            Math.max(1, Math.floor((Date.now() - start) / DAY_MS) + 1),
          );
          setTrial({ endsAt: json.trial_ends_at, dayNumber });
        }
      } catch {
        // Non-fatal: no banner.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [privateAccess]);

  if (!privateAccess || dismissed || !trial) return null;

  const handleDismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(SESSION_KEY, '1');
    } catch {
      // Ignore storage failures - dismissal still holds for this render.
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 bg-[var(--color-brass)] px-4 py-2 text-sm text-white md:px-6">
      <span>
        {t('text', {
          day: formatNumber(trial.dayNumber, locale),
          total: formatNumber(TRIAL_DAYS, locale),
          date: formatDate(trial.endsAt, locale),
        })}
      </span>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label={t('dismiss')}
        className="rounded p-1 transition-opacity hover:opacity-80"
      >
        <X size={16} aria-hidden />
      </button>
    </div>
  );
}
