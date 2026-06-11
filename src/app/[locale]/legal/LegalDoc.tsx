'use client';

import { useLocale } from 'next-intl';
import { AlertTriangle } from 'lucide-react';

/**
 * Shared scaffold for the public legal documents (privacy, terms, cookie, dpa).
 * Content is bilingual-inline (locale switch) rather than routed through
 * next-intl messages: these are draft placeholders pending legal review, so
 * keeping the AR/EN text co-located here avoids churning the i18n parity gate
 * for ~100 placeholder keys. Each numbered section renders the standard
 * "pending legal review" placeholder.
 */
export type LegalSection = { en: string; ar: string };

const DRAFT_NOTICE = {
  en: 'This document is a draft pending review and finalization by our legal counsel (Adsero). It does not constitute a final legally binding document.',
  ar: 'هذه الوثيقة مسودة قيد المراجعة من قِبل مستشارنا القانوني (أدسيرو). لا تمثل وثيقة نهائية ملزمة قانونياً.',
};

const SECTION_PLACEHOLDER = {
  en: 'This section will be completed upon legal review.',
  ar: 'سيُكمل هذا القسم بعد المراجعة القانونية.',
};

const LABELS = {
  lastUpdated: { en: 'Last updated: [Pending]', ar: 'آخر تحديث: [قيد الإعداد]' },
  effective: { en: 'Effective: [Pending]', ar: 'تاريخ السريان: [قيد الإعداد]' },
};

export default function LegalDoc({
  title,
  sections,
}: {
  title: LegalSection;
  sections: LegalSection[];
}) {
  const locale = useLocale();
  const isAr = locale === 'ar' || locale.startsWith('ar-');
  const L = (s: LegalSection) => (isAr ? s.ar : s.en);

  return (
    <article className="mx-auto max-w-3xl px-4 py-10 md:py-14">
      {/* Draft notice banner */}
      <div
        role="alert"
        className="mb-8 flex w-full items-start gap-3 rounded-[var(--radius-card)] border border-[var(--color-warning)]/40 bg-[var(--color-warning-muted)] p-4 text-sm leading-relaxed text-[var(--color-warning)]"
      >
        <AlertTriangle size={20} className="mt-0.5 shrink-0" aria-hidden />
        <p>{L(DRAFT_NOTICE)}</p>
      </div>

      <h1 className="text-2xl font-bold text-[var(--color-text-primary)] md:text-3xl">
        {L(title)}
      </h1>
      <div className="mt-2 flex flex-col gap-0.5 text-sm text-[var(--color-text-muted)]">
        <span>{L(LABELS.lastUpdated)}</span>
        <span>{L(LABELS.effective)}</span>
      </div>

      <div className="mt-8 flex flex-col gap-8">
        {sections.map((section, i) => (
          <section key={i}>
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
              {i + 1}. {L(section)}
            </h2>
            <p className="mt-2 text-sm italic leading-relaxed text-[var(--color-text-secondary)]">
              [{SECTION_PLACEHOLDER.en} / {SECTION_PLACEHOLDER.ar}]
            </p>
          </section>
        ))}
      </div>
    </article>
  );
}
