'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

const FAQ_KEYS = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8'] as const;
type FaqKey = (typeof FAQ_KEYS)[number];

export function LandingFAQ() {
  const t = useTranslations('landing.faq');
  const [open, setOpen] = useState<Set<FaqKey>>(new Set());

  function toggle(key: FaqKey) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  return (
    <section className="border-t border-[var(--color-border)] bg-[var(--color-surface-0)] px-4 py-16 md:px-6 md:py-24">
      <div className="mx-auto max-w-[800px]">
        <div className="mb-10 text-center md:mb-14">
          <h2 className="text-2xl font-bold text-[var(--color-text-primary)] md:text-3xl">
            {t('heading')}
          </h2>
          <p className="mt-3 text-sm text-[var(--color-text-muted)] md:text-base">
            {t('subheading')}
          </p>
        </div>

        <div className="flex flex-col gap-3">
          {FAQ_KEYS.map((key) => {
            const isOpen = open.has(key);
            const contentId = `faq-content-${key}`;
            return (
              <div
                key={key}
                className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)]"
              >
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={contentId}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-start transition-colors hover:bg-[var(--color-surface-2)] chq-focus"
                  onClick={() => toggle(key)}
                >
                  <span className="text-sm font-semibold text-[var(--color-text-primary)] md:text-base">
                    {t(`${key}.question` as 'q1.question')}
                  </span>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    aria-hidden="true"
                    className="shrink-0 text-[var(--color-text-muted)]"
                    style={{
                      transform: isOpen ? 'rotateZ(180deg)' : 'rotateZ(0deg)',
                      transition: 'transform 200ms ease',
                    }}
                  >
                    <path
                      d="M3 6l5 5 5-5"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                <div
                  id={contentId}
                  role="region"
                  style={{
                    maxHeight: isOpen ? '600px' : '0px',
                    overflow: 'hidden',
                    transition: 'max-height 200ms ease-in-out',
                  }}
                >
                  <p className="px-5 pb-5 text-sm leading-relaxed text-[var(--color-text-secondary)]">
                    {t(`${key}.answer` as 'q1.answer')}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
