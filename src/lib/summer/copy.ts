// src/lib/summer/copy.ts
//
// Bilingual, per-portal copy for the summer ribbon + popup. Two phases, never
// empty: Phase 1 (until SUMMER_FREE_UNTIL) is the "free all summer, first invoice
// on the floor date, nothing now" message; Phase 2 (evergreen, from Aug 16) is the
// "14-day free trial, first invoice after" message. Pure + client-safe.

import type { SummerBannerPhase } from '@/lib/summer/phase';

export type SummerPortal = 'centers' | 'teachers' | 'combined';
export type SummerLocale = 'ar' | 'en';

export interface SummerCopy {
  /** Short sticky-ribbon line. */
  ribbon: string;
  /** Ribbon CTA label ("start free" / teachers: "start your free trial"). */
  ribbonCta: string;
  /** Popup serif heading. */
  popupTitle: string;
  /** Popup body. */
  popupBody: string;
  /** Label above the countdown ("billing starts in"). */
  countdownLabel: string;
  /** Popup CTA label. */
  popupCta: string;
}

/** Per-portal CTA. Teachers say "start your free trial"; others "start free". */
function cta(portal: SummerPortal, locale: SummerLocale): string {
  if (portal === 'teachers') {
    return locale === 'ar' ? 'ابدأ تجربتك المجانية' : 'Start your free trial';
  }
  return locale === 'ar' ? 'ابدأ مجانًا' : 'Start free';
}

/** "Billing starts in" — the popup countdown never reads as "offer ends". */
export function countdownLabel(locale: SummerLocale): string {
  return locale === 'ar' ? 'يبدأ الدفع خلال' : 'Billing starts in';
}

/**
 * The copy for a portal + phase + locale. `floorLabel` is the human first-charge
 * floor date (e.g. "Aug 30" / "٣٠ أغسطس") interpolated into Phase-1 copy.
 */
export function getSummerCopy(
  portal: SummerPortal,
  phase: SummerBannerPhase,
  locale: SummerLocale,
  opts: { floorLabel: string; trialDays: number },
): SummerCopy {
  const ar = locale === 'ar';
  const ribbonCta = cta(portal, locale);
  const popupCta = ribbonCta;
  const cd = countdownLabel(locale);
  const days = opts.trialDays;

  if (phase === 'phase1') {
    // Free-for-all until the free-until date.
    if (ar) {
      return {
        ribbon: `مجانًا طوال الصيف — أول فاتورة ${opts.floorLabel}. لا تدفع شيئًا الآن.`,
        ribbonCta,
        popupTitle: 'صيف على حسابنا',
        popupBody: `استخدم CenterHQ مجانًا بالكامل طوال الصيف. حسابك يعمل الآن دون أي دفع، وأول فاتورة لن تصدر قبل ${opts.floorLabel}. دون بطاقة ودون أي إعداد.`,
        countdownLabel: cd,
        popupCta,
      };
    }
    return {
      ribbon: `Free all summer — first invoice ${opts.floorLabel}. Nothing to pay now.`,
      ribbonCta,
      popupTitle: 'Summer is on us',
      popupBody: `Use CenterHQ completely free all summer. Your account is active now with nothing to pay, and your first invoice won't land before ${opts.floorLabel}. No card, nothing to set up.`,
      countdownLabel: cd,
      popupCta,
    };
  }

  // Phase 2 — evergreen 14-day trial.
  if (ar) {
    return {
      ribbon: `تجربة مجانية ${days} يومًا — أول فاتورة بعد انتهائها.`,
      ribbonCta,
      popupTitle: 'جرّب مجانًا',
      popupBody: `ابدأ بتجربة مجانية مدتها ${days} يومًا من يوم تسجيلك. أول فاتورة تصدر عند انتهاء التجربة، وتدفعها وقتها عبر فوري أو المحفظة أو إنستاباي أو البطاقة. لا بطاقة وقت التسجيل.`,
      countdownLabel: cd,
      popupCta,
    };
  }
  return {
    ribbon: `${days}-day free trial — first invoice after it ends.`,
    ribbonCta,
    popupTitle: 'Try it free',
    popupBody: `Start with a ${days}-day free trial from the day you join. Your first invoice lands when the trial ends, paid then by Fawry, wallet, InstaPay, or card. No card at signup.`,
    countdownLabel: cd,
    popupCta,
  };
}

/** Per-portal accent (brand tokens): forest green for centers/combined, bronze gold for teachers. */
export function summerAccent(portal: SummerPortal): string {
  return portal === 'teachers' ? '#8f7322' : '#2e5a4c';
}
