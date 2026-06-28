'use client';

// Summer 2026 promo popup — in-brand cream card with a serif heading, accent CTA,
// and a "billing starts in" countdown to FIRST_CHARGE_FLOOR (never "offer ends").
// Shown ONCE per visitor via a non-PII cookie (no localStorage, per the storage
// hygiene rule). Hidden when the master switch is off. No code chip.

import { useEffect, useState } from 'react';
import { startOfUtcInstantForCairoCalendarDay } from '@/lib/cairo/day';
import { getSummerCopy, summerAccent, type SummerPortal } from '@/lib/summer/copy';
import { useSummerPublicConfig, formatFloorLabel } from '@/components/summer/useSummerPublicConfig';

const COOKIE_NAME = 'chq_summer_popup';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function hasSeenCookie(): boolean {
  if (typeof document === 'undefined') return true;
  return document.cookie.split('; ').some((c) => c.startsWith(`${COOKIE_NAME}=`));
}
function setSeenCookie(): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${COOKIE_NAME}=1; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}

interface Countdown {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  done: boolean;
}

function remaining(targetMs: number, now: number): Countdown {
  let diff = Math.max(0, targetMs - now);
  const done = diff <= 0;
  const days = Math.floor(diff / 86_400_000);
  diff -= days * 86_400_000;
  const hours = Math.floor(diff / 3_600_000);
  diff -= hours * 3_600_000;
  const minutes = Math.floor(diff / 60_000);
  diff -= minutes * 60_000;
  const seconds = Math.floor(diff / 1000);
  return { days, hours, minutes, seconds, done };
}

interface Props {
  locale: string;
  portal: SummerPortal;
  ctaHref?: string;
  /** Delay before showing (ms). */
  delayMs?: number;
}

export default function SummerPopup({ locale, portal, ctaHref = '/pricing', delayMs = 3000 }: Props) {
  const state = useSummerPublicConfig();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState<number | null>(null);

  // Show once per visitor after the delay.
  useEffect(() => {
    if (!state) return;
    if (hasSeenCookie()) return;
    const t = setTimeout(() => setOpen(true), delayMs);
    return () => clearTimeout(t);
  }, [state, delayMs]);

  // Tick the countdown only while open.
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [open]);

  if (!state || !open) return null;

  const isAr = locale === 'ar';
  const loc = isAr ? 'ar' : 'en';
  const accent = summerAccent(portal);
  const copy = getSummerCopy(portal, state.phase, loc, {
    floorLabel: formatFloorLabel(state.summer.firstChargeFloor, loc),
    trialDays: state.summer.trialDays,
  });

  const targetMs = startOfUtcInstantForCairoCalendarDay(state.summer.firstChargeFloor).getTime();
  const cd = remaining(targetMs, now ?? Date.now());

  const dismiss = () => {
    setSeenCookie();
    setOpen(false);
  };

  const unit = (value: number, labelAr: string, labelEn: string) => (
    <div className="flex flex-col items-center rounded-lg bg-white/70 px-3 py-2 min-w-[3.25rem]">
      <span className="text-xl font-bold" style={{ color: accent }}>
        {String(value).padStart(2, '0')}
      </span>
      <span className="text-[10px] text-[#6b5d3a]">{isAr ? labelAr : labelEn}</span>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 px-4"
      dir={isAr ? 'rtl' : 'ltr'}
      role="dialog"
      aria-modal="true"
      onClick={dismiss}
    >
      <div
        className="relative w-full max-w-md rounded-2xl border p-6 shadow-2xl"
        style={{ backgroundColor: '#faf6ec', borderColor: `${accent}33` }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={dismiss}
          aria-label={isAr ? 'إغلاق' : 'Close'}
          className="absolute top-3 inline-flex h-8 w-8 items-center justify-center rounded-full text-[#6b5d3a] hover:bg-black/5 end-3"
        >
          ✕
        </button>

        <h2
          className="mb-2 text-2xl font-bold"
          style={{ color: accent, fontFamily: 'var(--font-playfair), Georgia, serif' }}
        >
          {copy.popupTitle}
        </h2>
        <p className="mb-4 text-sm leading-relaxed text-[#4a4030]">{copy.popupBody}</p>

        {!cd.done ? (
          <div className="mb-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#6b5d3a]">
              {copy.countdownLabel}
            </p>
            <div className="flex flex-wrap gap-2">
              {unit(cd.days, 'يوم', 'days')}
              {unit(cd.hours, 'ساعة', 'hrs')}
              {unit(cd.minutes, 'دقيقة', 'min')}
              {unit(cd.seconds, 'ثانية', 'sec')}
            </div>
          </div>
        ) : null}

        <a
          href={ctaHref}
          onClick={dismiss}
          className="inline-flex w-full items-center justify-center rounded-full px-5 py-3 text-sm font-semibold text-white hover:opacity-90"
          style={{ backgroundColor: accent }}
        >
          {copy.popupCta}
        </a>
      </div>
    </div>
  );
}
