// src/lib/summer/copy.ts
//
// Bilingual, per-portal copy + brand styling tokens for the summer ribbon + popup.
// Two phases, never empty: Phase 1 (until SUMMER_FREE_UNTIL) is the "free all
// summer, first invoice on the floor date, nothing now" message; Phase 2
// (evergreen, from Aug 16) is the "14-day free trial" message. Pure + client-safe.
//
// The literal hex values below come from the approved mock (summer_promo_v2_inbrand.html)
// and are used full-strength — never routed through a muted theme token.

import type { SummerBannerPhase } from '@/lib/summer/phase';

export type SummerPortal = 'centers' | 'teachers' | 'combined';
export type SummerLocale = 'ar' | 'en';

export interface SummerCopy {
  /** Sticky-ribbon headline (serif). */
  ribbon: string;
  /** Sticky-ribbon sub line under the headline. */
  ribbonSub: string;
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

/** Phase-1 per-portal headline + sub + popup H2. Exact mock copy (EN) mirrored in AR. */
function phase1Copy(
  portal: SummerPortal,
  locale: SummerLocale,
  floorLabel: string,
): Pick<SummerCopy, 'ribbon' | 'ribbonSub' | 'popupTitle' | 'popupBody'> {
  const ar = locale === 'ar';
  if (portal === 'centers') {
    return ar
      ? {
          ribbon: 'شغّل سنترك مجانًا طوال الصيف',
          ribbonSub: `جهّز كل شيء الآن، أول فاتورة ${floorLabel}، بدون دفع`,
          popupTitle: 'سنترك، مجانًا طوال الصيف',
          popupBody: `استخدم CenterHQ مجانًا بالكامل طوال الصيف. حسابك يعمل الآن دون أي دفع، وأول فاتورة لن تصدر قبل ${floorLabel}. دون بطاقة ودون أي إعداد.`,
        }
      : {
          ribbon: 'Run your center free all summer',
          ribbonSub: `Set everything up now, first invoice ${floorLabel}, no payment`,
          popupTitle: 'Your center, free all summer',
          popupBody: `Use CenterHQ completely free all summer. Your account is active now with nothing to pay, and your first invoice won't land before ${floorLabel}. No card, nothing to set up.`,
        };
  }
  if (portal === 'teachers') {
    return ar
      ? {
          ribbon: 'ابدأ مجانًا طوال الصيف',
          ribbonSub: `جرّب كل المميزات الآن، أول فاتورة ${floorLabel}، بدون دفع`,
          popupTitle: 'مجموعاتك، مجانًا طوال الصيف',
          popupBody: `استخدم CenterHQ مجانًا بالكامل طوال الصيف. مجموعاتك تعمل الآن دون أي دفع، وأول فاتورة لن تصدر قبل ${floorLabel}. دون بطاقة ودون أي إعداد.`,
        }
      : {
          ribbon: 'Start free all summer',
          ribbonSub: `Try every feature now, first invoice ${floorLabel}, no payment`,
          popupTitle: 'Your groups, free all summer',
          popupBody: `Use CenterHQ completely free all summer. Your groups are active now with nothing to pay, and your first invoice won't land before ${floorLabel}. No card, nothing to set up.`,
        };
  }
  // combined
  return ar
    ? {
        ribbon: 'مجانًا طوال الصيف للسناتر والمدرّسين',
        ribbonSub: `ابدأ اليوم، أول فاتورة ${floorLabel}، لا تدفع شيئًا الآن`,
        popupTitle: 'مجانًا طوال الصيف',
        popupBody: `استخدم CenterHQ مجانًا بالكامل طوال الصيف. حسابك يعمل الآن دون أي دفع، وأول فاتورة لن تصدر قبل ${floorLabel}. دون بطاقة ودون أي إعداد.`,
      }
    : {
        ribbon: 'Free all summer for centers and teachers',
        ribbonSub: `Start today, first invoice ${floorLabel}, nothing to pay now`,
        popupTitle: 'Free all summer',
        popupBody: `Use CenterHQ completely free all summer. Your account is active now with nothing to pay, and your first invoice won't land before ${floorLabel}. No card, nothing to set up.`,
      };
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
    return {
      ...phase1Copy(portal, locale, opts.floorLabel),
      ribbonCta,
      countdownLabel: cd,
      popupCta,
    };
  }

  // Phase 2 — evergreen trial.
  if (ar) {
    return {
      ribbon: `تجربة مجانية ${days} يومًا`,
      ribbonSub: 'أول فاتورة بعد انتهاء التجربة — بدون بطاقة عند التسجيل',
      ribbonCta,
      popupTitle: 'جرّب مجانًا',
      popupBody: `ابدأ بتجربة مجانية مدتها ${days} يومًا من يوم تسجيلك. أول فاتورة تصدر عند انتهاء التجربة، وتدفعها وقتها عبر فوري أو المحفظة أو إنستاباي أو البطاقة. لا بطاقة وقت التسجيل.`,
      countdownLabel: cd,
      popupCta,
    };
  }
  return {
    ribbon: `${days}-day free trial`,
    ribbonSub: 'First invoice after the trial ends — no card at signup',
    ribbonCta,
    popupTitle: 'Try it free',
    popupBody: `Start with a ${days}-day free trial from the day you join. Your first invoice lands when the trial ends, paid then by Fawry, wallet, InstaPay, or card. No card at signup.`,
    countdownLabel: cd,
    popupCta,
  };
}

/** Per-portal accent (brand token): forest green for centers/combined, bronze gold for teachers. */
export function summerAccent(portal: SummerPortal): string {
  return portal === 'teachers' ? '#8f7322' : '#2e5a4c';
}

/** Ribbon background gradient (160deg, full-strength literal hex from the mock). */
export function summerRibbonGradient(portal: SummerPortal): string {
  return portal === 'teachers'
    ? 'linear-gradient(160deg, #8f7322, #7a6019)'
    : 'linear-gradient(160deg, #2e5a4c, #244a3e)';
}

/** Cream CTA button colours (cream background, dark in-brand text). */
export function summerCtaColors(portal: SummerPortal): { bg: string; text: string } {
  return { bg: '#fbf9f4', text: portal === 'teachers' ? '#7a6019' : '#244a3e' };
}

/** Small faded "Code" label on the ribbon chip. (Marketing only — never gates anything.) */
export function summerChipLabel(locale: SummerLocale): string {
  return locale === 'ar' ? 'الكود' : 'Code';
}

/** "☀︎ Summer offer" tag at the top of the popup. */
export function summerOfferTag(locale: SummerLocale): string {
  return locale === 'ar' ? 'عرض الصيف' : 'Summer offer';
}

/** Popup footer reassurance line: "No card now · First invoice Aug 30". */
export function summerPopupFooter(locale: SummerLocale, floorLabel: string): string {
  return locale === 'ar'
    ? `بدون بطاقة الآن · أول فاتورة ${floorLabel}`
    : `No card now · First invoice ${floorLabel}`;
}
