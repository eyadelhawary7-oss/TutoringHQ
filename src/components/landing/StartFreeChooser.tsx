'use client';

import { useEffect, useRef } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Building2, GraduationCap, X, ArrowLeft, ArrowRight } from 'lucide-react';
import { Link } from '@/i18n/routing';

/**
 * "Start free" chooser — a calm, on-brand, closeable dialog shared by every
 * Start-free trigger on the combined landing page (hero, footer, and the summer
 * ribbon CTA). Two co-equal options route to the existing sign-up flows:
 * "I run a center" → /signup, "I'm a teacher" → /teacher/signup. No card capture
 * here, no third option. Keyboard-accessible: Escape closes, focus lands inside
 * on open and returns to the trigger on close, and a backdrop click dismisses.
 */
interface Props {
  open: boolean;
  onClose: () => void;
}

export default function StartFreeChooser({ open, onClose }: Props) {
  const t = useTranslations('splash.chooser');
  const locale = useLocale();
  const isAr = locale === 'ar';
  const Arrow = isAr ? ArrowLeft : ArrowRight;
  const panelRef = useRef<HTMLDivElement>(null);
  const firstLinkRef = useRef<HTMLAnchorElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    // Focus the first actionable option once the dialog is on screen.
    const id = requestAnimationFrame(() => firstLinkRef.current?.focus());

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    // Lock background scroll while the chooser is open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
      previousFocus.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end justify-center p-4 sm:items-center"
      dir={isAr ? 'rtl' : 'ltr'}
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label={t('close')}
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-[1px]"
        tabIndex={-1}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="start-free-title"
        className="relative w-full max-w-md rounded-[var(--radius-card)] border border-[var(--color-border)] p-6 shadow-[var(--shadow-card)]"
        style={{ backgroundColor: '#faf8f3' }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={t('close')}
          className="absolute end-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--color-text-secondary)] transition-colors hover:bg-black/5 hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-teal)]"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>

        <h2
          id="start-free-title"
          className="text-xl font-bold text-[var(--color-text-primary)]"
          style={{ fontFamily: 'var(--font-fraunces), Georgia, serif' }}
        >
          {t('title')}
        </h2>
        <p className="mt-1.5 text-sm text-[var(--color-text-secondary)]">{t('subtitle')}</p>

        <div className="mt-5 grid grid-cols-1 gap-3">
          <Link
            ref={firstLinkRef}
            href="/signup"
            onClick={onClose}
            className="group flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4 text-start shadow-[var(--shadow-row)] transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-teal)]"
            style={{ borderInlineStartColor: 'var(--color-teal)', borderInlineStartWidth: '3px' }}
          >
            <span
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
              style={{ background: 'var(--color-teal-soft)', color: 'var(--color-teal-deep)' }}
              aria-hidden
            >
              <Building2 size={22} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold text-[var(--color-text-primary)]">
                {t('center.title')}
              </span>
              <span className="mt-0.5 block text-xs leading-relaxed text-[var(--color-text-secondary)]">
                {t('center.brief')}
              </span>
            </span>
            <Arrow
              size={18}
              className="shrink-0 text-[var(--color-teal-deep)] transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5"
              aria-hidden
            />
          </Link>

          <Link
            href="/teacher/signup"
            onClick={onClose}
            className="group flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4 text-start shadow-[var(--shadow-row)] transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brass)]"
            style={{ borderInlineStartColor: 'var(--color-brass)', borderInlineStartWidth: '3px' }}
          >
            <span
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
              style={{ background: 'var(--color-brass-soft)', color: 'var(--color-brass)' }}
              aria-hidden
            >
              <GraduationCap size={22} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold text-[var(--color-text-primary)]">
                {t('teacher.title')}
              </span>
              <span className="mt-0.5 block text-xs leading-relaxed text-[var(--color-text-secondary)]">
                {t('teacher.brief')}
              </span>
            </span>
            <Arrow
              size={18}
              className="shrink-0 text-[var(--color-brass)] transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5"
              aria-hidden
            />
          </Link>
        </div>
      </div>
    </div>
  );
}
