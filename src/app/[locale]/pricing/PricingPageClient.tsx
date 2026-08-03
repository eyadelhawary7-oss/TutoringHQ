'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { formatNumber } from '@/lib/formatNumber';
import {
  getAnnualChargeRounded,
  getAnnualMonthlyFromBase,
  ORDERED_SUBSCRIPTION_PLAN_KEYS,
  PLANS,
} from '@/lib/pricing';
import { teacherScaleExample } from '@/lib/pricing/teacherScaleExample';
import { TEACHER_PLANS } from '@/lib/teacherPlans';
import { usePublicPlanPrices } from '@/hooks/usePublicPlanPrices';
import { usePublicAnnualMultiplier } from '@/components/summer/useSummerPublicConfig';
import MarketingNav from '@/components/marketing/MarketingNav';
import Kicker from '@/components/marketing/Kicker';
import SummerLine from '@/components/marketing/SummerLine';
import MarketingFooter from '@/components/landing/MarketingFooter';

/**
 * `/pricing`.
 *
 * The six center tiers are NOT six cards. They differ only by capacity, so the
 * page is one object with a capacity control: move the chips and exactly two
 * things change — the tier name and the price. Everything else holds still,
 * which is the argument made visually rather than written out. The audience
 * tablist is gone too; both blocks are always on screen.
 *
 * Two things the design draws are deliberately NOT built, because nothing in
 * the live database can source them:
 *
 *  1. The "What changes with size" rows inside the readout — Branches, Team
 *     seats and WhatsApp notifications a month. There is no branch limit, no
 *     seat limit and no notification quota on `pricing_plans`, on `centers`, or
 *     anywhere in `public`; the design file says so itself. Rendering
 *     "Branches: 3" beside a real price would be a fabricated commitment. Only
 *     `weekly_student_limit` exists, and it is already the chip.
 *  2. The Add-ons rows (extra branch, team seat, advanced analytics, instant
 *     payout). No add-on price table exists and no constants exist in
 *     `src/lib/pricing*`. The four NOTES that sit under them are all checkable,
 *     so they survive and attach to the section above.
 *
 * Every figure on this page is live: center prices and caps from
 * `pricing_plans`, teacher prices/caps/trial/overage from `TEACHER_PLANS`, and
 * the annual multiplier from `pricing.interval.annual_multiplier`.
 */

/** Worked example for the no-ceiling tier. Must sit above the Scale cap. */
const OVERAGE_EXAMPLE_STUDENTS = 200;

type Billing = 'monthly' | 'annual';

export default function PricingPageClient() {
  const t = useTranslations('pricingPage');
  const locale = useLocale();
  const isAr = locale === 'ar';

  const [billing, setBilling] = useState<Billing>('monthly');
  // Starter is the design's default selection on the center control.
  const [centerIdx, setCenterIdx] = useState(2);
  const [teacherIdx, setTeacherIdx] = useState(0);

  // The old page swapped its whole body on `?for=teacher`; the rebuild stacks
  // both blocks, so the deep link (still emitted by the teacher portal's
  // FreeZoneBanner) scrolls to the teacher block instead. `#teacher` works too.
  const teacherBlockRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const wantsTeacher =
      new URLSearchParams(window.location.search).get('for') === 'teacher' ||
      window.location.hash === '#teacher';
    if (wantsTeacher) teacherBlockRef.current?.scrollIntoView({ block: 'start' });
  }, []);

  const dyn = usePublicPlanPrices();
  const annualMultiplier = usePublicAnnualMultiplier();

  const n = (v: number) => formatNumber(v, locale);
  const n2 = (v: number) =>
    formatNumber(v, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const bold = (chunks: React.ReactNode) => (
    <b className="mkt-mono font-medium text-[var(--color-ink)]">{chunks}</b>
  );
  const boldPlain = (chunks: React.ReactNode) => (
    <b className="font-semibold text-[var(--color-ink)]">{chunks}</b>
  );

  // ── Center tiers ───────────────────────────────────────────────────
  const centerTiers = ORDERED_SUBSCRIPTION_PLAN_KEYS.map((key) => {
    const plan = PLANS[key];
    const live = dyn[key];
    return {
      key,
      name: isAr ? plan.arabicName : plan.englishName,
      cap: live.weeklyStudentLimit ?? plan.weeklyStudentLimit ?? 0,
      monthly: live.quarterlyAllIn,
      annualMonthly: live.annualEffectiveMonthly,
      annualTotal: live.annualTotal,
      popular: plan.landingBadge === 'popular',
    };
  });
  const center = centerTiers[Math.min(centerIdx, centerTiers.length - 1)];
  const centerShown = billing === 'annual' ? center.annualMonthly : center.monthly;

  // ── Teacher tiers ──────────────────────────────────────────────────
  // Three flat tiers plus the no-ceiling reading of the top one. Caps, prices
  // and the overage rate all come from TEACHER_PLANS, which mirrors the live
  // `teacher_subscription_plan*` config the billing engine charges from.
  const scale = TEACHER_PLANS.teacher_scale;
  const teacherTiers = [
    { def: TEACHER_PLANS.teacher_standard, note: 'standard' as const, overage: 0 },
    { def: TEACHER_PLANS.teacher_pro, note: 'pro' as const, overage: 0 },
    { def: scale, note: 'scale' as const, overage: 0 },
    { def: scale, note: 'scalePlus' as const, overage: scale.overagePerStudent },
  ];
  const teacher = teacherTiers[Math.min(teacherIdx, teacherTiers.length - 1)];
  const teacherName = t(`teacherTier.${teacher.def.key}` as 'teacherTier.teacher_standard');
  const teacherMonthly = teacher.def.priceGross;
  const teacherAnnualMonthly = getAnnualMonthlyFromBase(teacherMonthly, annualMultiplier);
  const teacherAnnualTotal = getAnnualChargeRounded(teacherMonthly, annualMultiplier);
  const teacherShown = billing === 'annual' ? teacherAnnualMonthly : teacherMonthly;

  // The no-ceiling readout's math lives in one pure, unit-tested helper
  // (design L1864-1897): annual applies the same two-months-free multiplier to
  // the overage rate as to the base, so the curve does not bend at the cap.
  const scaleEx = teacherScaleExample({
    baseMonthly: scale.priceGross,
    studentCap: scale.studentCap,
    overagePerStudent: scale.overagePerStudent,
    billing,
    annualMultiplier,
    students: OVERAGE_EXAMPLE_STUDENTS,
  });

  const sameItems = t.raw('same.items') as string[];
  const notes = ['vat', 'annual', 'trial', 'cancel'] as const;

  const chipBase =
    'inline-flex min-h-[38px] items-center rounded-xl border px-3 text-xs font-medium transition-colors';
  const sectionHead =
    'm-0 text-[22px] font-bold leading-snug tracking-[-.01em] text-[var(--color-ink)] rtl:tracking-normal';

  const readoutShell =
    'mt-3 rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-4';

  return (
    <main
      dir={isAr ? 'rtl' : 'ltr'}
      className="flex min-h-screen w-full flex-col bg-[var(--color-paper)] text-[var(--color-ink-body)]"
    >
      <MarketingNav tone="center" />

      <section className="px-6 pb-[34px] pt-7">
        <div className="mx-auto w-full max-w-2xl">
          <Kicker>{t('kick')}</Kicker>
          <h1 className="m-0 text-[30px] font-bold leading-tight tracking-[-.015em] text-[var(--color-ink)] rtl:tracking-normal">
            {t('title')}
          </h1>
          <p className="mt-3 text-[13px] leading-relaxed text-[var(--color-ink-body)]">
            {t('subtitle')}
          </p>

          {/* ── Billing tray. "2 months free" sits inside the Annual button
                 and is always visible, so the saving is legible before you
                 press it rather than only after. ─────────────────────── */}
          <div
            className="mt-4 flex gap-1 rounded-xl border border-[var(--color-line)] p-1"
            style={{ backgroundColor: 'var(--color-tile)' }}
            role="tablist"
            aria-label={`${t('billMonthly')} / ${t('billAnnual')}`}
          >
            {(['monthly', 'annual'] as const).map((iv) => {
              const on = billing === iv;
              return (
                <button
                  key={iv}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setBilling(iv)}
                  className="flex min-h-[42px] flex-1 flex-col items-center justify-center gap-1 rounded-lg text-[13px] leading-tight"
                  style={
                    on
                      ? {
                          backgroundColor: 'var(--color-panel)',
                          color: 'var(--color-ink)',
                          fontWeight: 700,
                          boxShadow: '0 1px 3px rgba(20,24,26,.09)',
                        }
                      : { color: 'var(--color-mid)', fontWeight: 600 }
                  }
                >
                  {iv === 'monthly' ? t('billMonthly') : t('billAnnual')}
                  {iv === 'annual' ? (
                    <small
                      className="text-[11px] font-semibold"
                      style={{ color: 'var(--color-brass)' }}
                    >
                      {t('annualBadge')}
                    </small>
                  ) : null}
                </button>
              );
            })}
          </div>

          {/* ── A center ──────────────────────────────────────────────── */}
          <div
            className="mt-4 rounded-2xl border bg-[var(--color-panel)] px-4 py-6"
            style={{ borderColor: 'var(--color-mint-deep)' }}
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <span
                className="inline-flex items-center rounded-full px-3 py-2 text-[11px] font-bold uppercase tracking-[.1em] rtl:normal-case rtl:tracking-[.02em]"
                style={{ backgroundColor: 'var(--color-mint)', color: 'var(--color-accent-deep)' }}
              >
                {t('centerLabel')}
              </span>
              <span
                className="text-[11px] font-bold uppercase tracking-[.06em] rtl:normal-case rtl:tracking-[.02em]"
                style={{
                  color: 'var(--color-brass)',
                  visibility: center.popular ? 'visible' : 'hidden',
                }}
              >
                {t('mostChosen')}
              </span>
            </div>

            <div className="mb-2 text-[11px] font-semibold text-[var(--color-muted)]">
              {t('capLabelCenter')}
            </div>
            <div className="flex flex-wrap gap-1">
              {centerTiers.map((tier, i) => {
                const on = i === centerIdx;
                return (
                  <button
                    key={tier.key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setCenterIdx(i)}
                    className={`${chipBase} mkt-mono`}
                    style={
                      on
                        ? {
                            backgroundColor: 'var(--color-accent)',
                            borderColor: 'var(--color-accent)',
                            color: '#fff',
                          }
                        : {
                            backgroundColor: 'var(--color-panel)',
                            borderColor: 'var(--color-line)',
                            color: 'var(--color-mid)',
                          }
                    }
                  >
                    {n(tier.cap)}
                  </button>
                );
              })}
            </div>

            <div className={readoutShell}>
              <div className="text-[17px] font-bold leading-tight text-[var(--color-ink)]">
                {center.name}
              </div>
              <div className="mt-2 flex flex-wrap items-baseline gap-1">
                <span className="mkt-mono text-[30px] leading-none text-[var(--color-ink)]">
                  {n(centerShown)}
                </span>
                <span className="text-xs text-[var(--color-muted)]">{t('perMonthUnit')}</span>
              </div>
              <p className="mt-2 text-xs text-[var(--color-mid)]">
                {t.rich('perStudent', {
                  amount: n2(center.cap > 0 ? centerShown / center.cap : 0),
                  b: bold,
                })}
              </p>
              <p className="mt-3 border-t border-[var(--color-hairline)] pt-3 text-[11px] leading-snug text-[var(--color-muted)]">
                {billing === 'monthly'
                  ? t.rich('altMonthly', {
                      monthly: n(center.annualMonthly),
                      total: n(center.annualTotal),
                      b: boldPlain,
                    })
                  : t.rich('altAnnual', { total: n(center.annualTotal), b: boldPlain })}
              </p>
            </div>

            {centerIdx === centerTiers.length - 1 ? (
              <p
                className="mt-3 rounded-lg p-3 text-[11px] leading-snug text-[var(--color-mid)]"
                style={{ backgroundColor: 'var(--color-tile)' }}
              >
                {t('topCentersNote', { count: n(center.cap) })}
              </p>
            ) : null}
          </div>

          {/* ── A teacher ─────────────────────────────────────────────── */}
          <div
            id="teacher"
            ref={teacherBlockRef}
            className="mt-4 scroll-mt-4 rounded-2xl border bg-[var(--color-panel)] px-4 py-6"
            style={{ borderColor: 'var(--color-canvas)' }}
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <span
                className="inline-flex items-center rounded-full px-3 py-2 text-[11px] font-bold uppercase tracking-[.1em] rtl:normal-case rtl:tracking-[.02em]"
                style={{ backgroundColor: 'var(--color-sand)', color: 'var(--color-brass)' }}
              >
                {t('teacherLabel')}
              </span>
            </div>

            <p
              className="mb-3 rounded-xl px-4 py-3 text-xs leading-relaxed"
              style={{ backgroundColor: 'var(--color-sand)', color: 'var(--color-brass)' }}
            >
              {t.rich('teacherFreeLine', {
                b: (chunks) => <b className="font-bold">{chunks}</b>,
              })}
            </p>

            <div className="mb-2 text-[11px] font-semibold text-[var(--color-muted)]">
              {t('capLabelTeacher')}
            </div>
            <div className="flex flex-wrap gap-1">
              {teacherTiers.map((tier, i) => {
                const on = i === teacherIdx;
                const label = tier.overage
                  ? t('chipPlus', { count: n(tier.def.studentCap) })
                  : n(tier.def.studentCap);
                return (
                  <button
                    key={tier.note}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setTeacherIdx(i)}
                    className={`${chipBase} mkt-mono`}
                    style={
                      on
                        ? {
                            backgroundColor: 'var(--color-brass)',
                            borderColor: 'var(--color-brass)',
                            color: '#fff',
                          }
                        : {
                            backgroundColor: 'var(--color-panel)',
                            borderColor: 'var(--color-line)',
                            color: 'var(--color-mid)',
                          }
                    }
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            <div className={readoutShell}>
              <div className="text-[17px] font-bold leading-tight text-[var(--color-ink)]">
                {teacherName}
              </div>
              <div className="mt-2 flex flex-wrap items-baseline gap-1">
                <span className="mkt-mono text-[30px] leading-none text-[var(--color-ink)]">
                  {n(teacherShown)}
                </span>
                <span className="text-xs text-[var(--color-muted)]">
                  {teacher.overage
                    ? t('perFirstUnit', { count: n(teacher.def.studentCap) })
                    : t('perMonthUnit')}
                </span>
              </div>

              {teacher.overage ? (
                <>
                  <p className="mt-2 text-xs text-[var(--color-mid)]">
                    {billing === 'monthly'
                      ? t.rich('overageMonthly', { rate: n(teacher.overage), b: bold })
                      : t.rich('overageAnnual', {
                          rate: n2(scaleEx.overageRate),
                          yearly: n(scaleEx.overageYearly),
                          b: bold,
                        })}
                  </p>
                  <p className="mt-3 border-t border-[var(--color-hairline)] pt-3 text-[11px] leading-snug text-[var(--color-muted)]">
                    {billing === 'monthly'
                      ? t.rich('exampleMonthly', {
                          students: n(OVERAGE_EXAMPLE_STUDENTS),
                          total: n2(scaleEx.exampleTotal),
                          each: n2(scaleEx.examplePerStudent),
                          b: boldPlain,
                        })
                      : t.rich('exampleAnnual', {
                          students: n(OVERAGE_EXAMPLE_STUDENTS),
                          total: n2(scaleEx.exampleTotal),
                          each: n2(scaleEx.examplePerStudent),
                          b: boldPlain,
                        })}
                  </p>
                </>
              ) : (
                <>
                  <p className="mt-2 text-xs text-[var(--color-mid)]">
                    {t.rich('perStudent', {
                      amount: n2(teacherShown / teacher.def.studentCap),
                      b: bold,
                    })}
                  </p>
                  <p className="mt-3 border-t border-[var(--color-hairline)] pt-3 text-[11px] leading-snug text-[var(--color-muted)]">
                    {billing === 'monthly'
                      ? t.rich('altMonthly', {
                          monthly: n(teacherAnnualMonthly),
                          total: n(teacherAnnualTotal),
                          b: boldPlain,
                        })
                      : t.rich('altAnnual', { total: n(teacherAnnualTotal), b: boldPlain })}
                  </p>
                </>
              )}
            </div>

            <p
              className="mt-3 rounded-lg p-3 text-[11px] leading-snug text-[var(--color-mid)]"
              style={{ backgroundColor: 'var(--color-tile)' }}
            >
              {teacher.note === 'standard'
                ? t('teacherNoteStandard', { days: n(teacher.def.trialDays) })
                : teacher.note === 'pro'
                  ? t('teacherNotePro')
                  : teacher.note === 'scale'
                    ? t('teacherNoteScale')
                    : t('teacherNoteScalePlus')}
            </p>
          </div>
        </div>
      </section>

      {/* ── The same either way ───────────────────────────────────────── */}
      <section
        className="border-y border-[var(--color-line)] px-6 py-12"
        style={{ backgroundColor: 'var(--color-tile)' }}
      >
        <div className="mx-auto w-full max-w-2xl">
          <Kicker>{t('same.kick')}</Kicker>
          <h2 className={sectionHead}>{t('same.heading')}</h2>
          <p className="mt-3 text-[13px] leading-relaxed text-[var(--color-ink-body)]">
            {t('same.lede')}
          </p>
          <div className="mt-4 rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-1">
            {sameItems.map((item) => (
              <div
                key={item}
                className="flex items-start gap-2 border-b border-[var(--color-hairline)] py-3 last:border-b-0"
              >
                <span
                  className="mt-1 grid shrink-0 place-items-center rounded-full text-[11px]"
                  style={{
                    width: 17,
                    height: 17,
                    backgroundColor: 'var(--color-mint)',
                    color: 'var(--color-accent-deep)',
                  }}
                  aria-hidden
                >
                  ✓
                </span>
                <span className="text-[13px] leading-snug text-[var(--color-ink-body)]">{item}</span>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[15px] font-bold leading-relaxed text-[var(--color-ink)]">
            {t('same.punch')}
          </p>

          {/* The four notes from the design's Add-ons section. Every one is
              checkable against live config — VAT 14% inclusive, the annual
              multiplier, one trial per phone, cancel-to-period-end — so they
              ship even though the add-on price rows above them cannot. */}
          <div className="mt-4 flex flex-col gap-2">
            {notes.map((key) => (
              <p key={key} className="mkt-note text-xs leading-snug text-[var(--color-mid)]">
                {t.rich(`notes.${key}` as 'notes.vat', { b: boldPlain })}
              </p>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ─────────────────────────────────────────────────── */}
      <section className="px-6 pb-9 pt-2">
        <div className="mx-auto w-full max-w-2xl">
          <Link
            href="/signup"
            className="flex min-h-[52px] w-full items-center justify-center rounded-xl text-[15px] font-bold text-[var(--color-paper)]"
            style={{ backgroundColor: 'var(--color-accent)' }}
          >
            {t('ctaSignup')}
          </Link>
          <Link
            href="/talk-to-us"
            className="mt-2 flex min-h-[52px] w-full items-center justify-center rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] text-[15px] font-semibold text-[var(--color-ink)]"
          >
            {t('talkToSomeoneCta')}
          </Link>
          <SummerLine
            variant="fcta"
            className="mt-3 text-center text-[11px] leading-snug text-[var(--color-muted)]"
          />
        </div>
      </section>

      <MarketingFooter howItWorksHref="/" />
    </main>
  );
}
