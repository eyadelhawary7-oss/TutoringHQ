'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { formatNumber } from '@/lib/formatNumber';
import { ORDERED_SUBSCRIPTION_PLAN_KEYS, PLANS } from '@/lib/pricing';
import { usePublicPlanPrices } from '@/hooks/usePublicPlanPrices';
import MarketingNav from '@/components/marketing/MarketingNav';
import Kicker from '@/components/marketing/Kicker';
import SessionRow from '@/components/marketing/SessionRow';
import TotalBar from '@/components/marketing/TotalBar';
import DoesCard, { type DoesItem } from '@/components/marketing/DoesCard';
import ComparisonCards from '@/components/marketing/ComparisonCards';
import PlanRows from '@/components/marketing/PlanRows';
import FaqList, { type FaqItem } from '@/components/marketing/FaqList';
import SummerLine from '@/components/marketing/SummerLine';
import MarketingFooter from '@/components/landing/MarketingFooter';

/**
 * `/centers` — the center audience page.
 *
 * Struck by the design and gone from this rebuild: the "#1 tutoring center
 * management platform in Egypt" badge, the "Trusted nationwide" band, the
 * animated phone-mockup dashboard (whose 247→250 ticking student counter was a
 * fabricated live number), the six icon feature cards, and the admin-hours row
 * in the comparison. All of it was unsourced.
 *
 * Sample figures are illustrative placeholders held in code, rendered through
 * `formatNumber`. The PRICES are not: they come from `pricing_plans` via
 * `usePublicPlanPrices()`, so what this page quotes is what the billing engine
 * charges.
 */

const PROOF_AMOUNT = 168.75;
const PROOF_TOTAL = 42018.75;
const PROOF_COUNT = 249;

interface SampleRow {
  initials: string;
  name: string;
  sub: string;
}

export default function CentersClient() {
  const t = useTranslations('landing');
  const tCompare = useTranslations('landing.compare');
  const locale = useLocale();
  const isAr = locale === 'ar';
  const dyn = usePublicPlanPrices();

  const money = (v: number) =>
    formatNumber(v, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const proofRows = t.raw('centers.proofRows') as SampleRow[];
  const scanItems = t.raw('oneScan.items') as DoesItem[];
  const onlyRows = t.raw('centerOnly.rows') as Array<{ name: string; sub: string }>;
  const dataCells = t.raw('data.cells') as Array<{ title: string; body: string }>;
  const faq = (['q1', 'q2', 'q3', 'q4'] as const).map<FaqItem>((k) => ({
    q: t(`faq.${k}.question` as 'faq.q1.question'),
    a: t(`faq.${k}.answer` as 'faq.q1.answer'),
  }));

  const planRows = ORDERED_SUBSCRIPTION_PLAN_KEYS.map((key) => {
    const plan = PLANS[key];
    const live = dyn[key];
    // weekly_student_limit is the live capacity column; the constant is the
    // compile-time fallback the hook seeds state with.
    const cap = live.weeklyStudentLimit ?? plan.weeklyStudentLimit;
    return {
      id: key,
      name: isAr ? plan.arabicName : plan.englishName,
      capacity:
        cap != null ? t('plans.capacity', { count: formatNumber(cap, locale) }) : '',
      price: formatNumber(live.quarterlyAllIn, locale),
    };
  });

  const sectionHead = 'm-0 text-[22px] font-bold leading-snug tracking-[-.01em] text-[var(--color-ink)] rtl:tracking-normal';
  const tileSection = 'border-y border-[var(--color-line)] px-6 py-12';

  return (
    <main
      dir={isAr ? 'rtl' : 'ltr'}
      className="flex min-h-screen w-full flex-col bg-[var(--color-paper)] text-[var(--color-ink-body)]"
    >
      <MarketingNav tone="center" />

      {/* ── Hero: the door tells the system ───────────────────────────── */}
      <section className="px-6 pb-[34px] pt-[30px]">
        <div className="mx-auto w-full max-w-2xl">
          <Kicker tone="accent">{t('centers.kick')}</Kicker>
          <h1 className="m-0 text-[30px] font-bold leading-tight tracking-[-.015em] text-[var(--color-ink)] rtl:tracking-normal">
            {t('centers.heroTitle')}
          </h1>
          <p className="mt-3 text-[13px] leading-relaxed text-[var(--color-ink-body)]">
            {t('centers.heroSub')}
          </p>

          <div className="mt-6 flex flex-col gap-2">
            {proofRows.map((row) => (
              <SessionRow
                key={row.name}
                initials={row.initials}
                name={row.name}
                sub={row.sub}
                value={money(PROOF_AMOUNT)}
                status={t('centers.billed')}
              />
            ))}
            <TotalBar
              variant="filled"
              label={t('centers.inTonight', { count: formatNumber(PROOF_COUNT, locale) })}
              value={money(PROOF_TOTAL)}
            />
          </div>

          <div className="mt-6 flex flex-col gap-2">
            <Link
              href="/signup"
              className="flex min-h-[52px] w-full items-center justify-center rounded-xl text-[15px] font-bold text-[var(--color-paper)]"
              style={{ backgroundColor: 'var(--color-accent)' }}
            >
              {t('centers.ctaStart')}
            </Link>
            <Link
              href="/pricing"
              className="flex min-h-[52px] w-full items-center justify-center rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] text-[15px] font-semibold text-[var(--color-ink)]"
            >
              {t('centers.ctaPricing')}
            </Link>
          </div>
          <SummerLine
            variant="freeAndFirst"
            className="mt-2 text-center text-[11px] leading-snug text-[var(--color-muted)]"
          />
        </div>
      </section>

      {/* ── What one scan actually does ───────────────────────────────── */}
      <section className={tileSection} style={{ backgroundColor: 'var(--color-tile)' }}>
        <div className="mx-auto w-full max-w-2xl">
          <Kicker tone="accent">{t('oneScan.kick')}</Kicker>
          <h2 className={sectionHead}>{t('oneScan.heading')}</h2>
          <DoesCard items={scanItems} />
        </div>
      </section>

      {/* ── Center only ───────────────────────────────────────────────── */}
      <section className="px-6 py-12">
        <div className="mx-auto w-full max-w-2xl">
          <Kicker tone="accent">{t('centerOnly.kick')}</Kicker>
          <h2 className={sectionHead}>{t('centerOnly.heading')}</h2>
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
          <Kicker tone="accent">{t('compare.kick')}</Kicker>
          <h2 className={sectionHead}>{t('compare.heading')}</h2>
          <ComparisonCards t={tCompare} rowCount={6} />
        </div>
      </section>

      {/* ── Priced by size ────────────────────────────────────────────── */}
      <section className="px-6 py-12">
        <div className="mx-auto w-full max-w-2xl">
          <Kicker tone="accent">{t('plans.kick')}</Kicker>
          <h2 className={sectionHead}>{t('plans.heading')}</h2>
          <p className="mt-3 text-[13px] leading-relaxed text-[var(--color-mid)]">
            {t('plans.body')}
          </p>
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

      {/* ── Your data ─────────────────────────────────────────────────── */}
      <section className={tileSection} style={{ backgroundColor: 'var(--color-tile)' }}>
        <div className="mx-auto w-full max-w-2xl">
          <Kicker tone="accent">{t('data.kick')}</Kicker>
          <h2 className={sectionHead}>{t('data.heading')}</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {dataCells.map((cell) => (
              <div
                key={cell.title}
                className="min-w-[45%] flex-1 rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] p-4"
              >
                <span className="block text-xs font-bold leading-tight text-[var(--color-ink)]">
                  {cell.title}
                </span>
                <span className="mt-1 block text-[11px] leading-snug text-[var(--color-muted)]">
                  {cell.body}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ───────────────────────────────────────────────────────── */}
      <section className="px-6 pb-[38px] pt-2">
        <div className="mx-auto w-full max-w-2xl">
          <Kicker tone="accent">{t('faq.kick')}</Kicker>
          <h2 className={sectionHead}>{t('faq.heading')}</h2>
          <FaqList items={faq} defaultOpen={[0, 1]} />
        </div>
      </section>

      <MarketingFooter howItWorksHref="/" />
    </main>
  );
}
