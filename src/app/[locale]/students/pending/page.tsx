'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { ChevronLeft, Inbox, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/ToastProvider';
import { Modal } from '@/components/ui/Modal';
import { formatNumber } from '@/lib/formatNumber';
import { PACK_PRICE_PER_PARENT } from '@/lib/parentPack';

interface PendingEnrollment {
  id: string;
  group_id: string;
  group_name: string;
  student_name: string;
  student_phone: string;
  parent_phone: string | null;
  notes: string | null;
  status: string;
  created_at: string;
}

const SUGGESTED_SELLING_PRICE = 25;

function formatCreatedAt(ts: string, locale: string): string {
  try {
    const d = new Date(ts);
    return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
  } catch {
    return ts;
  }
}

export default function PendingEnrollmentsPage() {
  const t = useTranslations('pendingEnrollments');
  const tToast = useTranslations('toasts');
  const locale = useLocale();
  const isRTL = locale === 'ar';
  const { toast } = useToast();

  const [list, setList] = useState<PendingEnrollment[] | null>(null);
  const [error, setError] = useState('');

  const [reviewing, setReviewing] = useState<PendingEnrollment | null>(null);
  const [parentPhoneEdit, setParentPhoneEdit] = useState('');
  const [enrollInPack, setEnrollInPack] = useState(false);
  const [sellingPrice, setSellingPrice] = useState<string>(String(SUGGESTED_SELLING_PRICE));
  const [submitting, setSubmitting] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [modalError, setModalError] = useState('');

  const loadPending = async () => {
    setError('');
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      setError(t('loadError'));
      setList([]);
      return;
    }
    try {
      const res = await fetch('/api/students/pending', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        setError(t('loadError'));
        setList([]);
        return;
      }
      const data = (await res.json()) as { pending: PendingEnrollment[] };
      setList(data.pending ?? []);
    } catch {
      setError(t('loadError'));
      setList([]);
    }
  };

  useEffect(() => {
    loadPending();
  }, []);

  const openReview = (p: PendingEnrollment) => {
    setReviewing(p);
    setParentPhoneEdit(p.parent_phone ?? '');
    setEnrollInPack(false);
    setSellingPrice(String(SUGGESTED_SELLING_PRICE));
    setModalError('');
  };

  const closeReview = () => {
    if (submitting || rejecting) return;
    setReviewing(null);
    setModalError('');
  };

  const handleApprove = async (e: FormEvent) => {
    e.preventDefault();
    if (!reviewing) return;
    setModalError('');

    const cleanedParentPhone = parentPhoneEdit.trim();
    if (enrollInPack && !cleanedParentPhone) {
      setModalError(t('parentPhoneRequiredForPack'));
      return;
    }

    let priceVal: number | null = null;
    if (enrollInPack) {
      const parsed = Number(sellingPrice);
      if (!Number.isFinite(parsed) || parsed < 0) {
        setModalError(t('invalidPrice'));
        return;
      }
      priceVal = parsed;
    }

    setSubmitting(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        setModalError(t('loadError'));
        setSubmitting(false);
        return;
      }
      const res = await fetch(`/api/students/pending/${reviewing.id}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          parent_phone: cleanedParentPhone || null,
          enroll_in_pack: enrollInPack,
          selling_price: priceVal,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        student?: { name?: string; student_number?: string };
      };

      if (!res.ok) {
        setModalError(data.error || t('approveError'));
        return;
      }

      toast.success(
        t('approveSuccess', {
          name: data.student?.name ?? reviewing.student_name,
        }),
      );
      setList((prev) => (prev ?? []).filter((p) => p.id !== reviewing.id));
      setReviewing(null);
    } catch {
      setModalError(t('approveError'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!reviewing) return;
    setModalError('');
    setRejecting(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        setModalError(t('loadError'));
        setRejecting(false);
        return;
      }

      const res = await fetch(`/api/students/pending/${reviewing.id}/reject`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setModalError(data.error || 'Failed to reject registration request');
        return;
      }

      toast.success('Registration request rejected');
      setList((prev) => (prev ?? []).filter((p) => p.id !== reviewing.id));
      setReviewing(null);
    } catch {
      setModalError('Failed to reject registration request');
    } finally {
      setRejecting(false);
    }
  };

  const totalCount = useMemo(() => (list ? list.length : 0), [list]);

  return (
    <div
      dir={isRTL ? 'rtl' : 'ltr'}
      className="min-h-screen w-full min-w-0 overflow-x-clip bg-[var(--color-surface-0)] page-enter max-md:pb-[calc(56px_+_env(safe-area-inset-bottom,0px))] md:pb-0"
    >
      <div className="mx-auto w-full max-w-5xl px-4 pt-4 pb-3">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/students"
              className="flex items-center gap-1 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              <ChevronLeft size={14} className={isRTL ? 'rotate-180' : ''} />
              {t('backToStudents')}
            </Link>
          </div>
        </div>

        <div className="mb-4">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{t('title')}</h1>
            <span className="inline-flex items-center rounded-full bg-teal-600 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-white shrink-0">
              {list === null ? '\u2013' : formatNumber(totalCount, locale)}
            </span>
          </div>
          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{t('subtitle')}</p>
        </div>

        {list === null ? (
          <div className="flex items-center justify-center rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] py-16">
            <Loader2 size={20} className="animate-spin text-[var(--color-text-muted)]" />
          </div>
        ) : list.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface-1)] py-16 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-surface-2)] text-[var(--color-text-muted)]">
              <Inbox size={22} />
            </div>
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
              {t('emptyTitle')}
            </h2>
            <p className="mt-1 max-w-xs text-xs text-[var(--color-text-secondary)]">
              {t('emptyDescription')}
            </p>
            {error ? (
              <p className="mt-3 text-xs text-red-500 dark:text-red-400">{error}</p>
            ) : null}
          </div>
        ) : (
          <>
            <div className="hidden md:block overflow-hidden rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)]">
              <table className="w-full text-sm">
                <thead className="bg-[var(--color-surface-2)] text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                  <tr>
                    <th className="px-4 py-2.5 text-start font-semibold">{t('studentName')}</th>
                    <th className="px-4 py-2.5 text-start font-semibold">{t('studentPhone')}</th>
                    <th className="px-4 py-2.5 text-start font-semibold">{t('parentPhone')}</th>
                    <th className="px-4 py-2.5 text-start font-semibold">{t('group')}</th>
                    <th className="px-4 py-2.5 text-start font-semibold">{t('createdAt')}</th>
                    <th className="px-4 py-2.5 text-end font-semibold">{t('actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((p) => (
                    <tr
                      key={p.id}
                      className="border-t border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-2)]/50"
                    >
                      <td className="px-4 py-3 text-[var(--color-text-primary)]">
                        {p.student_name}
                      </td>
                      <td className="px-4 py-3 text-[var(--color-text-secondary)]" dir="ltr">
                        {p.student_phone}
                      </td>
                      <td className="px-4 py-3 text-[var(--color-text-secondary)]" dir="ltr">
                        {p.parent_phone || '\u2014'}
                      </td>
                      <td className="px-4 py-3 text-[var(--color-text-secondary)]">
                        {p.group_name || '\u2014'}
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--color-text-muted)] tabular-nums">
                        {formatCreatedAt(p.created_at, locale)}
                      </td>
                      <td className="px-4 py-3 text-end">
                        <button
                          type="button"
                          onClick={() => openReview(p)}
                          className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-teal-700"
                        >
                          {t('review')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="md:hidden space-y-2">
              {list.map((p) => (
                <div
                  key={p.id}
                  className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-[var(--color-text-primary)]">
                        {p.student_name}
                      </h3>
                      <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]" dir="ltr">
                        {p.student_phone}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => openReview(p)}
                      className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-teal-700"
                    >
                      {t('review')}
                    </button>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                    <dt className="text-[var(--color-text-muted)]">{t('parentPhone')}</dt>
                    <dd className="text-[var(--color-text-primary)]" dir="ltr">
                      {p.parent_phone || '\u2014'}
                    </dd>
                    <dt className="text-[var(--color-text-muted)]">{t('group')}</dt>
                    <dd className="text-[var(--color-text-primary)]">{p.group_name || '\u2014'}</dd>
                    <dt className="text-[var(--color-text-muted)]">{t('createdAt')}</dt>
                    <dd className="text-[var(--color-text-secondary)] tabular-nums">
                      {formatCreatedAt(p.created_at, locale)}
                    </dd>
                  </dl>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {reviewing ? (
        <Modal open={true} onClose={closeReview} title={t('reviewTitle')} size="lg">
          <form onSubmit={handleApprove} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <ReadonlyField label={t('studentName')} value={reviewing.student_name} />
              <ReadonlyField label={t('studentPhone')} value={reviewing.student_phone} dir="ltr" />
              <ReadonlyField label={t('group')} value={reviewing.group_name || '\u2014'} />
              <ReadonlyField
                label={t('createdAt')}
                value={formatCreatedAt(reviewing.created_at, locale)}
              />
            </div>

            {reviewing.notes ? (
              <ReadonlyField label={t('notes')} value={reviewing.notes} multiline />
            ) : null}

            <div>
              <label
                htmlFor="approve-parent-phone"
                className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]"
              >
                {t('parentPhone')}
              </label>
              <input
                id="approve-parent-phone"
                type="tel"
                inputMode="tel"
                value={parentPhoneEdit}
                onChange={(e) => setParentPhoneEdit(e.target.value)}
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] px-3 py-2.5 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-teal)] focus:outline-none"
                placeholder="01XXXXXXXXX"
                dir="ltr"
              />
            </div>

            <label className="flex items-start gap-3 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-0)] p-3">
              <button
                type="button"
                role="switch"
                aria-checked={enrollInPack}
                onClick={() => setEnrollInPack((v) => !v)}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                  enrollInPack ? 'bg-teal-600' : 'bg-[var(--color-surface-2)]'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                    enrollInPack
                      ? isRTL
                        ? '-translate-x-6'
                        : 'translate-x-6'
                      : isRTL
                        ? '-translate-x-1'
                        : 'translate-x-1'
                  }`}
                />
              </button>
              <span className="flex flex-col">
                <span className="text-sm font-medium text-[var(--color-text-primary)]">
                  {t('enrollInPack')}
                </span>
                <span className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                  {t('enrollInPackHint')}
                </span>
              </span>
            </label>

            {enrollInPack ? (
              <div>
                <label
                  htmlFor="approve-selling-price"
                  className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]"
                >
                  {t('sellingPrice')}
                </label>
                <input
                  id="approve-selling-price"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  value={sellingPrice}
                  onChange={(e) => setSellingPrice(e.target.value)}
                  placeholder={String(SUGGESTED_SELLING_PRICE)}
                  className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] px-3 py-2.5 text-sm font-mono text-[var(--color-text-primary)] focus:border-[var(--color-teal)] focus:outline-none"
                  dir="ltr"
                />
                <p className="mt-1.5 text-xs text-[var(--color-text-muted)]">
                  {t('platformBaseCost', { price: PACK_PRICE_PER_PARENT })}
                </p>
              </div>
            ) : null}

            {modalError ? (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-500 dark:text-red-300">
                {modalError}
              </div>
            ) : null}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={closeReview}
                disabled={submitting || rejecting}
                className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)] disabled:opacity-60"
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                onClick={handleReject}
                disabled={submitting || rejecting}
                className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-600 transition-colors hover:bg-red-500/15 disabled:opacity-60"
              >
                {rejecting ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>Rejecting...</span>
                  </>
                ) : (
                  'Reject'
                )}
              </button>
              <button
                type="submit"
                disabled={submitting || rejecting}
                className="flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:opacity-60"
              >
                {submitting ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>{t('approving')}</span>
                  </>
                ) : (
                  t('approve')
                )}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}

function ReadonlyField({
  label,
  value,
  dir,
  multiline,
}: {
  label: string;
  value: string;
  dir?: 'ltr' | 'rtl';
  multiline?: boolean;
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
        {label}
      </p>
      <div
        className={`rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-0)]/50 px-3 py-2 text-sm text-[var(--color-text-primary)] ${multiline ? 'whitespace-pre-wrap' : ''}`}
        dir={dir}
      >
        {value}
      </div>
    </div>
  );
}
