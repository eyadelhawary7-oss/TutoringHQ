'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { Check, ChevronLeft, Inbox, Loader2, Phone, MessageCircle, X } from 'lucide-react';
import { DirectionalIcon } from '@/components/icons/DirectionalIcon';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/ToastProvider';
import { Modal } from '@/components/ui/Modal';
import {
  ActionSheet,
  ExpandableRow,
  type InlineAction,
  type SheetAction,
} from '@/components/patterns';
import {
  formatNumber,
  formatPhoneLeadPlus,
  formatRelativeMinutesAgo,
} from '@/lib/formatNumber';
import { PACK_PRICE_PER_PARENT } from '@/lib/parentPack';

interface PendingEnrollment {
  id: string;
  student_id: string | null;
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

/** Two-letter monogram for the request row, per the design's avatar. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0]!.slice(0, 2);
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`;
}

/**
 * Call / WhatsApp pair for one person on the request.
 *
 * Design (Merged-Center-Students §04): "Reach either of them without approving
 * first." Live showed the numbers as plain text, so acting on them meant copying
 * a phone number out by hand — the one thing a center does before deciding.
 */
function ContactRow({
  role,
  name,
  phone,
  callLabel,
  waLabel,
}: {
  role: string;
  name: string;
  phone: string;
  callLabel: string;
  waLabel: string;
}) {
  const display = formatPhoneLeadPlus(phone);
  const waDigits = display.replace(/\D/g, '');
  if (!waDigits) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-0)] px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-[var(--color-text-primary)]">{name}</p>
        <p className="text-xs text-[var(--color-text-muted)]">
          {role} · <span dir="ltr">{display}</span>
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <a
          href={`tel:${display}`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
        >
          <Phone size={13} />
          {callLabel}
        </a>
        <a
          href={`https://wa.me/${waDigits}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-green-700"
        >
          <MessageCircle size={13} />
          {waLabel}
        </a>
      </div>
    </div>
  );
}

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
  const tConsent = useTranslations('guardianConsent');
  const locale = useLocale();
  const isRTL = locale === 'ar';
  const { toast } = useToast();

  const [list, setList] = useState<PendingEnrollment[] | null>(null);
  const [error, setError] = useState('');

  const [reviewing, setReviewing] = useState<PendingEnrollment | null>(null);
  const [parentPhoneEdit, setParentPhoneEdit] = useState('');
  const [guardianConsent, setGuardianConsent] = useState(false);
  const [enrollInPack, setEnrollInPack] = useState(false);
  const [sellingPrice, setSellingPrice] = useState<string>(String(SUGGESTED_SELLING_PRICE));
  const [submitting, setSubmitting] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [modalError, setModalError] = useState('');

  // §04's Pending frame: exactly one row is open at a time, and the open row is
  // the one carrying the action chips. `ExpandableRow` owns the shape; this only
  // holds which id is open.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sheetTarget, setSheetTarget] = useState<PendingEnrollment | null>(null);
  // Decline is a one-tap chip in the design. Live it is a real state write that
  // cannot be undone from this screen, so it goes through a confirm first —
  // the chip stays where the design puts it, the write does not become a slip.
  const [declineTarget, setDeclineTarget] = useState<PendingEnrollment | null>(null);
  const [listDeclining, setListDeclining] = useState(false);
  const [listError, setListError] = useState('');

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
    setGuardianConsent(false);
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

    if (!reviewing.student_id) {
      setModalError(t('approveError'));
      return;
    }

    if (!guardianConsent) {
      setModalError(tConsent('required'));
      return;
    }

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
      const res = await fetch(`/api/students/pending/${reviewing.student_id}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          groupIds: [reviewing.group_id],
          parent_phone: cleanedParentPhone || null,
          enroll_in_pack: enrollInPack,
          selling_price: priceVal,
          guardianConsentConfirmed: guardianConsent,
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

  /**
   * The one decline write. Both entry points — the review modal's Decline
   * button and §04's inline Decline chip — call this, so the two can never
   * drift into two different requests against the same endpoint.
   *
   * Returns an error message to display, or null on success.
   */
  const rejectRequest = async (target: PendingEnrollment): Promise<string | null> => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return t('loadError');

      const res = await fetch(`/api/students/pending/${target.id}/reject`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) return data.error || t('declineError');

      toast.success(t('declineSuccess'));
      setList((prev) => (prev ?? []).filter((p) => p.id !== target.id));
      return null;
    } catch {
      return t('declineError');
    }
  };

  const handleReject = async () => {
    if (!reviewing) return;
    setModalError('');
    setRejecting(true);
    const err = await rejectRequest(reviewing);
    if (err) setModalError(err);
    else setReviewing(null);
    setRejecting(false);
  };

  const handleDeclineFromList = async () => {
    if (!declineTarget) return;
    setListError('');
    setListDeclining(true);
    const err = await rejectRequest(declineTarget);
    if (err) setListError(err);
    else {
      setExpandedId((id) => (id === declineTarget.id ? null : id));
      setDeclineTarget(null);
    }
    setListDeclining(false);
  };

  /** The design's row meta: which group was asked for, and how long ago. */
  const rowMeta = (p: PendingEnrollment): string =>
    [p.group_name || null, t('asked', { ago: formatRelativeMinutesAgo(p.created_at, locale) })]
      .filter(Boolean)
      .join(' · ');

  /**
   * §04 draws two inline chips (Approve, Decline) plus More. Approve opens the
   * request detail rather than posting straight from the list: the approve
   * endpoint requires `guardianConsentConfirmed`, and that checkbox is a legal
   * gate, not a form field to be defaulted past.
   */
  const inlineActionsFor = (p: PendingEnrollment): InlineAction[] => [
    {
      id: 'approve',
      label: t('review'),
      icon: Check,
      onSelect: () => openReview(p),
    },
    {
      id: 'decline',
      label: t('decline'),
      icon: X,
      onSelect: () => {
        setListError('');
        setDeclineTarget(p);
      },
    },
  ];

  /**
   * §04's kebab. Everything here is reachable without approving, which is what
   * the design's "Reach either of them without approving first" asks for.
   * A number that is absent produces no action rather than a dead one.
   */
  const sheetActionsFor = (p: PendingEnrollment): SheetAction[] => {
    const studentDigits = formatPhoneLeadPlus(p.student_phone).replace(/\D/g, '');
    const parentDigits = p.parent_phone
      ? formatPhoneLeadPlus(p.parent_phone).replace(/\D/g, '')
      : '';
    const open = (href: string, external: boolean) => () => {
      setSheetTarget(null);
      window.open(href, external ? '_blank' : '_self', 'noopener,noreferrer');
    };
    return [
      {
        id: 'review',
        label: t('review'),
        icon: Check,
        onSelect: () => {
          setSheetTarget(null);
          openReview(p);
        },
      },
      ...(studentDigits
        ? [
            {
              id: 'call-student',
              label: t('callStudent'),
              icon: Phone,
              onSelect: open(`tel:+${studentDigits}`, false),
            },
            {
              id: 'wa-student',
              label: t('waStudent'),
              icon: MessageCircle,
              onSelect: open(`https://wa.me/${studentDigits}`, true),
            },
          ]
        : []),
      ...(parentDigits
        ? [
            {
              id: 'call-parent',
              label: t('callParent'),
              icon: Phone,
              onSelect: open(`tel:+${parentDigits}`, false),
            },
            {
              id: 'wa-parent',
              label: t('waParent'),
              icon: MessageCircle,
              onSelect: open(`https://wa.me/${parentDigits}`, true),
            },
          ]
        : []),
      {
        id: 'decline',
        label: t('decline'),
        icon: X,
        destructive: true,
        onSelect: () => {
          setSheetTarget(null);
          setListError('');
          setDeclineTarget(p);
        },
      },
    ];
  };

  const totalCount = useMemo(() => (list ? list.length : 0), [list]);

  return (
    <div
      dir={isRTL ? 'rtl' : 'ltr'}
      className="min-h-screen w-full min-w-0 overflow-x-clip bg-[var(--color-surface-0)] page-enter max-md:pb-[calc(56px_+_env(safe-area-inset-bottom,0px))] md:pb-0"
    >
      {/* max-w-3xl, matching the roster this screen hangs off. The old 5xl was
          sized for the desktop table that §04's row list replaces. */}
      <div className="mx-auto w-full max-w-3xl px-4 pt-4 pb-3">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/students"
              className="flex items-center gap-1 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              <DirectionalIcon icon={ChevronLeft} className="h-3.5 w-3.5 shrink-0" />
              {t('backToStudents')}
            </Link>
          </div>
        </div>

        <div className="mb-4">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{t('title')}</h1>
            {/* §04's topbar count is a DANGER pill (#F4E5E2 on #9C3322), not
                the teal it was: a queue of people waiting on an answer is a
                backlog, and the design colours it as one. */}
            <span className="inline-flex shrink-0 items-center rounded-full bg-[#F4E5E2] px-2.5 py-0.5 text-xs font-semibold tabular-nums text-[#9C3322]">
              {list === null ? '\u2013' : formatNumber(totalCount, locale)}
            </span>
          </div>
          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{t('subtitle')}</p>
        </div>

        {list === null ? (
          <div className="flex items-center justify-center rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] py-16">
            <Loader2 size={20} className="animate-spin text-[var(--color-text-muted)]" />
          </div>
        ) : list.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-panel)] py-16 text-center">
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
              <p className="mt-3 text-xs text-[var(--color-danger)]">{error}</p>
            ) : null}
          </div>
        ) : (
          <>
            {/* §04 Pending — the design's row list, not a table. One row opens
                at a time and carries its chips inline; the three-dot on any row
                jumps straight to the same sheet. Both come from the shared
                primitives (`ExpandableRow`, `ActionSheet`), which is what
                `Merged-Design-Patterns` §04/§06 require of any screen with a
                row action or a quick menu.

                NOT DRAWN, AND NOT INVENTED: §04 puts an origin badge on every
                row ("Invite link" vs "Sign-up") and a "Came via" row in the
                detail. `pending_enrollments` has no column carrying it —
                re-read live this pass, the table is exactly id, center_id,
                group_id, student_name, student_phone, parent_phone, notes,
                status, created_at, student_id. Both live insert sites write the
                identical set, so the fact is lost at insert, not merely
                unrendered. Stamping it needs a new column (F12). Same for the
                detail's "Grade" and "School" rows: there is no
                `pending_enrollments.grade_level` and no `school` column
                anywhere in the schema. */}
            <div className="flex flex-col gap-2">
              {list.map((p) => (
                <ExpandableRow
                  key={p.id}
                  avatar={initialsOf(p.student_name)}
                  title={p.student_name}
                  meta={rowMeta(p)}
                  expanded={expandedId === p.id}
                  onToggle={() => setExpandedId(expandedId === p.id ? null : p.id)}
                  inlineActions={inlineActionsFor(p)}
                  onMore={() => setSheetTarget(p)}
                  moreLabel={t('more')}
                />
              ))}
            </div>
            {listError ? (
              <p className="mt-3 text-xs text-[var(--color-danger)]">{listError}</p>
            ) : null}
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

            {/* Design leads the request detail with this reassurance, and it is
                accurate: a pending row is not in any group, so no attendance can
                be scanned against it and nothing bills until approval. */}
            <p className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2.5 text-xs text-[var(--color-text-secondary)]">
              {t('notEnrolledYet')}
            </p>

            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
                {t('contactTitle')}
              </p>
              <p className="mb-2 text-xs text-[var(--color-text-muted)]">{t('contactHint')}</p>
              <div className="space-y-2">
                <ContactRow
                  role={t('roleStudent')}
                  name={reviewing.student_name}
                  phone={reviewing.student_phone}
                  callLabel={t('call')}
                  waLabel={t('whatsapp')}
                />
                {reviewing.parent_phone ? (
                  <ContactRow
                    role={t('roleParent')}
                    name={t('roleParent')}
                    phone={reviewing.parent_phone}
                    callLabel={t('call')}
                    waLabel={t('whatsapp')}
                  />
                ) : null}
              </div>
            </div>

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

            <label className="flex items-start gap-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-0)] p-3">
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

            <label className="flex items-start gap-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-0)] p-3 cursor-pointer">
              <input
                type="checkbox"
                required
                checked={guardianConsent}
                onChange={(e) => setGuardianConsent(e.target.checked)}
                className="mt-0.5 rounded accent-teal-600"
              />
              <span className="text-sm text-[var(--color-text-primary)]">{tConsent('checkboxLabel')}</span>
            </label>

            {modalError ? (
              <div className="rounded-lg border border-[var(--color-danger)]/30 bg-[var(--color-danger-muted)] px-3 py-2 text-sm text-[var(--color-danger)]">
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
                className="flex items-center gap-2 rounded-lg border border-[var(--color-danger)]/30 bg-[var(--color-danger-muted)] px-4 py-2 text-sm font-semibold text-[var(--color-danger)] transition-colors hover:bg-[var(--color-danger)]/15 disabled:opacity-60"
              >
                {rejecting ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>{t('declining')}</span>
                  </>
                ) : (
                  t('decline')
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

      {/* §04's kebab and the expanded row's More chip open the same sheet —
          `Merged-Design-Patterns` §04's "one sheet, one gesture". */}
      <ActionSheet
        open={sheetTarget !== null}
        onClose={() => setSheetTarget(null)}
        title={sheetTarget?.student_name ?? ''}
        subtitle={sheetTarget ? rowMeta(sheetTarget) : undefined}
        actions={sheetTarget ? sheetActionsFor(sheetTarget) : []}
      />

      {/* The confirm behind the inline Decline chip. Says what declining does
          rather than only asking whether to do it. */}
      {declineTarget ? (
        <Modal
          open
          onClose={() => {
            if (!listDeclining) setDeclineTarget(null);
          }}
          title={t('declineConfirmTitle')}
        >
          <div className="space-y-4">
            <p className="text-sm text-[var(--color-text-secondary)]">
              {t('declineConfirmBody', { name: declineTarget.student_name })}
            </p>
            {listError ? (
              <div className="rounded-lg border border-[var(--color-danger)]/30 bg-[var(--color-danger-muted)] px-3 py-2 text-sm text-[var(--color-danger)]">
                {listError}
              </div>
            ) : null}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={listDeclining}
                onClick={() => setDeclineTarget(null)}
                className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)] disabled:opacity-60"
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                disabled={listDeclining}
                onClick={() => void handleDeclineFromList()}
                className="flex items-center gap-2 rounded-lg border border-[var(--color-danger)]/30 bg-[var(--color-danger-muted)] px-4 py-2 text-sm font-semibold text-[var(--color-danger)] transition-colors hover:bg-[var(--color-danger)]/15 disabled:opacity-60"
              >
                {listDeclining ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>{t('declining')}</span>
                  </>
                ) : (
                  t('decline')
                )}
              </button>
            </div>
          </div>
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
        className={`rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-0)]/50 px-3 py-2 text-sm text-[var(--color-text-primary)] ${multiline ? 'whitespace-pre-wrap' : ''}`}
        dir={dir}
      >
        {value}
      </div>
    </div>
  );
}
