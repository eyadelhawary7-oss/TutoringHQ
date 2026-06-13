'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Sparkles } from 'lucide-react';
import { teacherSubscriptionPost } from './teacherSubscriptionClient';

/**
 * Starts the Standard -> Pro upgrade. POSTs to the upgrade route and, on
 * success, redirects to the Paymob checkout. When payments are off the route
 * answers 503 and we show a visible inline "unavailable" banner (never a
 * disabled button, never a hidden CTA).
 */
export default function UpgradeFlow({
  label,
  variant = 'brass',
}: {
  label: string;
  variant?: 'brass' | 'inline';
}) {
  const t = useTranslations('teacherBilling');
  const [pending, setPending] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState(false);

  const start = async () => {
    setPending(true);
    setUnavailable(false);
    setError(false);
    try {
      const res = await teacherSubscriptionPost('/api/teacher/subscription/upgrade');
      if (!res) {
        setError(true);
        return;
      }
      if (res.status === 503) {
        setUnavailable(true);
        return;
      }
      if (!res.ok) {
        setError(true);
        return;
      }
      const data = (await res.json()) as { checkout_url?: string };
      if (data.checkout_url) {
        window.location.href = data.checkout_url;
        return;
      }
      setError(true);
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  };

  const btnClass =
    variant === 'brass'
      ? 'inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--color-brass)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50'
      : 'inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--color-brass)] px-4 py-2 text-sm font-medium text-[var(--color-brass)] transition-colors hover:bg-[var(--color-brass-soft)] disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={start} disabled={pending} className={btnClass}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles size={16} aria-hidden />}
        {label}
      </button>
      {unavailable && (
        <p className="rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-warning-muted)] px-3 py-2 text-sm font-medium text-[var(--color-warning)]">
          {t('paymentsUnavailable')}
        </p>
      )}
      {error && (
        <p className="rounded-lg border border-[var(--color-danger-muted)] bg-[var(--color-danger-muted)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {t('upgradeError')}
        </p>
      )}
    </div>
  );
}
