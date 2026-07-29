'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Handshake, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { getCsrfHeaders } from '@/lib/csrf-client';
import { formatCurrency, formatDate, formatNumber } from '@/lib/formatNumber';
import OfferHistory from '@/components/group-proposals/OfferHistory';
import CounterOfferForm from '@/components/group-proposals/CounterOfferForm';
import { STATUS_KEY, type Offer } from '@/components/group-proposals/types';

type Proposal = {
  id: string;
  centerId: string;
  centerName: string | null;
  centerPhone: string | null;
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
  offerCount: number;
  latestOffer: Offer | null;
  whoseTurn: 'teacher' | 'center' | null;
  offers: Offer[];
};

type CenterOption = { id: string; name: string | null };
type JoinableGroup = {
  id: string;
  name: string | null;
  subject: string | null;
  feePerClass: number | null;
  centerCutEgp: number;
  studentCount: number;
};

const ERROR_KEY: Record<string, string> = {
  NOT_YOUR_TURN: 'errorNotYourTurn',
  PROPOSAL_ALREADY_OPEN: 'errorAlreadyOpen',
  CUT_NOT_LESS_THAN_FEE: 'errorCutTooHigh',
  NOT_A_MEMBER: 'errorNotMember',
  CENTER_CODE_NOT_FOUND: 'errorCenterCodeNotFound',
  GROUP_HAS_TEACHER: 'errorGroupHasTeacher',
  GROUP_NOT_ELIGIBLE: 'errorGroupNotEligible',
  GROUP_NO_FEE: 'errorGroupNoFee',
  GROUP_NOT_FOUND: 'errorGroupNotFound',
};

const STATUS_CLASS: Record<Proposal['status'], string> = {
  open: 'bg-[var(--color-teal-soft)] text-[var(--color-teal-deep)]',
  accepted: 'bg-emerald-100 text-emerald-800',
  declined: 'bg-red-100 text-red-700',
  withdrawn: 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]',
  expired: 'bg-amber-100 text-amber-800',
};

/**
 * Teacher portal "Group Proposals" section (FREE zone). Two teacher-initiated
 * flavours, both negotiating the center cut with the same offer/counter loop:
 *  - NEW group: propose a brand-new group to a center.
 *  - EXISTING group: ask to RUN one of the center's teacher-less groups.
 *
 * The center is chosen two ways (Ref 2 & 3): a center the teacher is ALREADY in,
 * OR a center reached by its code (a non-member center). The by-code path only
 * proposes a NEW group (a non-member can't see a center's existing groups) and
 * sends a REQUEST: the center joins the teacher AND takes on the group only when
 * it accepts. The student rate (fee_per_class) is immutable; only the cut moves.
 */
export default function GroupProposalsSection({
  centers,
  refreshKey = 0,
}: {
  centers: CenterOption[];
  refreshKey?: number;
}) {
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

  const [showForm, setShowForm] = useState(false);
  // Center source: a center the teacher is already in, or a non-member center by
  // its code. By-code only supports the NEW-group flavour.
  const [centerSource, setCenterSource] = useState<'member' | 'code'>('member');
  const [targetMode, setTargetMode] = useState<'new' | 'existing'>('new');
  const [joinableGroups, setJoinableGroups] = useState<JoinableGroup[]>([]);
  const [joinableLoading, setJoinableLoading] = useState(false);
  const [joinableLoadedFor, setJoinableLoadedFor] = useState<string | null>(null);
  const [form, setForm] = useState({
    centerId: '',
    centerCode: '',
    subject: '',
    gradeLevel: '',
    fee: '',
    cut: '',
    message: '',
    targetGroupId: '',
  });
  const [submitting, setSubmitting] = useState(false);

  const byCode = centerSource === 'code';

  const load = useCallback(async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch('/api/teacher/group-proposals', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) return;
      const json = (await res.json()) as { proposals: Proposal[] };
      setProposals(json.proposals ?? []);
    } catch {
      // Non-fatal: the section renders empty and the form still works.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const loadJoinable = useCallback(async (centerId: string) => {
    setJoinableLoading(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(`/api/teacher/joinable-groups?center_id=${encodeURIComponent(centerId)}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        const json = (await res.json()) as { groups: JoinableGroup[] };
        setJoinableGroups(json.groups ?? []);
      } else {
        setJoinableGroups([]);
      }
      setJoinableLoadedFor(centerId);
    } catch {
      setJoinableGroups([]);
    } finally {
      setJoinableLoading(false);
    }
  }, []);

  // Joinable groups only exist for a member center (the by-code path is new-group
  // only, so it never loads them).
  useEffect(() => {
    if (showForm && !byCode && targetMode === 'existing' && form.centerId && joinableLoadedFor !== form.centerId) {
      loadJoinable(form.centerId);
    }
  }, [showForm, byCode, targetMode, form.centerId, joinableLoadedFor, loadJoinable]);

  const selectedJoinable = joinableGroups.find((g) => g.id === form.targetGroupId) ?? null;
  // The fee that bounds the cut: an existing group's fee for an attach request,
  // else the typed fee for a new group.
  const effectiveFee =
    !byCode && targetMode === 'existing' ? selectedJoinable?.feePerClass ?? 0 : Number(form.fee);

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
      const res = await fetch(`/api/teacher/group-proposals/${proposalId}/respond`, {
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
    } catch {
      setErrorKey('errorGeneric');
    } finally {
      setBusyId(null);
    }
  };

  const resetForm = () => {
    setForm({ centerId: '', centerCode: '', subject: '', gradeLevel: '', fee: '', cut: '', message: '', targetGroupId: '' });
    setCenterSource('member');
    setTargetMode('new');
    setJoinableGroups([]);
    setJoinableLoadedFor(null);
  };

  const submitProposal = async () => {
    const cut = Number(form.cut);
    if (byCode) {
      if (!form.centerCode.trim() || !form.subject.trim() || !Number.isFinite(effectiveFee) || effectiveFee <= 0) {
        return;
      }
    } else {
      if (!form.centerId) return;
      if (targetMode === 'existing') {
        if (!form.targetGroupId || !selectedJoinable || selectedJoinable.feePerClass == null) return;
      } else if (!form.subject.trim() || !Number.isFinite(effectiveFee) || effectiveFee <= 0) {
        return;
      }
    }
    if (!Number.isFinite(cut) || cut < 0 || !(effectiveFee > 0) || cut >= effectiveFee) {
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
      // By-code: reach a non-member center by code (new group only). Member:
      // existing-group sends target_group_id; new-group sends subject/grade/fee.
      const body = byCode
        ? {
            center_code: form.centerCode.trim(),
            subject: form.subject.trim(),
            grade_level: form.gradeLevel.trim() || undefined,
            fee_per_class: Number(form.fee),
            opening_cut_egp: cut,
            opening_message: form.message.trim() || undefined,
          }
        : targetMode === 'existing'
          ? {
              center_id: form.centerId,
              target_group_id: form.targetGroupId,
              opening_cut_egp: cut,
              opening_message: form.message.trim() || undefined,
            }
          : {
              center_id: form.centerId,
              subject: form.subject.trim(),
              grade_level: form.gradeLevel.trim() || undefined,
              fee_per_class: Number(form.fee),
              opening_cut_egp: cut,
              opening_message: form.message.trim() || undefined,
            };
      const res = await fetch('/api/teacher/group-proposals', {
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
      resetForm();
      load();
    } catch {
      setErrorKey('errorGeneric');
    } finally {
      setSubmitting(false);
    }
  };

  const submitDisabled =
    submitting ||
    !form.cut ||
    (byCode
      ? !form.centerCode.trim() || !form.subject.trim() || !form.fee
      : !form.centerId ||
        (targetMode === 'existing' ? !form.targetGroupId : !form.subject.trim() || !form.fee));

  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--color-teal)]/40 bg-[var(--color-surface-1)] p-6">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-bold text-[var(--color-text-primary)]">
          <Handshake size={18} className="text-[var(--color-teal-deep)]" aria-hidden />
          {t('title')}
        </h2>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-teal-700"
        >
          {t('newProposal')}
        </button>
      </div>
      <p className="mb-4 text-sm text-[var(--color-text-secondary)]">{t('subtitleTeacher')}</p>

      {errorKey && (
        <p className="mb-3 text-sm text-[var(--color-danger)]" role="alert">
          {t(errorKey)}
        </p>
      )}

      {showForm && (
        <div className="mb-5 flex flex-col gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] p-4">
          {/* Center source: a center I'm in, or a non-member center by code. */}
          <div className="flex w-fit gap-1 rounded-lg bg-[var(--color-surface-2)] p-1">
            <button
              type="button"
              onClick={() => {
                setCenterSource('member');
                setForm((f) => ({ ...f, centerCode: '' }));
              }}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${!byCode ? 'bg-teal-600 text-white' : 'text-[var(--color-text-secondary)]'}`}
            >
              {t('centerSourceMember')}
            </button>
            <button
              type="button"
              onClick={() => {
                setCenterSource('code');
                setTargetMode('new');
                setForm((f) => ({ ...f, centerId: '', targetGroupId: '' }));
              }}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${byCode ? 'bg-teal-600 text-white' : 'text-[var(--color-text-secondary)]'}`}
            >
              {t('centerSourceByCode')}
            </button>
          </div>

          {/* Target toggle: only for member centers (by-code is new-group only). */}
          {!byCode && (
            <div className="flex w-fit gap-1 rounded-lg bg-[var(--color-surface-2)] p-1">
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
          )}

          {byCode ? (
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--color-text-primary)]">
                {t('centerCodeLabel')}
              </label>
              <input
                value={form.centerCode}
                maxLength={32}
                onChange={(e) => setForm((f) => ({ ...f, centerCode: e.target.value }))}
                placeholder={t('centerCodePlaceholder')}
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-2 font-mono text-sm uppercase text-[var(--color-text-primary)]"
                dir="ltr"
              />
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">{t('byCodeHint')}</p>
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--color-text-primary)]">
                {t('centerLabel')}
              </label>
              <select
                value={form.centerId}
                onChange={(e) =>
                  setForm((f) => ({ ...f, centerId: e.target.value, targetGroupId: '', cut: '' }))
                }
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
              >
                <option value="">{t('selectCenter')}</option>
                {centers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name ?? c.id}
                  </option>
                ))}
              </select>
              {centers.length === 0 && (
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">{t('noMemberCentersHint')}</p>
              )}
            </div>
          )}

          {!byCode && targetMode === 'existing' ? (
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--color-text-primary)]">
                {t('existingGroupLabel')}
              </label>
              {!form.centerId ? (
                <p className="text-sm text-[var(--color-text-secondary)]">{t('selectCenterFirst')}</p>
              ) : joinableLoading ? (
                <p className="text-sm text-[var(--color-text-secondary)]">{t('loadingGroups')}</p>
              ) : joinableGroups.length === 0 ? (
                <p className="text-sm text-[var(--color-text-secondary)]">{t('noJoinableGroups')}</p>
              ) : (
                <select
                  value={form.targetGroupId}
                  onChange={(e) => {
                    const g = joinableGroups.find((x) => x.id === e.target.value) ?? null;
                    setForm((f) => ({
                      ...f,
                      targetGroupId: e.target.value,
                      cut: g ? String(g.centerCutEgp) : '',
                    }));
                  }}
                  className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
                >
                  <option value="">{t('selectGroup')}</option>
                  {joinableGroups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name ?? g.id}
                      {g.subject ? ` - ${g.subject}` : ''}
                    </option>
                  ))}
                </select>
              )}
              {selectedJoinable && (
                <div className="mt-2 flex flex-col gap-0.5 rounded-lg bg-[var(--color-surface-2)] p-3 text-xs text-[var(--color-text-muted)]">
                  {selectedJoinable.feePerClass != null && (
                    <p>
                      {t('studentRate')}:{' '}
                      <span className="font-mono font-semibold text-[var(--color-text-primary)]">
                        {formatCurrency(selectedJoinable.feePerClass, locale)}
                      </span>
                    </p>
                  )}
                  {selectedJoinable.feePerClass != null && (
                    <p>
                      {t('youEarn')}:{' '}
                      <span className="font-mono font-semibold text-[var(--color-teal-deep)]">
                        {formatCurrency(
                          selectedJoinable.feePerClass - selectedJoinable.centerCutEgp,
                          locale,
                        )}
                      </span>
                    </p>
                  )}
                  <p>
                    {t('groupCurrentCut')}:{' '}
                    <span className="font-mono font-semibold text-[var(--color-text-primary)]">
                      {formatCurrency(selectedJoinable.centerCutEgp, locale)}
                    </span>
                  </p>
                  <p>
                    {t('studentCountLabel')}:{' '}
                    <span className="font-mono font-semibold text-[var(--color-text-primary)]">
                      {formatNumber(selectedJoinable.studentCount, locale)}
                    </span>
                  </p>
                </div>
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
                  className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
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
                  className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
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
                  className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-2 font-mono text-sm text-[var(--color-text-primary)]"
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
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-2 font-mono text-sm text-[var(--color-text-primary)]"
            />
            {form.cut !== '' && effectiveFee > 0 && Number.isFinite(Number(form.cut)) && (
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                {t('youEarn')}:{' '}
                <span className="font-mono font-semibold text-[var(--color-teal-deep)]">
                  {formatCurrency(effectiveFee - Number(form.cut), locale)}
                </span>
              </p>
            )}
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
              className="w-full resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={submitProposal}
              disabled={submitDisabled}
              className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {submitting ? t('submitting') : byCode ? t('sendRequest') : t('submit')}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                resetForm();
              }}
              className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-secondary)]"
            >
              {t('cancel')}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="h-16 animate-pulse rounded-lg bg-[var(--color-surface-2)]" />
      ) : proposals.length === 0 ? (
        <p className="text-sm text-[var(--color-text-secondary)]">{t('empty')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {proposals.map((p) => {
            const myTurn = p.status === 'open' && p.whoseTurn === 'teacher';
            const busy = busyId === p.id;
            const groupLabel = p.targetGroupId
              ? p.targetGroupName ?? p.subject
              : `${p.subject}${p.gradeLevel ? ` - ${p.gradeLevel}` : ''}`;
            return (
              <li key={p.id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[var(--color-text-primary)]">
                      {p.centerName ?? '-'}
                    </p>
                    {p.centerPhone ? (
                      <p className="text-xs font-mono text-[var(--color-text-muted)]" dir="ltr">
                        {p.centerPhone}
                      </p>
                    ) : null}
                    <p className="text-sm text-[var(--color-text-secondary)]">{groupLabel}</p>
                    {p.targetGroupId && (
                      <span className="mt-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                        {t('attachBadge')}
                      </span>
                    )}
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                      {t('studentRate')}:{' '}
                      <span className="font-mono font-semibold">{formatCurrency(p.feePerClass, locale)}</span>
                    </p>
                    {p.latestOffer && (
                      <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                        {t('youEarn')}:{' '}
                        <span className="font-mono font-semibold text-[var(--color-teal-deep)]">
                          {formatCurrency(p.feePerClass - p.latestOffer.cutEgp, locale)}
                        </span>
                      </p>
                    )}
                    {p.targetGroupId && (
                      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                        {t('studentCountLabel')}:{' '}
                        <span className="font-mono font-semibold">{formatNumber(p.studentCount, locale)}</span>
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_CLASS[p.status]}`}>
                      {t(STATUS_KEY[p.status])}
                    </span>
                    <span className="rounded-full bg-[var(--color-teal-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--color-teal-deep)]">
                      {t(p.initiatedBy === 'center' ? 'initiatedByCenter' : 'initiatedByTeacher')}
                    </span>
                    {p.status === 'open' && (
                      <span className="text-xs font-medium text-[var(--color-text-secondary)]">
                        {myTurn ? t('yourTurn') : t('waitingCenter')}
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

                <OfferHistory
                  offers={p.offers}
                  expanded={expandedId === p.id}
                  onToggle={() => setExpandedId(expandedId === p.id ? null : p.id)}
                  borderClass="border-[var(--color-border)]"
                />

                {/* Combined center-initiated request: accepting/countering also
                    JOINS the center. */}
                {p.carriesLink && p.initiatedBy === 'center' && p.status === 'open' && (
                  <p className="mt-2 rounded-lg bg-[var(--color-teal-soft)] px-3 py-2 text-xs text-[var(--color-teal-deep)]">
                    {t('combinedJoinNote', { center: p.centerName ?? t('thisCenter') })}
                  </p>
                )}
                {/* Teacher-by-code request: pending the center's approval to join +
                    take on the group. */}
                {p.carriesLink && p.initiatedBy === 'teacher' && p.status === 'open' && (
                  <p className="mt-2 rounded-lg bg-[var(--color-surface-2)] px-3 py-2 text-xs text-[var(--color-text-secondary)]">
                    {t('byCodePendingNote', { center: p.centerName ?? t('thisCenter') })}
                  </p>
                )}

                {p.status === 'open' && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {myTurn && p.latestOffer?.madeBy === 'center' && (
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
                          className="rounded-lg border border-[var(--color-teal)] px-3 py-1.5 text-xs font-semibold text-[var(--color-teal-deep)] disabled:opacity-50"
                        >
                          {t('counter')}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => respond(p.id, 'decline')}
                          className="rounded-lg border border-[var(--color-danger)]/50 px-3 py-1.5 text-xs font-semibold text-[var(--color-danger)] disabled:opacity-50"
                        >
                          {t('decline')}
                        </button>
                      </>
                    )}
                    {p.latestOffer?.madeBy === 'teacher' && (
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
                  <CounterOfferForm
                    counterCut={counterCut}
                    setCounterCut={setCounterCut}
                    counterNote={counterNote}
                    setCounterNote={setCounterNote}
                    onSend={() => respond(p.id, 'counter', Number(counterCut), counterNote)}
                    busy={busy}
                    feePerClass={p.feePerClass}
                    borderClass="border-[var(--color-border)]"
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
