'use client';

import { useEffect, useState, useTransition, type FormEvent } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Globe } from 'lucide-react';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { useRouter, usePathname } from '@/i18n/routing';

interface JoinInfo {
  center_id: string;
  centerId?: string;
  center_name: string;
  group_id: string;
  groupId?: string;
  group_name: string;
  group_subject: string | null;
}

interface PageProps {
  params: Promise<{ center_code: string; group_id: string }>;
}

export default function JoinPage({ params }: PageProps) {
  const t = useTranslations('join');
  const locale = useLocale();
  const isRTL = locale === 'ar';
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const [centerCode, setCenterCode] = useState<string>('');
  const [groupId, setGroupId] = useState<string>('');
  const [mounted, setMounted] = useState(false);
  const [info, setInfo] = useState<JoinInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [studentName, setStudentName] = useState('');
  const [studentPhone, setStudentPhone] = useState('');
  const [parentPhone, setParentPhone] = useState('');
  const [notes, setNotes] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    params.then((p) => {
      setCenterCode(p.center_code);
      setGroupId(p.group_id);
    });
  }, [params]);

  useEffect(() => {
    if (!centerCode || !groupId) return;
    let cancelled = false;
    setIsLoading(true);
    fetch(`/api/join/${encodeURIComponent(centerCode)}/${encodeURIComponent(groupId)}`)
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404) {
          setNotFound(true);
          setInfo(null);
          return;
        }
        if (!res.ok) {
          setError(t('loadError'));
          return;
        }
        const data = (await res.json()) as JoinInfo;
        setInfo(data);
      })
      .catch(() => {
        if (cancelled) return;
        setError(t('loadError'));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [centerCode, groupId, t]);

  const handleLocaleToggle = () => {
    const next = locale === 'ar' ? 'en' : 'ar';
    startTransition(() => router.replace(pathname, { locale: next }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!info) return;
    setError('');

    if (!studentName.trim()) {
      setError(t('nameRequired'));
      return;
    }
    if (!studentPhone.trim()) {
      setError(t('phoneRequired'));
      return;
    }

    setSubmitting(true);
    try {
      const centerId = info.center_id || info.centerId;
      const groupUuid = info.group_id || info.groupId;

      const res = await fetch('/api/join/pending-enrollment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          center_id: centerId,
          group_id: groupUuid,
          student_name: studentName.trim(),
          student_phone: studentPhone.trim(),
          parent_phone: parentPhone.trim() || null,
          notes: notes.trim() || null,
        }),
      });

      if (!res.ok) {
        console.error('pending-enrollment API', await res.text().catch(() => ''));
        setError(t('submitError'));
        return;
      }
      setSubmitted(true);
    } catch (err) {
      console.error("Catch Error:", err);
      setError(t('submitError'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      dir={isRTL ? 'rtl' : 'ltr'}
      className="relative min-h-screen w-full bg-[var(--color-surface-0)] text-[var(--color-text-primary)]"
    >
      <header className="flex items-center justify-between border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-4 py-2.5">
        <span
          className="select-none text-base tracking-[2px]"
          style={{ fontFamily: 'var(--font-bodoni)', fontWeight: 700 }}
        >
          <span className="text-[var(--color-text-primary)]">Tutoring</span>
          <span className="text-[var(--color-teal)]">HQ</span>
        </span>
        <div className="flex items-center gap-1.5">
          {mounted && <ThemeToggle />}
          <button
            type="button"
            onClick={handleLocaleToggle}
            disabled={isPending}
            aria-label={locale === 'ar' ? 'Switch to English' : 'التبديل إلى العربية'}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)] disabled:opacity-60"
          >
            <Globe size={13} />
            <span>{locale === 'ar' ? 'EN' : 'العربية'}</span>
          </button>
        </div>
      </header>

      <main className="flex flex-col items-center px-4 py-10">
        <div className="w-full max-w-md">
          {isLoading ? (
            <div className="chq-card-elevated p-8 text-center">
              <div
                className="mx-auto mb-3 h-8 w-8 rounded-full border-2 border-[var(--color-teal)]/30 border-t-[var(--color-teal)]"
                style={{ animation: 'spin 0.8s linear infinite' }}
              />
              <p className="text-sm text-[var(--color-text-secondary)]">{t('loading')}</p>
            </div>
          ) : notFound ? (
            <div className="chq-card-elevated p-8 text-center">
              <h1 className="mb-2 text-lg font-bold text-[var(--color-text-primary)]">
                {t('notFoundTitle')}
              </h1>
              <p className="text-sm text-[var(--color-text-secondary)]">
                {t('notFoundDescription')}
              </p>
            </div>
          ) : submitted ? (
            <div className="chq-card-elevated p-8 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-teal)]/15">
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--color-teal)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <h1 className="mb-2 text-lg font-bold text-[var(--color-text-primary)]">
                {t('successTitle')}
              </h1>
              <p className="text-sm text-[var(--color-text-secondary)]">{t('successMessage')}</p>
            </div>
          ) : info ? (
            <div className="chq-card-elevated p-6 sm:p-8">
              <div className="mb-6 text-center">
                <p className="mb-2 text-xs uppercase tracking-[2px] text-[var(--color-text-muted)]">
                  {t('eyebrow')}
                </p>
                <h1 className="text-xl font-bold text-[var(--color-text-primary)]">
                  {info.center_name}
                </h1>
                <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                  {info.group_name}
                  {info.group_subject ? ` \u00B7 ${info.group_subject}` : ''}
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                <div>
                  <label
                    htmlFor="join-student-name"
                    className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]"
                  >
                    {t('studentName')} <span className="text-[var(--color-teal)]">*</span>
                  </label>
                  <input
                    id="join-student-name"
                    type="text"
                    value={studentName}
                    onChange={(e) => {
                      setStudentName(e.target.value);
                      setError('');
                    }}
                    className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-2.5 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-teal)] focus:outline-none"
                    placeholder={t('studentNamePlaceholder')}
                    autoComplete="name"
                    required
                  />
                </div>

                <div>
                  <label
                    htmlFor="join-student-phone"
                    className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]"
                  >
                    {t('studentPhone')} <span className="text-[var(--color-teal)]">*</span>
                  </label>
                  <input
                    id="join-student-phone"
                    type="tel"
                    inputMode="tel"
                    value={studentPhone}
                    onChange={(e) => {
                      setStudentPhone(e.target.value);
                      setError('');
                    }}
                    className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-2.5 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-teal)] focus:outline-none"
                    placeholder="01XXXXXXXXX"
                    autoComplete="tel"
                    dir="ltr"
                    required
                  />
                </div>

                <div>
                  <label
                    htmlFor="join-parent-phone"
                    className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]"
                  >
                    {t('parentPhone')}{' '}
                    <span className="font-normal normal-case text-[var(--color-text-muted)]">
                      ({t('optional')})
                    </span>
                  </label>
                  <input
                    id="join-parent-phone"
                    type="tel"
                    inputMode="tel"
                    value={parentPhone}
                    onChange={(e) => setParentPhone(e.target.value)}
                    className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-2.5 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-teal)] focus:outline-none"
                    placeholder="01XXXXXXXXX"
                    autoComplete="tel"
                    dir="ltr"
                  />
                </div>

                <div>
                  <label
                    htmlFor="join-notes"
                    className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]"
                  >
                    {t('notes')}{' '}
                    <span className="font-normal normal-case text-[var(--color-text-muted)]">
                      ({t('optional')})
                    </span>
                  </label>
                  <textarea
                    id="join-notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    className="w-full resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-2.5 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-teal)] focus:outline-none"
                    placeholder={t('notesPlaceholder')}
                  />
                </div>

                {error ? (
                  <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-500 dark:text-red-300">
                    {error}
                  </div>
                ) : null}

                <button
                  type="submit"
                  disabled={submitting}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--color-teal)] px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  {submitting ? (
                    <>
                      <span
                        className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white"
                        style={{ animation: 'spin 0.8s linear infinite' }}
                        aria-hidden
                      />
                      <span>{t('submitting')}</span>
                    </>
                  ) : (
                    t('submit')
                  )}
                </button>

                <p className="pt-1 text-center text-xs text-[var(--color-text-muted)]">
                  {t('footerNote')}
                </p>
              </form>
            </div>
          ) : (
            <div className="chq-card-elevated p-8 text-center">
              <p className="text-sm text-[var(--color-text-secondary)]">
                {error || t('loadError')}
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
