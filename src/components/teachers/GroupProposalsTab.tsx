'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronDown, ChevronUp, Handshake, Loader2, Plus } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { getCsrfHeaders } from '@/lib/csrf-client';
import { formatCurrency, formatDate, formatNumber } from '@/lib/formatNumber';

type Offer = {
  id: string;
  madeBy: 'teacher' | 'center';
  cutEgp: number;
  note: string | null;
  createdAt: string;
};

type Proposal = {
  id: string;
  subject: string;
  gradeLevel: string | null;
  feePerClass: number;
  status: 'open' | 'accepted' | 'declined' | 'withdrawn' | 'expired';
  initiatedBy: 'teacher' | 'center';
  targetGroupId: string | null;
  targetGroupName: string | null;
  carriesLink: boolean;
  studentCount: number;
  expiresAt: string;
  createdAt: string;
  openingMessage: string | null;
  offerCount: number;
  latestOffer: Offer | null;
  whoseTurn: 'teacher' | 'center' | null;
  offers: Offer[];
  teacherName: string | null;
  teacherPhone: string | null;
};

type Teacher = { id: string; name: string | null; subject: string | null };
type AttachGroup = { id: string; name: string | null; subject: string | null; feePerClass: number | null };

const ERROR_KEY: Record<string, string> = {
  NOT_YOUR_TURN: 'errorNotYourTurn',
  CUT_NOT_LESS_THAN_FEE: 'errorCutTooHigh',
  PROPOSAL_ALREADY_OPEN: 'errorAlreadyOpen',
  TEACHER_NOT_LINKED: 'errorTeacherNotLinked',
  TEACHER_CODE_NOT_FOUND: 'errorCodeNotFound',
  GROUP_HAS_TEACHER: 'errorGroupHasTeacher',
  GROUP_NOT_ELIGIBLE: 'errorGroupNotEligible',
  GROUP_NO_FEE: 'errorGroupNoFee',
  GROUP_NOT_FOUND: 'errorGroupNotFound',
};

const STATUS_KEY: Record<Proposal['status'], string> = {
  open: 'statusOpen',
  accepted: 'statusAccepted',
  declined: 'statusDeclined',
  withdrawn: 'statusWithdrawn',
  expired: 'statusExpired',
};

const STATUS_CLASS: Record<Proposal['status'], string> = {
  open: 'bg-teal-100 text-teal-800',
  accepted: 'bg-emerald-100 text-emerald-800',
  declined: 'bg-red-100 text-red-700',
  withdrawn: 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]',
  expired: 'bg-amber-100 text-amber-800',
};

/**
 * Center-side group-proposal negotiation: the two-sided offer/counter over the
 * center cut. The owner can start a request to a NEW group (subject/grade/fee
 * entered) or to an EXISTING plain center group (attach - the group supplies
 * its subject + fee, the owner only proposes the cut). On accept the group is
 * created or attached server-side; onChanged() lets the parent refresh.
 */
export default function GroupProposalsTab({ onChanged }: { onChanged?: () => void }) {
  const t = useTranslations('groupProposals');
  const locale = useLocale();

  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [counterFor, setCounterFor] = useState<string | null>(null);
  const [counterCut, setCounterCut] = useState('');
  const [counterNote, setCounterNote] = useState('');

  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [teachersLoaded, setTeachersLoaded] = useState(false);
  const [attachGroups, setAttachGroups] = useState<AttachGroup[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [targetMode, setTargetMode] = useState<'new' | 'existing'>('new');
  // Teacher source: pick an already-linked teacher, or name one by their code
  // (the combined link + group request - the teacher confirms).
  const [teacherSource, setTeacherSource] = useState<'linked' | 'code'>('linked');
  const [form, setForm] = useState({
    teacherId: '',
    teacherCode: '',
    subject: '',
    gradeLevel: '',
    fee: '',
    cut: '',
    message: '',
    targetGroupId: '',
  });
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch('/api/center/group-proposals', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) return;
      const json = (await res.json()) as { proposals: Proposal[] };
      setProposals(json.proposals ?? []);
    } catch {
      // Non-fatal.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const loadFormData = useCallback(async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      const [teachersRes, groupsRes] = await Promise.all([
        fetch('/api/center/teachers', { headers: { Authorization: `Bearer ${session.access_token}` } }),
        fetch('/api/center/attachable-groups', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }),
      ]);
      if (teachersRes.ok) {
        const json = (await teachersRes.json()) as { teachers: Teacher[] };
        setTeachers(json.teachers ?? []);
      }
      if (groupsRes.ok) {
        const json = (await groupsRes.json()) as { groups: AttachGroup[] };
        setAttachGroups(json.groups ?? []);
      }
    } catch {
      // Non-fatal: the pickers render empty.
    } finally {
      setTeachersLoaded(true);
    }
  }, []);

  const openForm = () => {
    setShowForm((v) => !v);
    if (!teachersLoaded) loadFormData();
  };

  // The fee that bounds the cut: the typed fee for a new group, or the selected
  // existing group's fee for an attach.
  const selectedAttachGroup = attachGroups.find((g) => g.id === form.targetGroupId) ?? null;
  const effectiveFee =
    targetMode === 'existing' ? selectedAttachGroup?.feePerClass ?? 0 : Number(form.fee);

  // Whichever teacher source is active must name a teacher.
  const teacherChosen =
    teacherSource === 'code' ? form.teacherCode.trim().length > 0 : form.teacherId.length > 0;

  const submitProposal = async () => {
    const cut = Number(form.cut);
    if (!teacherChosen) return;
    if (targetMode === 'existing') {
      if (!form.targetGroupId) return;
    } else if (!form.subject.trim() || !Number.isFinite(effectiveFee) || effectiveFee <= 0) {
      return;
    }
    if (!Number.isFinite(cut) || cut < 0 || (effectiveFee > 0 && cut >= effectiveFee)) {
      setErrorKey('errorCutTooHigh');
      return;
    }
    setSubmitting(true);
    setErrorKey(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      // teacher_code names a (possibly not-yet-linked) teacher; teacher_id picks
      // an already-linked one. The server resolves the code and, when the teacher
      // is not linked, bundles the link into this same request (carries_link).
      const teacherRef =
        teacherSource === 'code'
          ? { teacher_code: form.teacherCode.trim() }
          : { teacher_id: form.teacherId };
      const body =
        targetMode === 'existing'
          ? {
              ...teacherRef,
              target_group_id: form.targetGroupId,
              opening_cut_egp: cut,
              opening_message: form.message.trim() || undefined,
            }
          : {
              ...teacherRef,
              subject: form.subject.trim(),
              grade_level: form.gradeLevel.trim() || undefined,
              fee_per_class: Number(form.fee),
              opening_cut_egp: cut,
              opening_message: form.message.trim() || undefined,
            };
      const res = await fetch('/api/center/group-proposals', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          ...(await getCsrfHeaders(session.access_token)),
        },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as { code?: string };
      if (!res.ok) {
        setErrorKey(ERROR_KEY[json.code ?? ''] ?? 'errorGeneric');
        return;
      }
      setShowForm(false);
      setTargetMode('new');
      setTeacherSource('linked');
      setForm({
        teacherId: '',
        teacherCode: '',
        subject: '',
        gradeLevel: '',
        fee: '',
        cut: '',
        message: '',
        targetGroupId: '',
      });
      load();
      // A pending link may have been created with the proposal - refresh the
      // monitor so the owner sees the teacher appear.
      onChanged?.();
    } catch {
      setErrorKey('errorGeneric');
    } finally {
      setSubmitting(false);
    }
  };

  const respond = async (
    proposalId: string,
    action: 'accept' | 'counter' | 'decline' | 'withdraw',
    cutEgp?: number,
    note?: string,
  ) => {
    if (busyId) return;
    setBusyId(proposalId);
    setErrorKey(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(`/api/center/group-proposals/${proposalId}/respond`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          ...(await getCsrfHeaders(session.access_token)),
        },
        body: JSON.stringify({ action, cut_egp: cutEgp, note: note || undefined }),
      });
      const json = (await res.json().catch(() => ({}))) as { code?: string };
      if (!res.ok) {
        setErrorKey(ERROR_KEY[json.code ?? ''] ?? 'errorGeneric');
        return;
      }
      setCounterFor(null);
      setCounterCut('');
      setCounterNote('');
      load();
      if (action === 'accept') {
        // A group was created or attached now - let the parent refresh.
        onChanged?.();
      }
    } catch {
      setErrorKey('errorGeneric');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-sm text-[var(--color-text-secondary)]">{t('subtitleCenter')}</p>
        <button
          type="button"
          onClick={openForm}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-teal-700"
        >
          <Plus size={16} aria-hidden /> {t('newProposalCenter')}
        </button>
      </div>

      {errorKey && (
        <p className="mt-3 mb-3 text-sm text-red-600" role="alert">
          {t(errorKey)}
        </p>
      )}

      {showForm && (
        <div className="mb-5 mt-3 flex flex-col gap-3 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] p-4">
          {/* Target: new group or attach to an existing teacher-less center group. */}
          <div className="flex gap-1 rounded-lg bg-[var(--color-surface-1)] p-1 w-fit">
            <button
              type="button"
              onClick={() => setTargetMode('new')}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${targetMode === 'new' ? 'bg-teal-600 text-white' : 'text-[var(--color-text-secondary)]'}`}
            >
              {t('targetNew')}
            </button>
            <button
              type="button"
              onClick={() => setTargetMode('existing')}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${targetMode === 'existing' ? 'bg-teal-600 text-white' : 'text-[var(--color-text-secondary)]'}`}
            >
              {t('targetExisting')}
            </button>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--color-text-primary)]">
              {t('teacherPickerLabel')}
            </label>
            {/* Source: an already-linked teacher, or add one by their code. */}
            <div className="mb-2 flex gap-1 rounded-lg bg-[var(--color-surface-1)] p-1 w-fit">
              <button
                type="button"
                onClick={() => setTeacherSource('linked')}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${teacherSource === 'linked' ? 'bg-teal-600 text-white' : 'text-[var(--color-text-secondary)]'}`}
              >
                {t('teacherSourceLinked')}
              </button>
              <button
                type="button"
                onClick={() => setTeacherSource('code')}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${teacherSource === 'code' ? 'bg-teal-600 text-white' : 'text-[var(--color-text-secondary)]'}`}
              >
                {t('teacherSourceByCode')}
              </button>
            </div>

            {teacherSource === 'code' ? (
              <>
                <input
                  value={form.teacherCode}
                  maxLength={32}
                  onChange={(e) => setForm((f) => ({ ...f, teacherCode: e.target.value }))}
                  placeholder={t('teacherCodePlaceholder')}
                  className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-3 py-2 font-mono text-sm uppercase text-[var(--color-text-primary)]"
                  dir="ltr"
                />
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">{t('combinedHint')}</p>
              </>
            ) : teachers.length === 0 ? (
              <p className="text-sm text-[var(--color-text-secondary)]">
                {teachersLoaded ? t('noLinkedTeachers') : t('loadingTeachers')}
              </p>
            ) : (
              <select
                value={form.teacherId}
                onChange={(e) => setForm((f) => ({ ...f, teacherId: e.target.value }))}
                className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
              >
                <option value="">{t('selectTeacher')}</option>
                {teachers.map((tc) => (
                  <option key={tc.id} value={tc.id}>
                    {tc.name ?? tc.id}
                    {tc.subject ? ` - ${tc.subject}` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          {targetMode === 'existing' ? (
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--color-text-primary)]">
                {t('existingGroupLabel')}
              </label>
              {attachGroups.length === 0 ? (
                <p className="text-sm text-[var(--color-text-secondary)]">
                  {teachersLoaded ? t('noAttachableGroups') : t('loadingTeachers')}
                </p>
              ) : (
                <select
                  value={form.targetGroupId}
                  onChange={(e) => setForm((f) => ({ ...f, targetGroupId: e.target.value }))}
                  className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
                >
                  <option value="">{t('selectGroup')}</option>
                  {attachGroups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name ?? g.id}
                      {g.subject ? ` - ${g.subject}` : ''}
                    </option>
                  ))}
                </select>
              )}
              {selectedAttachGroup && selectedAttachGroup.feePerClass != null && (
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                  {t('studentRate')}:{' '}
                  <span className="font-mono font-semibold">
                    {formatCurrency(selectedAttachGroup.feePerClass, locale)}
                  </span>
                </p>
              )}
            </div>
          ) : (
            <>
              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--color-text-primary)]">
                  {t('subjectLabel')}
                </label>
                <input
                  value={form.subject}
                  maxLength={120}
                  onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                  className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--color-text-primary)]">
                  {t('gradeLabel')}
                </label>
                <input
                  value={form.gradeLevel}
                  maxLength={120}
                  onChange={(e) => setForm((f) => ({ ...f, gradeLevel: e.target.value }))}
                  className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--color-text-primary)]">
                  {t('feeLabel')}
                </label>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={form.fee}
                  onChange={(e) => setForm((f) => ({ ...f, fee: e.target.value }))}
                  className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-3 py-2 font-mono text-sm text-[var(--color-text-primary)]"
                />
              </div>
            </>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--color-text-primary)]">
              {t('cutOfferLabel')}
            </label>
            <input
              type="number"
              min={0}
              step={0.01}
              value={form.cut}
              onChange={(e) => setForm((f) => ({ ...f, cut: e.target.value }))}
              className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-3 py-2 font-mono text-sm text-[var(--color-text-primary)]"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--color-text-primary)]">
              {t('messageLabel')}
            </label>
            <textarea
              value={form.message}
              maxLength={500}
              rows={2}
              onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
              className="w-full resize-none rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={submitProposal}
              disabled={
                submitting ||
                !teacherChosen ||
                !form.cut ||
                (targetMode === 'existing' ? !form.targetGroupId : !form.subject.trim() || !form.fee)
              }
              className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {submitting ? t('submitting') : t('submit')}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-lg border border-[var(--color-border-subtle)] px-4 py-2 text-sm text-[var(--color-text-secondary)]"
            >
              {t('cancel')}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="h-16 animate-pulse rounded-lg bg-[var(--color-surface-2)]" />
      ) : proposals.length === 0 ? (
        <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-8 text-center">
          <Handshake className="mx-auto mb-2 h-8 w-8 text-[var(--color-text-muted)]" aria-hidden />
          <p className="text-sm text-[var(--color-text-secondary)]">{t('emptyCenter')}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {proposals.map((p) => {
            const myTurn = p.status === 'open' && p.whoseTurn === 'center';
            const busy = busyId === p.id;
            const groupLabel = p.targetGroupId
              ? p.targetGroupName ?? p.subject
              : `${p.subject}${p.gradeLevel ? ` - ${p.gradeLevel}` : ''}`;
            return (
              <li
                key={p.id}
                className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[var(--color-text-primary)]">
                      {t('teacherLabel')}: {p.teacherName ?? '-'}
                      {p.teacherPhone ? (
                        <span className="ms-2 font-mono text-xs text-[var(--color-text-muted)]" dir="ltr">
                          {p.teacherPhone}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-sm text-[var(--color-text-secondary)]">{groupLabel}</p>
                    {p.targetGroupId && (
                      <span className="mt-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                        {t('attachBadge')}
                      </span>
                    )}
                    {p.carriesLink && p.status === 'open' && (
                      <span className="mt-1 ms-1 inline-block rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-xs font-semibold text-[var(--color-text-secondary)]">
                        {t('linkPendingBadge')}
                      </span>
                    )}
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                      {t('studentRate')}:{' '}
                      <span className="font-mono font-semibold">{formatCurrency(p.feePerClass, locale)}</span>
                    </p>
                    {p.targetGroupId && (
                      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                        {t('studentCountLabel')}:{' '}
                        <span className="font-mono font-semibold">{formatNumber(p.studentCount, locale)}</span>
                      </p>
                    )}
                    {p.openingMessage && (
                      <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{p.openingMessage}</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_CLASS[p.status]}`}>
                      {t(STATUS_KEY[p.status])}
                    </span>
                    <span className="text-xs text-[var(--color-text-muted)]">
                      {t(p.initiatedBy === 'center' ? 'initiatedByCenter' : 'initiatedByTeacher')}
                    </span>
                    {p.status === 'open' && (
                      <span className="text-xs font-medium text-[var(--color-text-secondary)]">
                        {myTurn ? t('yourTurn') : t('waitingTeacher')}
                      </span>
                    )}
                  </div>
                </div>

                {p.latestOffer && (
                  <p className="mt-2 text-sm text-[var(--color-text-primary)]">
                    {t('latestOffer')}:{' '}
                    <span className="font-mono font-semibold">{formatCurrency(p.latestOffer.cutEgp, locale)}</span>{' '}
                    <span className="text-xs text-[var(--color-text-muted)]">
                      ({p.latestOffer.madeBy === 'teacher' ? t('byTeacher') : t('byCenter')},{' '}
                      {formatDate(p.latestOffer.createdAt, locale)})
                    </span>
                  </p>
                )}
                {p.status === 'open' && (
                  <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                    {t('expiresOn', { date: formatDate(p.expiresAt, locale) })}
                  </p>
                )}

                {p.offers.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                    className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:underline"
                  >
                    {expandedId === p.id ? (
                      <>
                        <ChevronUp size={14} aria-hidden /> {t('hideHistory')}
                      </>
                    ) : (
                      <>
                        <ChevronDown size={14} aria-hidden /> {t('showHistory')}
                      </>
                    )}
                  </button>
                )}
                {expandedId === p.id && (
                  <ul className="mt-2 flex flex-col gap-1 border-s-2 border-[var(--color-border-subtle)] ps-3">
                    {p.offers.map((o) => (
                      <li key={o.id} className="text-xs text-[var(--color-text-secondary)]">
                        <span className="font-semibold">
                          {o.madeBy === 'teacher' ? t('byTeacher') : t('byCenter')}
                        </span>
                        {': '}
                        <span className="font-mono">{formatCurrency(o.cutEgp, locale)}</span>
                        {' - '}
                        {formatDate(o.createdAt, locale)}
                        {o.note ? ` - ${o.note}` : ''}
                      </li>
                    ))}
                  </ul>
                )}

                {p.status === 'open' && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {myTurn && p.latestOffer?.madeBy === 'teacher' && (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => respond(p.id, 'accept')}
                          className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
                        >
                          {t('accept')}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setCounterFor(counterFor === p.id ? null : p.id)}
                          className="rounded-lg border border-teal-600 px-3 py-1.5 text-xs font-semibold text-teal-700 disabled:opacity-50"
                        >
                          {t('counter')}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => respond(p.id, 'decline')}
                          className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-600 disabled:opacity-50"
                        >
                          {t('decline')}
                        </button>
                      </>
                    )}
                    {/* The center can pull its OWN standing offer (latest is the center's). */}
                    {p.latestOffer?.madeBy === 'center' && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => respond(p.id, 'withdraw')}
                        className="text-xs font-semibold text-[var(--color-text-muted)] hover:underline disabled:opacity-50"
                      >
                        {t('withdraw')}
                      </button>
                    )}
                  </div>
                )}

                {counterFor === p.id && p.status === 'open' && (
                  <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg bg-[var(--color-surface-2)] p-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-[var(--color-text-primary)]">
                        {t('counterCutLabel')}
                      </label>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={counterCut}
                        onChange={(e) => setCounterCut(e.target.value)}
                        className="w-32 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-2 py-1.5 font-mono text-sm text-[var(--color-text-primary)]"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <label className="mb-1 block text-xs font-medium text-[var(--color-text-primary)]">
                        {t('noteLabel')}
                      </label>
                      <input
                        value={counterNote}
                        maxLength={500}
                        onChange={(e) => setCounterNote(e.target.value)}
                        className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-2 py-1.5 text-sm text-[var(--color-text-primary)]"
                      />
                    </div>
                    <button
                      type="button"
                      disabled={busy || counterCut === '' || Number(counterCut) >= p.feePerClass}
                      onClick={() => respond(p.id, 'counter', Number(counterCut), counterNote)}
                      className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
                    >
                      {t('send')}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
