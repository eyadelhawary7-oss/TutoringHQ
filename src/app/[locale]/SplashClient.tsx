'use client';

import { useLocale, useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { formatNumber } from '@/lib/formatNumber';
import { ORDERED_SUBSCRIPTION_PLAN_KEYS, PLANS } from '@/lib/pricing';
import { TEACHER_PLANS } from '@/lib/teacherPlans';
import { usePublicPlanPrices } from '@/hooks/usePublicPlanPrices';
import MarketingNav from '@/components/marketing/MarketingNav';
import Kicker from '@/components/marketing/Kicker';
import SessionRow from '@/components/marketing/SessionRow';
import TotalBar from '@/components/marketing/TotalBar';
import FaqList, { type FaqItem } from '@/components/marketing/FaqList';
import SummerBanner from '@/components/marketing/SummerBanner';
import SummerLine, { useSummerValues } from '@/components/marketing/SummerLine';
import MarketingFooter from '@/components/landing/MarketingFooter';

/**
 * The public landing page (`/`).
 *
 * The design rebuilds this page out of ONE object: the session row is the hero,
 * the proof, the two customers and the three steps. The only animation is a row
 * turning from sent to paid.
 *
 * Every figure below is illustrative placeholder, exactly as the design says of
 * its sample data. It is held in code rather than in ar.json/en.json so the two
 * message files cannot drift apart on a number, and it is rendered through
 * `formatNumber` so Arabic gets Eastern digits and the Arabic decimal mark for
 * free. Nothing on this page is fetched and nothing is a real tenant's data.
 */

/** Hero: three rows that settle from NOT YET → SENT → PAID on one tap. */
const HERO_AMOUNTS = [168.75, 168.75, 201] as const;
const HERO_TAP_COUNT = 18;

/** Paired object: the same row at both sizes. */
const CENTER_AMOUNTS = [168.75, 168.75, 168.75] as const;
const CENTER_MORE = 246;
const CENTER_COUNT = 249;
const CENTER_TOTAL = 42018.75;

const TEACHER_AMOUNTS = [168.75, 168.75, 168.75] as const;
const TEACHER_MORE = 15;
const TEACHER_COUNT = 18;
const TEACHER_TOTAL = 3037.5;

interface SampleRow {
  initials: string;
  name: string;
  sub: string;
}

export default function SplashClient() {
  const t = useTranslations('splash');
  const locale = useLocale();
  const isAr = locale === 'ar';
  const Chevron = isAr ? ChevronLeft : ChevronRight;
  const summer = useSummerValues();

  const money = (v: number) =>
    formatNumber(v, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const heroRows = t.raw('hero.rows') as SampleRow[];
  const centerRows = t.raw('pair.center.rows') as SampleRow[];
  const teacherRows = t.raw('pair.teacher.rows') as SampleRow[];
  const steps = t.raw('steps.items') as Array<{ title: string; body: string }>;

  // Two of the eight pills state a real product claim rather than a feature
  // name — the top center capacity and the entry price for a teacher's own
  // groups. Both are read from the same sources the billing engine uses
  // (`pricing_plans.weekly_student_limit` and `TEACHER_PLANS`) so the landing
  // page cannot quote a capacity or a price the product does not honour.
  const dyn = usePublicPlanPrices();
  const topPlanKey = ORDERED_SUBSCRIPTION_PLAN_KEYS[ORDERED_SUBSCRIPTION_PLAN_KEYS.length - 1];
  const topCap = dyn[topPlanKey].weeklyStudentLimit ?? PLANS[topPlanKey].weeklyStudentLimit;
  const centerPills = [
    topCap != null ? t('pair.center.pillCapacity', { count: formatNumber(topCap, locale) }) : null,
    ...(t.raw('pair.center.pills') as string[]),
  ].filter((p): p is string => p !== null);
  const rawTeacherPills = t.raw('pair.teacher.pills') as string[];
  const teacherPills = [
    rawTeacherPills[0],
    t('pair.teacher.pillPrice', {
      price: formatNumber(TEACHER_PLANS.teacher_standard.priceGross, locale),
    }),
    ...rawTeacherPills.slice(1),
  ];

  // "What happens after summer" is composed from live summer config, so when
  // summer mode is off the question drops out entirely rather than answering
  // with a stale August date. It sits fifth in the design's running order.
  const faqItems = t.raw('faq.items') as FaqItem[];
  const faq: FaqItem[] = summer
    ? [
        ...faqItems.slice(0, 4),
        { q: t('faq.summerQ'), a: t('faq.summerA', summer) },
        ...faqItems.slice(4),
      ]
    : faqItems;
  const openIndexes = summer ? [0, 4] : [0];

  return (
    <main
      dir={isAr ? 'rtl' : 'ltr'}
      className="flex min-h-screen w-full flex-col bg-[var(--color-paper)] text-[var(--color-ink-body)]"
    >
      <SummerBanner />
      <MarketingNav tone="center" />

      {/* ── Hero: the object, and one tap that settles it ─────────────── */}
      <section className="px-6 pb-[38px] pt-[34px]">
        <div className="mx-auto w-full max-w-2xl">
          <Kicker>{t('kick')}</Kicker>
          <h1 className="m-0 text-[30px] font-bold leading-[1.18] tracking-[-.015em] text-[var(--color-ink)] rtl:leading-[1.22] rtl:tracking-normal">
            {t('headline')}
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-[var(--color-ink-body)]">{t('lede')}</p>

          <div className="mt-7">
            <button
              type="button"
              className="mkt-tapbtn mb-2 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl text-[15px] font-bold text-[var(--color-paper)]"
              style={{ backgroundColor: 'var(--color-accent)' }}
              aria-hidden
              tabIndex={-1}
            >
              {t('hero.tapCta')}
              <span className="mkt-mono rounded-full bg-[#ECE8DF38] px-3 py-1 text-xs">
                {formatNumber(HERO_TAP_COUNT, locale)}
              </span>
            </button>

            <div className="mkt-settle flex flex-col gap-2">
              {heroRows.map((row, i) => (
                <SessionRow
                  key={row.name}
                  className="mkt-res"
                  avClassName="mkt-av"
                  tone="quiet"
                  initials={row.initials}
                  name={row.name}
                  sub={row.sub}
                  value={money(HERO_AMOUNTS[i])}
                  status={
                    <span className="relative block h-[13px]">
                      <span className="mkt-st-n absolute end-0 top-0 text-[var(--color-faint)]">
                        {t('hero.statusNotYet')}
                      </span>
                      <span className="mkt-st-p absolute end-0 top-0 text-[var(--color-brass)]">
                        {t('hero.statusSent')}
                      </span>
                      <span className="mkt-st-d absolute end-0 top-0 text-[var(--color-accent)]">
                        {t('hero.statusPaid')}
                      </span>
                    </span>
                  }
                >
                  <span className="relative h-[21px] w-[21px] shrink-0" aria-hidden>
                    <span className="mkt-r-n absolute inset-0 rounded-full border-[1.5px] border-[var(--color-line)]" />
                    <span className="mkt-r-p absolute inset-0 rounded-full border-[1.5px] border-dashed border-[var(--color-brass)]" />
                    <span className="mkt-r-d absolute inset-0 grid place-items-center rounded-full bg-[var(--color-accent)] text-xs text-white">
                      ✓
                    </span>
                  </span>
                </SessionRow>
              ))}
            </div>
          </div>

          <p className="mt-4 text-xs leading-relaxed text-[var(--color-mid)]">
            {t.rich('sigcap', {
              b: (chunks) => <b className="font-semibold text-[var(--color-ink)]">{chunks}</b>,
            })}
          </p>

          <div className="mt-6 flex flex-col gap-2">
            <Link
              href="/signup"
              className="flex min-h-[52px] w-full items-center justify-center rounded-xl text-[15px] font-bold text-[var(--color-paper)]"
              style={{ backgroundColor: 'var(--color-accent)' }}
            >
              {t('cta.startFree')}
            </Link>
            <a
              href="#steps"
              className="flex min-h-[52px] w-full items-center justify-center rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] text-[15px] font-semibold text-[var(--color-ink)]"
            >
              {t('cta.seeHow')}
            </a>
          </div>
          <SummerLine className="mt-3 text-center text-[11px] text-[var(--color-muted)]" />
        </div>
      </section>

      {/* ── The same row, at both sizes ───────────────────────────────── */}
      <section
        className="border-y border-[var(--color-line)] px-6 py-12"
        style={{ backgroundColor: 'var(--color-tile)' }}
      >
        <div className="mx-auto w-full max-w-2xl">
          <Kicker>{t('pair.kick')}</Kicker>
          <h2 className="m-0 text-[22px] font-bold leading-snug tracking-[-.01em] text-[var(--color-ink)] rtl:tracking-normal">
            {t('pair.heading')}
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-[var(--color-ink-body)]">
            {t('pair.lede')}
          </p>

          <div className="mt-6 flex flex-col gap-3">
            {/* A center */}
            <div
              className="rounded-2xl border bg-[var(--color-panel)] px-4 pb-6 pt-4"
              style={{ borderColor: 'var(--color-mint-deep)' }}
            >
              <span
                className="mb-3 inline-flex items-center rounded-full px-3 py-2 text-[11px] font-bold uppercase tracking-[.1em] rtl:normal-case rtl:tracking-[.02em]"
                style={{ backgroundColor: 'var(--color-mint)', color: 'var(--color-accent-deep)' }}
              >
                {t('pair.center.label')}
              </span>
              <div className="flex flex-col gap-2">
                {centerRows.map((row, i) => (
                  <SessionRow
                    key={row.name}
                    compact
                    initials={row.initials}
                    name={row.name}
                    sub={row.sub}
                    value={money(CENTER_AMOUNTS[i])}
                  />
                ))}
              </div>
              <div className="mt-1 flex items-center justify-between gap-2 px-1 pt-3">
                <span className="text-[11px] text-[var(--color-muted)]">
                  {t('pair.center.more', { count: formatNumber(CENTER_MORE, locale) })}
                </span>
                <span className="mkt-mono text-[13px] text-[var(--color-ink)]">
                  {formatNumber(CENTER_COUNT, locale)}
                </span>
              </div>
              <TotalBar label={t('pair.totalLabel')} value={money(CENTER_TOTAL)} />
              <p className="mt-3 text-[13px] leading-relaxed text-[var(--color-mid)]">
                {t('pair.center.body')}
              </p>
              <div className="mt-3 flex flex-wrap gap-1">
                {centerPills.map((pill) => (
                  <span
                    key={pill}
                    className="rounded-full px-3 py-2 text-[11px] font-semibold"
                    style={{ backgroundColor: 'var(--color-mint)', color: 'var(--color-accent-deep)' }}
                  >
                    {pill}
                  </span>
                ))}
              </div>
              <Link
                href="/centers"
                className="mt-3 inline-flex items-center gap-1 text-[13px] font-bold"
                style={{ color: 'var(--color-accent-deep)' }}
              >
                {t('pair.center.link')}
                <Chevron size={14} aria-hidden />
              </Link>
            </div>

            {/* A teacher */}
            <div
              className="rounded-2xl border bg-[var(--color-panel)] px-4 pb-6 pt-4"
              style={{ borderColor: 'var(--color-canvas)' }}
            >
              <span
                className="mb-3 inline-flex items-center rounded-full px-3 py-2 text-[11px] font-bold uppercase tracking-[.1em] rtl:normal-case rtl:tracking-[.02em]"
                style={{ backgroundColor: 'var(--color-sand)', color: 'var(--color-brass)' }}
              >
                {t('pair.teacher.label')}
              </span>
              <div className="flex flex-col gap-2">
                {teacherRows.map((row, i) => (
                  <SessionRow
                    key={row.name}
                    compact
                    tone="teacher"
                    initials={row.initials}
                    name={row.name}
                    sub={row.sub}
                    value={money(TEACHER_AMOUNTS[i])}
                  />
                ))}
              </div>
              <div className="mt-1 flex items-center justify-between gap-2 px-1 pt-3">
                <span className="text-[11px] text-[var(--color-muted)]">
                  {t('pair.teacher.more', { count: formatNumber(TEACHER_MORE, locale) })}
                </span>
                <span className="mkt-mono text-[13px] text-[var(--color-ink)]">
                  {formatNumber(TEACHER_COUNT, locale)}
                </span>
              </div>
              <TotalBar label={t('pair.totalLabel')} value={money(TEACHER_TOTAL)} />
              <p className="mt-3 text-[13px] leading-relaxed text-[var(--color-mid)]">
                {t('pair.teacher.body')}
              </p>
              <div className="mt-3 flex flex-wrap gap-1">
                {teacherPills.map((pill) => (
                  <span
                    key={pill}
                    className="rounded-full px-3 py-2 text-[11px] font-semibold"
                    style={{ backgroundColor: 'var(--color-sand)', color: 'var(--color-brass)' }}
                  >
                    {pill}
                  </span>
                ))}
              </div>
              <Link
                href="/teachers"
                className="mt-3 inline-flex items-center gap-1 text-[13px] font-bold"
                style={{ color: 'var(--color-brass)' }}
              >
                {t('pair.teacher.link')}
                <Chevron size={14} aria-hidden />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── Three steps ───────────────────────────────────────────────── */}
      <section id="steps" className="scroll-mt-4 px-6 py-12">
        <div className="mx-auto w-full max-w-2xl">
          <Kicker>{t('steps.kick')}</Kicker>
          <h2 className="m-0 text-[22px] font-bold leading-snug tracking-[-.01em] text-[var(--color-ink)] rtl:tracking-normal">
            {t('steps.heading')}
          </h2>
          <div className="mt-6 flex flex-col gap-2">
            {steps.map((step, i) => (
              <div
                key={step.title}
                className="flex items-start gap-3 rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] p-4"
              >
                <span
                  className="mkt-mono grid shrink-0 place-items-center rounded-full text-xs text-white"
                  style={{ width: 27, height: 27, backgroundColor: 'var(--color-accent)' }}
                  aria-hidden
                >
                  {formatNumber(i + 1, locale)}
                </span>
                <span>
                  <span className="block text-[15px] font-bold leading-tight text-[var(--color-ink)]">
                    {step.title}
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-[var(--color-mid)]">
                    {step.body}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ───────────────────────────────────────────────────────── */}
      <section className="px-6 pb-[42px] pt-2">
        <div className="mx-auto w-full max-w-2xl">
          <Kicker>{t('faq.kick')}</Kicker>
          <h2 className="m-0 text-[22px] font-bold leading-snug tracking-[-.01em] text-[var(--color-ink)] rtl:tracking-normal">
            {t('faq.heading')}
          </h2>
          <FaqList items={faq} defaultOpen={openIndexes} />
        </div>
      </section>

      {/* ── Trust ─────────────────────────────────────────────────────── */}
      <section
        className="px-6 py-12 text-center"
        style={{ backgroundColor: 'var(--color-ground)', color: 'var(--color-paper)' }}
      >
        <div className="mx-auto w-full max-w-2xl">
          <span
            className="mx-auto mb-4 grid place-items-center rounded-full"
            style={{ width: 44, height: 44, backgroundColor: 'rgba(236,232,223,.11)' }}
            aria-hidden
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#ECE8DF"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 3l7 3v6c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6z" />
            </svg>
          </span>
          <h2 className="m-0 text-[22px] font-bold leading-snug tracking-[-.01em] text-white rtl:tracking-normal">
            {t('trust.heading')}
          </h2>
          <p
            className="mx-auto mt-3 max-w-[34ch] text-[13px] leading-relaxed"
            style={{ color: 'rgba(236,232,223,.76)' }}
          >
            {t('trust.body')}
          </p>
        </div>
      </section>

      {/* ── Final CTA ─────────────────────────────────────────────────── */}
      <section className="px-6 py-9">
        <div className="mx-auto w-full max-w-2xl">
          <Link
            href="/signup"
            className="flex min-h-[52px] w-full items-center justify-center rounded-xl text-[15px] font-bold text-[var(--color-paper)]"
            style={{ backgroundColor: 'var(--color-accent)' }}
          >
            {t('cta.startFree')}
          </Link>
          <SummerLine className="mt-3 text-center text-[11px] text-[var(--color-muted)]" />
        </div>
      </section>

      <MarketingFooter howItWorksHref="#steps" />
    </main>
  );
}
