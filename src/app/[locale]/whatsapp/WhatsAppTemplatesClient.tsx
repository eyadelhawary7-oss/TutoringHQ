'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { PageHeader } from '@/components/shared';
import {
  WA_TEMPLATE_PREVIEW_SAMPLES,
  previewBodyForTemplate,
  renderWaTemplatePreviewBody,
} from '@/lib/waTemplatePreviewSamples';
import type { WaMetaTemplateOwnerRow } from '@/types/wa-meta-owner';
import { SITE } from '@/config/site';

const SUPPORT_MAIL = SITE.supportEmail;

function formatTemplateName(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/^chq[_-]?/i, '')
    .split(/[_\-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function statusBadgeClasses(status: string): string {
  const normalized = (status ?? '').toUpperCase();
  if (normalized === 'APPROVED' || normalized === 'ACTIVE') {
    return 'bg-emerald-100 text-emerald-800 border border-emerald-200';
  }
  if (normalized === 'PENDING' || normalized === 'IN_APPEAL' || normalized === 'PENDING_DELETION') {
    return 'bg-amber-100 text-amber-800 border border-amber-200';
  }
  if (normalized === 'REJECTED' || normalized === 'DISABLED' || normalized === 'PAUSED') {
    return 'bg-red-100 text-red-800 border border-red-200';
  }
  return 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)] border border-[var(--color-border-subtle)]';
}

export default function WhatsAppTemplatesClient({
  locale,
  templates,
}: {
  locale: string;
  templates: WaMetaTemplateOwnerRow[];
}) {
  const t = useTranslations('whatsappTemplates');
  const [previewName, setPreviewName] = useState<string | null>(null);

  const previewBody = useMemo(() => {
    if (!previewName) return '';
    const raw = previewBodyForTemplate(previewName);
    return renderWaTemplatePreviewBody(raw, WA_TEMPLATE_PREVIEW_SAMPLES);
  }, [previewName]);

  const notifyHref = useMemo(() => {
    const subject = encodeURIComponent(t('pinNotifySubject'));
    const body = encodeURIComponent(t('pinNotifyBody'));
    return `mailto:${SUPPORT_MAIL}?subject=${subject}&body=${body}`;
  }, [t]);

  return (
    <div className="min-h-screen w-full bg-[var(--color-surface-0)] p-4 md:p-6">
      <PageHeader title={t('title')} />
      <div className="mx-auto max-w-4xl space-y-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-[var(--color-text-secondary)] max-w-xl">{t('subtitle')}</p>
          <Link
            href="/whatsapp-pack"
            locale={locale}
            className="shrink-0 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 transition-colors"
          >
            {t('openPackSettings')}
          </Link>
        </div>

        <section className="rounded-2xl border border-dashed border-amber-400/60 bg-amber-50/40 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                {t('comingSoonBadge')}
              </p>
              <h2 className="mt-1 text-lg font-bold text-[var(--color-text-primary)]">chq_pin_delivery</h2>
              <p className="mt-2 text-sm text-[var(--color-text-secondary)] leading-snug">{t('pinDeliveryDesc')}</p>
              <p className="mt-2 text-xs text-[var(--color-text-tertiary)]">{t('pinDeliveryMilestone')}</p>
            </div>
            <a
              href={notifyHref}
              className="inline-flex items-center justify-center rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-700"
            >
              {t('notifyMe')}
            </a>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">{t('templateLibrary')}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {templates.map((row) => (
              <article
                key={row.template_name}
                className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4 shadow-sm flex flex-col gap-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[var(--color-text-primary)] break-words">
                      {formatTemplateName(row.template_name)}
                    </p>
                    <p className="font-mono text-[11px] text-[var(--color-text-tertiary)] break-all mt-0.5">
                      {row.template_name}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-[var(--color-surface-2)] text-[var(--color-text-secondary)] border border-[var(--color-border-subtle)]">
                        {t('categoryLabel')}: {row.category}
                      </span>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${statusBadgeClasses(row.status)}`}>
                        {row.status}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPreviewName(row.template_name)}
                    className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] px-3 py-1.5 text-xs font-semibold text-teal-700 hover:bg-[var(--color-surface-2)]"
                  >
                    {t('preview')}
                  </button>
                </div>
              </article>
            ))}
          </div>
          {templates.length === 0 ? (
            <p className="text-sm text-[var(--color-text-tertiary)]">{t('noTemplates')}</p>
          ) : null}
        </section>
      </div>

      {previewName ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={t('previewModalTitle')}
          onClick={() => setPreviewName(null)}
        >
          <div
            className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-[var(--color-surface-1)] p-6 shadow-xl border border-[var(--color-border-subtle)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-4">
              <h3 className="text-lg font-bold text-[var(--color-text-primary)] font-mono break-all">
                {previewName}
              </h3>
              <button
                type="button"
                onClick={() => setPreviewName(null)}
                className="rounded-lg px-2 py-1 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]"
              >
                {t('close')}
              </button>
            </div>
            <p className="text-xs text-[var(--color-text-tertiary)] mb-3">{t('previewSampleNote')}</p>
            <pre
              className="whitespace-pre-wrap rounded-lg bg-[var(--color-surface-0)] border border-[var(--color-border-subtle)] p-4 text-sm leading-relaxed text-[var(--color-text-primary)]"
              dir="rtl"
            >
              {previewBody}
            </pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}
