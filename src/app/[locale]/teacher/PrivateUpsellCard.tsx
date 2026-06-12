'use client';

import { Sparkles, PauseCircle } from 'lucide-react';

/**
 * Locked-state card for free-zone teachers on the private sub-pages
 * (groups / students / billing). Brass when they have never subscribed
 * (start a trial), teal when their subscription lapsed (resume). The CTA is
 * wired by the caller via useStartTrial.
 */
export default function PrivateUpsellCard({
  tone,
  title,
  body,
  ctaLabel,
  onCta,
}: {
  tone: 'trial' | 'resume';
  title: string;
  body: string;
  ctaLabel: string;
  onCta: () => void;
}) {
  const isResume = tone === 'resume';
  return (
    <section
      className={[
        'rounded-[var(--radius-card)] border p-6',
        isResume
          ? 'border-[var(--color-teal)]/40 bg-[var(--color-teal-soft)]'
          : 'border-[var(--color-brass)]/50 bg-[var(--color-brass-soft)]',
      ].join(' ')}
    >
      <div className="mb-2 flex items-center gap-2">
        {isResume ? (
          <PauseCircle size={18} className="text-[var(--color-teal-deep)]" aria-hidden />
        ) : (
          <Sparkles size={18} className="text-[var(--color-brass)]" aria-hidden />
        )}
        <h2 className="text-lg font-bold text-[var(--color-text-primary)]">{title}</h2>
      </div>
      <p className="mb-4 text-sm text-[var(--color-text-secondary)]">{body}</p>
      <button
        type="button"
        onClick={onCta}
        className={[
          'rounded-lg px-4 py-2 font-medium text-white transition-opacity hover:opacity-90',
          isResume ? 'bg-teal-600' : 'bg-[var(--color-brass)]',
        ].join(' ')}
      >
        {ctaLabel}
      </button>
    </section>
  );
}
