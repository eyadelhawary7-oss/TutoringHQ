'use client';

import { useCallback, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowRightLeft, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { getCsrfHeaders } from '@/lib/csrf-client';
import { formatCurrency, formatNumber } from '@/lib/formatNumber';

type CenterOption = { id: string; name: string | null };
type MyGroup = { id: string; name: string | null; feePerClass: number; activeStudents: number };

const ERROR_KEY: Record<string, string> = {
  NOT_A_MEMBER: 'errorNotMember',
  PROPOSAL_ALREADY_OPEN: 'errorAlreadyOpen',
  CUT_NOT_LESS_THAN_FEE: 'errorCutTooHigh',
  GROUP_NOT_SOLO: 'errorGroupNotSolo',
  GROUP_NO_FEE: 'errorGroupNoFee',
};

/**
 * Teacher portal (FREE zone): bring one of MY solo groups to a center. Picks a
 * private group (the teacher already runs, with its students), a center the
 * teacher is an active member of, and an opening cut. Sends a teacher-initiated
 * attach proposal; on center accept the group flips to center-attached (it then
 * lives on the center side of the portal). The student rate is the group's own;
 * only the cut is negotiated. Ends at cut-agreed - no scheduling.
 *
 * To bring a group to a center that is NOT listed, the teacher joins it by code
 * first (the JoinCenterCard above), then it appears here (linked-first).
 */
export default function BringGroupToCenterSection({
  centers,
  onCreated,
}: {
  centers: CenterOption[];
  onCreated?: () => void;
}) {
  const t = useTranslations('groupProposals');
  const locale = useLocale();

  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<MyGroup[]>([]);
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ groupId: '', centerId: '', cut: '', message: '' });

  const loadGroups = useCallback(async () => {
    setGroupsLoading(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch('/api/teacher/private/groups', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        const json = (await res.json()) as {
          groups: { id: string; name: string | null; fee_per_class: number; activeStudents: number }[];
        };
        setGroups(
          (json.groups ?? []).map((g) => ({
            id: g.id,
            name: g.name,
            feePerClass: Number(g.fee_per_class) || 0,
            activeStudents: g.activeStudents ?? 0,
          })),
        );
      }
    } catch {
      // Non-fatal: the picker renders empty.
    } finally {
      setGroupsLoaded(true);
      setGroupsLoading(false);
    }
  }, []);

  const openForm = () => {
    setOpen((v) => !v);
    if (!groupsLoaded) loadGroups();
  };

  const selected = groups.find((g) => g.id === form.groupId) ?? null;
  const fee = selected?.feePerClass ?? 0;

  const submit = async () => {
    const cut = Number(form.cut);
    if (!form.groupId || !form.centerId) return;
    if (!Number.isFinite(cut) || cut < 0 || !(fee > 0) || cut >= fee) {
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
      const res = await fetch('/api/teacher/group-attach', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          ...(await getCsrfHeaders(session.access_token)),
        },
        body: JSON.stringify({
          group_id: form.groupId,
          center_id: form.centerId,
          opening_cut_egp: cut,
          opening_message: form.message.trim() || undefined,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { code?: string };
      if (!res.ok) {
        setErrorKey(ERROR_KEY[json.code ?? ''] ?? 'errorGeneric');
        return;
      }
      setOpen(false);
      setForm({ groupId: '', centerId: '', cut: '', message: '' });
      onCreated?.();
    } catch {
      setErrorKey('errorGeneric');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--color-teal)]/40 bg-[var(--color-surface-1)] p-6">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-bold text-[var(--color-text-primary)]">
          <ArrowRightLeft size={18} className="text-[var(--color-teal-deep)]" aria-hidden />
          {t('bringTitle')}
        </h2>
        {centers.length > 0 && (
          <button
            type="button"
            onClick={openForm}
            className="rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-teal-700"
          >
            {t('bringButton')}
          </button>
        )}
      </div>
      <p className="mb-4 text-sm text-[var(--color-text-secondary)]">{t('bringSubtitle')}</p>

      {errorKey && (
        <p className="mb-3 text-sm text-[var(--color-danger)]" role="alert">
          {t(errorKey)}
        </p>
      )}

      {centers.length === 0 ? (
        <p className="text-sm text-[var(--color-text-secondary)]">{t('joinNewCenterHint')}</p>
      ) : open ? (
        <div className="flex flex-col gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] p-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--color-text-primary)]">
              {t('myGroupLabel')}
            </label>
            {groupsLoading ? (
              <p className="text-sm text-[var(--color-text-secondary)]">{t('loadingMyGroups')}</p>
            ) : groups.length === 0 ? (
              <p className="text-sm text-[var(--color-text-secondary)]">{t('noSoloGroups')}</p>
            ) : (
              <select
                value={form.groupId}
                onChange={(e) => setForm((f) => ({ ...f, groupId: e.target.value }))}
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
              >
                <option value="">{t('selectMyGroup')}</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name ?? g.id}
                  </option>
                ))}
              </select>
            )}
            {selected && (
              <div className="mt-2 flex flex-col gap-0.5 rounded-lg bg-[var(--color-surface-2)] p-3 text-xs text-[var(--color-text-muted)]">
                <p>
                  {t('studentRate')}:{' '}
                  <span className="font-mono font-semibold text-[var(--color-text-primary)]">
                    {formatCurrency(selected.feePerClass, locale)}
                  </span>
                </p>
                <p>
                  {t('studentCountLabel')}:{' '}
                  <span className="font-mono font-semibold text-[var(--color-text-primary)]">
                    {formatNumber(selected.activeStudents, locale)}
                  </span>
                </p>
              </div>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--color-text-primary)]">
              {t('centerLabel')}
            </label>
            <select
              value={form.centerId}
              onChange={(e) => setForm((f) => ({ ...f, centerId: e.target.value }))}
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
            >
              <option value="">{t('selectCenter')}</option>
              {centers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name ?? c.id}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">{t('joinNewCenterHint')}</p>
          </div>

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
              onClick={submit}
              disabled={submitting || !form.groupId || !form.centerId || !form.cut}
              className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {submitting ? t('submitting') : t('submit')}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setForm({ groupId: '', centerId: '', cut: '', message: '' });
              }}
              className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-secondary)]"
            >
              {t('cancel')}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
