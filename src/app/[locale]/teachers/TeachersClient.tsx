'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { formatNumber } from '@/lib/formatNumber';
import { TEACHER_PLANS } from '@/lib/teacherPlans';
import MarketingNav from '@/components/marketing/MarketingNav';
import Kicker from '@/components/marketing/Kicker';
import SessionRow from '@/components/marketing/SessionRow';
import TotalBar from '@/components/marketing/TotalBar';
import DoesCard, { type DoesItem } from '@/components/marketing/DoesCard';
import ComparisonCards from '@/components/marketing/ComparisonCards';
import PlanRows, { type PlanRow } from '@/components/marketing/PlanRows';
import FaqList, { type FaqItem } from '@/components/marketing/FaqList';
import MarketingFooter from '@/components/landing/MarketingFooter';

/**
 * `/teachers` — the teacher audience page.
 *
 * Start free points at `/teacher/signup`, not `/signup`. The design routes
 * every Start free on all four screens to `/signup`, but `/signup` is
 * center-only: its first step requires a center name, and a teacher who lands
 * there cannot complete it. Built literally, this page would make the paid
 * teacher product unreachable from marketing. One attribute deviates; the
 * entry point survives.
 *
 * Income figures are illustrative placeholders. Plan prices, caps, the trial
 * length and the Scale overage rate all come from `TEACHER_PLANS`, which is the
 * same source the billing engine charges from.
 */

const FROM_CENTERS = 84500;
const OWN_GROUPS = 54000;
const MONTH_TOTAL = 138500;

export default function TeachersClient({ referralCode = null }: { referralCode?: string | null }) {
  const t = useTranslations('teacherLanding');
  const tCompare = useTranslations('teacherLanding.compare');
  const locale = useLocale();
  const isAr = locale === 'ar';

  const signupHref = referralCode
    ? `/teacher/signup?ref=${encodeURIComponent(referralCode)}`
    : '/teacher/signup';

  const eveningItems = t.raw('evening.items') as DoesItem[];
  const onlyRows = t.raw('teacherOnly.rows') as Array<{ name: string; sub: string }>;
  const faq = (['q1', 'q2', 'q3', 'q4'] as const).map<FaqItem>((k) => ({
    q: t(`faq.${k}.question` as 'faq.q1.question'),
    a: t(`faq.${k}.answer` as 'faq.q1.answer'),
  }));

  const standard = TEACHER_PLANS.teacher_standard;
  const pro = TEACHER_PLANS.teacher_pro;
  const scale = TEACHER_PLANS.teacher_scale;

  const planRows: PlanRow[] = [
    {
      id: 'free',
      name: t('plans.freeName'),
      capacity: t('plans.freeCapacity'),
      price: t('plans.freePrice'),
    },
    {
      id: 'standard',
      name: t('plans.standardName'),
      capacity: t('plans.standardCapacity', {
        count: formatNumber(standard.studentCap, locale),
        days: formatNumber(standard.trialDays, locale),
      }),
      price: formatNumber(standard.priceGross, locale),
    },
    {
      id: 'pro',
      name: t('plans.proName'),
      capacity: t('plans.proCapacity', { count: formatNumber(pro.studentCap, locale) }),
      price: formatNumber(pro.priceGross, locale),
    },
    {
      id: 'scale',
      name: t('plans.scaleName'),
      // Cap and overage are read from the plan definition, never typed in: the
      // design's "150 a week, then 16 each" does not match what Scale actually
      // bills, and the page must state the rate the invoice will use.
      capacity: t('plans.scaleCapacity', {
        count: formatNumber(scale.studentCap, locale),
        each: formatNumber(scale.overagePerStudent, locale),
      }),
      price: formatNumber(scale.priceGross, locale),
    },
  ];

  const money = (v: number) => formatNumber(v, locale);
  const sectionHead = 'm-0 text-[22px] font-bold leading-snug tracking-[-.01em] text-[var(--color-ink)] rtl:tracking-normal';
  const tileSection = 'border-y border-[var(--color-line)] px-6 py-12';

  return (
    <main
      dir={isAr ? 'rtl' : 'ltr'}
      className="flex min-h-screen w-full flex-col bg-[var(--color-paper)] text-[var(--color-ink-body)]"
    >
      <MarketingNav tone="teacher" />

      {/* ── Hero: every pound, one screen ─────────────────────────────── */}
      <section className="px-6 pb-[34px] pt-[30px]">
        <div className="mx-auto w-full max-w-2xl">
          <Kicker>{t('kick')}</Kicker>
          <h1 className="m-0 text-[30px] font-bold leading-tight tracking-[-.015em] text-[var(--color-ink)] rtl:tracking-normal">
            {t('heroTitle')}
          </h1>
          <p className="mt-3 text-[13px] leading-relaxed text-[var(--color-ink-body)]">
            {t('heroSub')}
          </p>

          <div className="mt-6 flex flex-col gap-2">
            <SessionRow
              tone="teacher"
              initials={t('income.centerInitials')}
              name={t('income.centerName')}
              sub={t('income.centerSub')}
              value={money(FROM_CENTERS)}
            />
            <SessionRow
              tone="teacher"
              initials={t('income.ownInitials')}
              name={t('income.ownName')}
              sub={t('income.ownSub')}
              value={money(OWN_GROUPS)}
            />
            <TotalBar
              variant="filled"
              tone="teacher"
              label={t('income.totalLabel')}
              value={money(MONTH_TOTAL)}
            />
          </div>

          <div className="mt-6 flex flex-col gap-2">
            <Link
              href={signupHref}
              className="flex min-h-[52px] w-full items-center justify-center rounded-xl text-[15px] font-bold text-[var(--color-paper)]"
              style={{ backgroundColor: 'var(--color-brass)' }}
            >
              {t('ctaPrimary')}
            </Link>
            <Link
              href="/pricing"
              className="flex min-h-[52px] w-full items-center justify-center rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] text-[15px] font-semibold text-[var(--color-ink)]"
            >
              {t('ctaPricing')}
            </Link>
          </div>
          {/* A permanent policy statement, not a summer date — so it is a plain
              message key and does not disappear with summer mode. */}
          <p className="mt-2 text-center text-[11px] leading-snug text-[var(--color-muted)]">
            {t('freeForever')}
          </p>
        </div>
      </section>

      {/* ── The evening ───────────────────────────────────────────────── */}
      <section className={tileSection} style={{ backgroundColor: 'var(--color-tile)' }}>
        <div className="mx-auto w-full max-w-2xl">
          <Kicker>{t('evening.kick')}</Kicker>
          <h2 className={sectionHead}>{t('evening.heading')}</h2>
          <p className="mt-3 text-[13px] leading-relaxed text-[var(--color-mid)]">
            {t('evening.body')}
          </p>
          <DoesCard items={eveningItems} tone="teacher" />
        </div>
      </section>

      {/* ── Teacher only ──────────────────────────────────────────────── */}
      <section className="px-6 py-12">
        <div className="mx-auto w-full max-w-2xl">
          <Kicker>{t('teacherOnly.kick')}</Kicker>
          <h2 className={sectionHead}>{t('teacherOnly.heading')}</h2>
          <div className="mt-5 flex flex-col gap-2">
            {onlyRows.map((row) => (
              <SessionRow key={row.name} name={row.name} sub={row.sub} />
            ))}
          </div>
        </div>
      </section>

      {/* ── Against what you use now ──────────────────────────────────── */}
      <section className={tileSection} style={{ backgroundColor: 'var(--color-tile)' }}>
        <div className="mx-auto w-full max-w-2xl">
          <Kicker>{t('compare.kick')}</Kicker>
          <h2 className={sectionHead}>{t('compare.heading')}</h2>
          <ComparisonCards t={tCompare} rowCount={6} tone="teacher" />
        </div>
      </section>

      {/* ── Priced by size ────────────────────────────────────────────── */}
      <section className="px-6 py-12">
        <div className="mx-auto w-full max-w-2xl">
          <Kicker>{t('plans.kick')}</Kicker>
          <h2 className={sectionHead}>{t('plans.heading')}</h2>
          <PlanRows rows={planRows} />
          <div className="mt-6">
            <Link
              href="/pricing"
              className="flex min-h-[52px] w-full items-center justify-center rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] text-[15px] font-semibold text-[var(--color-ink)]"
            >
              {t('plans.cta')}
            </Link>
          </div>
          <p className="mt-2 text-center text-[11px] leading-snug text-[var(--color-muted)]">
            {t('plans.undercta')}
          </p>
        </div>
      </section>

      {/* ── FAQ ───────────────────────────────────────────────────────── */}
      <section className="px-6 pb-[38px] pt-2">
        <div className="mx-auto w-full max-w-2xl">
          <Kicker>{t('faq.kick')}</Kicker>
          <h2 className={sectionHead}>{t('faq.heading')}</h2>
          <FaqList items={faq} defaultOpen={[0, 1]} />
        </div>
      </section>

      <MarketingFooter howItWorksHref="/" tone="teacher" createAccountHref={signupHref} />
    </main>
  );
}
