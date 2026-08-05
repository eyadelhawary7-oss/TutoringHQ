'use client';

/**
 * `Merged-Admin-Platform` §03, vendors frame — INTEGRATIONS + the per-service
 * detail card.
 *
 * The design puts this on a screen it calls "Vendors". It is NOT built on
 * `/admin/vendors`: that route is the card-PRINTING supplier record
 * (`vendors` = `name`, `whatsapp_number`, `pickup_address`, `city`,
 * `is_active` — verified live, 4 August 2026), a completely different meaning
 * of the word. Putting a service-health list next to a print-supplier form
 * would merge two unrelated concepts under one heading. It lives on
 * `/admin/platform-config`, the screen §03's other frame already maps to.
 *
 * Which services appear, and which of the design's four are deliberately
 * absent, is documented on `src/lib/adminIntegrationHealth.ts` — the short
 * version is that only three services are pinged and none of them is a vendor
 * API, so they are named for what is actually measured.
 */

import { useLocale, useTranslations } from 'next-intl';
import { formatNumber, formatRelativeMinutesAgo } from '@/lib/formatNumber';
import type { IntegrationHealthView } from '@/lib/adminIntegrationHealth';

interface Props {
  integrations: IntegrationHealthView[] | null;
}

const DOT_TONE: Record<IntegrationHealthView['status'], string> = {
  operational: 'bg-emerald-600',
  degraded: 'bg-[var(--color-brass)]',
  outage: 'bg-red-600',
  unknown: 'bg-[var(--color-navy-500)]',
};

const TEXT_TONE: Record<IntegrationHealthView['status'], string> = {
  operational: 'text-emerald-700',
  degraded: 'text-[var(--color-brass)]',
  outage: 'text-red-600',
  unknown: 'text-[var(--color-text-muted)]',
};

export default function IntegrationHealthPanel({ integrations }: Props) {
  const t = useTranslations('admin.integrationHealth');
  const locale = useLocale();

  if (!integrations || integrations.length === 0) return null;

  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold text-[var(--color-text-primary)]">{t('heading')}</h2>

      <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)]">
        {integrations.map((row, i) => (
          <div
            key={row.service}
            className={`px-4 py-3 ${i > 0 ? 'border-t border-[var(--color-border)]' : ''}`}
          >
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                  {t(`service_${row.service}` as 'service_api')}
                </p>
                <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                  {t(`purpose_${row.service}` as 'purpose_api')}
                </p>
              </div>
              <span className={`flex shrink-0 items-center gap-2 text-xs font-semibold ${TEXT_TONE[row.status]}`}>
                <span className={`inline-block h-2 w-2 rounded-full ${DOT_TONE[row.status]}`} aria-hidden />
                {t(`status_${row.status}` as 'status_operational')}
              </span>
            </div>

            {/*
              The design's PAYMOB DETAIL card, inlined per service rather than
              pinned to one. Every field here is measured; Merchant ID is not
              drawn because it is an environment credential, not a column.

              A null success rate renders as an em dash, never as 0% — no pings
              in the window means unmeasured, and 0% would read as total failure.
            */}
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-[var(--color-border-subtle)] pt-3 text-xs">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-[var(--color-text-muted)]">{t('lastCheck')}</dt>
                <dd className="text-[var(--color-text-primary)]">
                  {row.lastCheckedAt ? formatRelativeMinutesAgo(row.lastCheckedAt, locale) : '—'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-[var(--color-text-muted)]">{t('successRate24h')}</dt>
                <dd className="text-[var(--color-text-primary)]">
                  {row.successRate24h != null
                    ? t('percentOfChecks', {
                        pct: formatNumber(row.successRate24h, locale),
                        checks: formatNumber(row.checks24h, locale),
                      })
                    : '—'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-[var(--color-text-muted)]">{t('responseTime')}</dt>
                <dd className="text-[var(--color-text-primary)]">
                  {row.lastResponseMs != null
                    ? t('milliseconds', { ms: formatNumber(row.lastResponseMs, locale) })
                    : '—'}
                </dd>
              </div>
            </dl>
          </div>
        ))}
      </div>

      <p className="mt-2 text-xs leading-relaxed text-[var(--color-text-muted)]">{t('note')}</p>
    </section>
  );
}
