'use client';

// Summer 2026 promo popup — an in-brand cream card that slides up from the
// bottom (matches the approved mock summer_promo_v2_inbrand.html). Top row carries
// a "☀︎ Summer offer" tag, a live "billing starts in __d __h __m" countdown to
// FIRST_CHARGE_FLOOR (never "offer ends"), and a close ×. Fraunces serif heading,
// accent CTA, and a "No card now · First invoice Aug 30" footer line.
// Shown ONCE per visitor via a non-PII cookie (no localStorage). Hidden when the
// master switch is off.

import { useEffect, useState } from 'react';
import { startOfUtcInstantForCairoCalendarDay } from '@/lib/cairo/day';
import {
  getSummerCopy,
  summerAccent,
  summerOfferTag,
  summerPopupFooter,
  type SummerPortal,
} from '@/lib/summer/copy';
import { useSummerPublicConfig, formatFloorLabel } from '@/components/summer/useSummerPublicConfig';

const FRAUNCES = 'var(--font-fraunces), Georgia, serif';
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
  return { days, hours, minutes, done };
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
  const [shown, setShown] = useState(false); // drives the slide-up transition
  const [now, setNow] = useState<number | null>(null);

  // Show once per visitor after the delay.
  useEffect(() => {
    if (!state) return;
    if (hasSeenCookie()) return;
    const t = setTimeout(() => setOpen(true), delayMs);
    return () => clearTimeout(t);
  }, [state, delayMs]);

  // Tick the countdown + trigger the slide-up once open.
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => {
      setShown(true);
      setNow(Date.now());
    });
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(id);
    };
  }, [open]);

  if (!state || !open) return null;

  const isAr = locale === 'ar';
  const loc = isAr ? 'ar' : 'en';
  const accent = summerAccent(portal);
  const floorLabel = formatFloorLabel(state.summer.firstChargeFloor, loc);
  const copy = getSummerCopy(portal, state.phase, loc, {
    floorLabel,
    trialDays: state.summer.trialDays,
  });

  const targetMs = startOfUtcInstantForCairoCalendarDay(state.summer.firstChargeFloor).getTime();
  const cd = now !== null ? remaining(targetMs, now) : null;

  const dismiss = () => {
    setSeenCookie();
    setShown(false);
    setOpen(false);
  };

  const unit = (value: number, suffixAr: string, suffixEn: string) => (
    <span className="font-semibold" style={{ color: accent }}>
      {value}
      <span className="text-[11px] font-normal" style={{ color: '#6b5d3a' }}>
        {isAr ? suffixAr : suffixEn}
      </span>
    </span>
  );

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex justify-center px-4 pb-4"
      dir={isAr ? 'rtl' : 'ltr'}
    >
      <div
        className="pointer-events-auto relative w-full max-w-md rounded-2xl border p-5 shadow-2xl transition-transform duration-500 ease-out"
        style={{
          backgroundColor: '#fbf9f4',
          borderColor: `${accent}33`,
          transform: shown ? 'translateY(0)' : 'translateY(120%)',
        }}
        role="dialog"
        aria-modal="false"
        aria-label={copy.popupTitle}
      >
        {/* Top row: offer tag · countdown · close */}
        <div className="mb-3 flex items-center gap-3">
          <span
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold"
            style={{ backgroundColor: `${accent}1a`, color: accent }}
          >
            <span aria-hidden>☀︎</span>
            {summerOfferTag(loc)}
          </span>

          {cd && !cd.done ? (
            <span className="text-xs" style={{ color: '#6b5d3a' }}>
              {copy.countdownLabel}{' '}
              {unit(cd.days, 'ي', 'd')} {unit(cd.hours, 'س', 'h')} {unit(cd.minutes, 'د', 'm')}
            </span>
          ) : null}

          <button
            type="button"
            onClick={dismiss}
            aria-label={isAr ? 'إغلاق' : 'Close'}
            className="ms-auto inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-black/5"
            style={{ color: '#6b5d3a' }}
          >
            ✕
          </button>
        </div>

        <h2 className="mb-2 text-2xl font-bold" style={{ color: accent, fontFamily: FRAUNCES }}>
          {copy.popupTitle}
        </h2>
        <p className="mb-4 text-sm leading-relaxed" style={{ color: '#4a4030' }}>
          {copy.popupBody}
        </p>

        <a
          href={ctaHref}
          onClick={dismiss}
          className="inline-flex w-full items-center justify-center rounded-full px-5 py-3 text-sm font-bold hover:opacity-90"
          style={{ backgroundColor: accent, color: '#fbf9f4' }}
        >
          {copy.popupCta}
        </a>

        <p className="mt-3 text-center text-xs" style={{ color: '#6b5d3a' }}>
          {summerPopupFooter(loc, floorLabel)}
        </p>
      </div>
    </div>
  );
}
