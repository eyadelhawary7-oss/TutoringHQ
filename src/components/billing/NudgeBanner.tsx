'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { X, AlertTriangle, CreditCard, Clock } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatDate, formatNumber } from '@/lib/formatNumber';

/** Mirrors src/lib/nudges/types.ts BannerNudge (server-computed, live). */
interface BannerNudge {
  kind: 'prebill' | 'due_today' | 'locked' | 'card_expiry';
  ownerType: 'center' | 'teacher';
  amountDue: number;
  billingDayCairo: string | null;
  daysUntil: number | null;
  cardLast4: string | null;
  cardExpiry: string | null;
  ctaHref: string;
}

const DISMISS_KEY = 'chq_nudge_banner_dismissed';

/**
 * The ONE unified billing nudge banner for BOTH centers and teachers. It reads
 * the live /api/billing/nudge-status surface (computed straight from billing
 * state — never the WhatsApp ledger), so it works fully even when WhatsApp is
 * off or templates are unapproved. The only owner-specific difference is the
 * locked-state copy (center summary-screen lock vs teacher free-tier drop) and
 * the pay link, both resolved server-side. Every variant carries a one-tap pay
 * link into the existing pay flow.
 *
 * Critical (due-today / locked) banners are not dismissible; the softer
 * pre-billing and card-expiry reminders can be dismissed for the session.
 */
export function NudgeBanner() {
  const t = useTranslations('billing.nudge');
  const locale = useLocale();
  const [nudge, setNudge] = useState<BannerNudge | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (cancelled || !session) return;
        const res = await fetch(`/api/billing/nudge-status?locale=${locale}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok || cancelled) return;
        const json = (await res.json()) as { nudge: BannerNudge | null };
        if (cancelled) return;
        setNudge(json.nudge);
        try {
          const raw = sessionStorage.getItem(DISMISS_KEY);
          // Dismissal is keyed by kind so a new, more urgent nudge still shows.
          setDismissed(!!json.nudge && raw === json.nudge.kind);
        } catch {
          setDismissed(false);
        }
      } catch {
        // Non-fatal: simply no banner.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [locale]);

  if (!nudge || dismissed) return null;

  const amount = formatCurrency(nudge.amountDue, locale);
  const dismissible = nudge.kind === 'prebill' || nudge.kind === 'card_expiry';

  let message: string;
  let Icon = AlertTriangle;
  let tone = 'bg-red-600 text-white';
  let ctaLabel = t('payNow');

  switch (nudge.kind) {
    case 'prebill': {
      Icon = Clock;
      tone = 'bg-[var(--color-brass)] text-white';
      const dateLabel = nudge.billingDayCairo
        ? formatDate(`${nudge.billingDayCairo}T12:00:00`, locale, 'long')
        : '';
      message = t('prebill', {
        days: formatNumber(nudge.daysUntil ?? 0, locale),
        amount,
        date: dateLabel,
      });
      break;
    }
    case 'due_today': {
      Icon = AlertTriangle;
      tone = 'bg-red-600 text-white';
      message = t('dueToday', { amount });
      break;
    }
    case 'locked': {
      Icon = AlertTriangle;
      tone = 'bg-red-700 text-white';
      message = t(nudge.ownerType === 'teacher' ? 'lockedTeacher' : 'lockedCenter', { amount });
      break;
    }
    case 'card_expiry': {
      Icon = CreditCard;
      tone = 'bg-amber-500 text-white';
      ctaLabel = t('updateCard');
      message = t('cardExpiry', {
        last4: nudge.cardLast4 ?? '',
        expiry: nudge.cardExpiry ?? '',
      });
      break;
    }
    default:
      return null;
  }

  const handleDismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, nudge.kind);
    } catch {
      /* ignore storage failures */
    }
  };

  return (
    <div className={`flex items-center justify-between gap-3 px-4 py-3 text-sm shadow-md md:px-6 ${tone}`}>
      <div className="flex min-w-0 items-center gap-2">
        <Icon size={18} aria-hidden className="shrink-0" />
        <span className="min-w-0 text-start">{message}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <a
          href={nudge.ctaHref}
          className="rounded-md bg-white/20 px-3 py-1.5 font-medium transition-colors hover:bg-white/30"
        >
          {ctaLabel}
        </a>
        {dismissible ? (
          <button
            type="button"
            onClick={handleDismiss}
            aria-label={t('dismiss')}
            className="rounded p-1 transition-opacity hover:opacity-80"
          >
            <X size={16} aria-hidden />
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default NudgeBanner;
