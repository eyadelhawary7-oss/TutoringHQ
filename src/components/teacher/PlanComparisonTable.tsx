'use client';

import { Fragment } from 'react';
import { useTranslations } from 'next-intl';
import { Check, X } from 'lucide-react';
import { Link } from '@/i18n/routing';

/** [free, standard, pro] availability of a feature row. */
type Avail = [boolean, boolean, boolean];

/**
 * Free / Standard / Pro feature comparison table for the public teacher
 * pricing page. Sits below the plan cards (does not replace them). Center
 * tracking is free on every tier; the private engine unlocks at Standard;
 * guest attendees + unlimited + analytics are Pro only.
 */
export default function PlanComparisonTable() {
  const t = useTranslations('pricing');

  const sections: { title: string; rows: { label: string; avail: Avail }[] }[] = [
    {
      title: t('sectionCenterTracking'),
      rows: [
        { label: t('rowViewCenters'), avail: [true, true, true] },
        { label: t('rowGroupsPerCenter'), avail: [true, true, true] },
        { label: t('rowCenterAttendance'), avail: [true, true, true] },
        { label: t('rowCenterEarnings'), avail: [true, true, true] },
      ],
    },
    {
      title: t('sectionPrivateEngine'),
      rows: [
        { label: t('rowCreateGroups'), avail: [false, true, true] },
        { label: t('rowAutoBilling'), avail: [false, true, true] },
        { label: t('rowPaymentLinks'), avail: [false, true, true] },
        { label: t('rowSchedule'), avail: [false, true, true] },
        { label: t('rowCaps'), avail: [false, true, true] },
        { label: t('rowRegisteredOnly'), avail: [false, true, false] },
      ],
    },
    {
      title: t('sectionProOnly'),
      rows: [
        { label: t('rowGuestAttendees'), avail: [false, false, true] },
        { label: t('rowUnlimited'), avail: [false, false, true] },
        { label: t('rowFullIncome'), avail: [false, false, true] },
        { label: t('rowAnalytics'), avail: [false, false, true] },
        { label: t('rowWhatsappCredit'), avail: [false, false, true] },
        { label: t('rowStudentNotes'), avail: [false, false, true] },
        { label: t('rowCsvExport'), avail: [false, false, true] },
      ],
    },
  ];

  const cell = (ok: boolean) =>
    ok ? (
      <span
        role="img"
        aria-label={t('featureAvailable')}
        className="mx-auto flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-teal)] text-white"
      >
        <Check size={12} aria-hidden />
      </span>
    ) : (
      <span
        role="img"
        aria-label={t('featureUnavailable')}
        className="mx-auto flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-surface-2)] text-[var(--color-text-muted)]"
      >
        <X size={12} aria-hidden />
      </span>
    );

  return (
    <section className="mt-14">
      <h2 className="mb-6 text-center text-xl font-bold text-[var(--color-text-primary)] md:text-2xl">
        {t('comparisonTitle')}
      </h2>
      <div className="overflow-x-auto pb-2">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[var(--color-surface-1)] shadow-[0_1px_0_var(--color-border)]">
              <th className="p-3 text-start" />
              <th className="p-3 text-center align-top">
                <div className="font-bold text-[var(--color-text-primary)]">{t('freePlan')}</div>
              </th>
              <th className="p-3 text-center align-top">
                <div className="font-bold text-[var(--color-text-primary)]">{t('standardName')}</div>
                <div className="num text-xs text-[var(--color-text-muted)]">{t('standardPrice')}</div>
              </th>
              <th className="p-3 text-center align-top">
                <div className="flex items-center justify-center gap-1.5">
                  <span className="font-bold text-[var(--color-text-primary)]">{t('proName')}</span>
                  <span className="rounded-full bg-[var(--color-brass)] px-2 py-0.5 text-[10px] font-medium text-white">
                    {t('mostComprehensive')}
                  </span>
                </div>
                <div className="num text-xs text-[var(--color-text-muted)]">{t('proPrice')}</div>
              </th>
            </tr>
          </thead>
          <tbody>
            {sections.map((section) => (
              <Fragment key={section.title}>
                <tr>
                  <td
                    colSpan={4}
                    className="bg-[var(--color-surface-2)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]"
                  >
                    {section.title}
                  </td>
                </tr>
                {section.rows.map((row, i) => (
                  <tr
                    key={row.label}
                    className={i % 2 === 0 ? 'bg-[var(--color-surface-0)]' : 'bg-[var(--color-surface-1)]'}
                  >
                    <td className="px-3 py-2.5 text-start text-[var(--color-text-secondary)]">
                      {row.label}
                    </td>
                    <td className="px-3 py-2.5">{cell(row.avail[0])}</td>
                    <td className="px-3 py-2.5">{cell(row.avail[1])}</td>
                    <td className="px-3 py-2.5">{cell(row.avail[2])}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
            <tr>
              <td className="px-3 py-4" />
              <td className="px-3 py-4 text-center align-top">
                <Link
                  href="/teacher/signup"
                  className="inline-flex w-full justify-center rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface-0)] px-4 py-2.5 text-xs font-semibold text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-2)] btn-press chq-focus"
                >
                  {t('freeColumnCta')}
                </Link>
              </td>
              <td className="px-3 py-4 text-center align-top">
                <Link
                  href="/teacher/signup"
                  className="inline-flex w-full justify-center rounded-xl px-4 py-2.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 btn-press chq-focus"
                  style={{ background: 'var(--color-brass)' }}
                >
                  {t('startFreeTrial')}
                </Link>
              </td>
              <td className="px-3 py-4 text-center align-top">
                <Link
                  href="/teacher/signup?plan=pro"
                  className="inline-flex w-full justify-center rounded-xl px-4 py-2.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 btn-press chq-focus"
                  style={{ background: 'var(--color-brass)' }}
                >
                  {t('startWithPro')}
                </Link>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
