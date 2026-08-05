'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { UserPlus, Loader2, X } from 'lucide-react';
import { EmptyState } from '@/components/shared';
import { supabase } from '@/lib/supabase';
import { getCsrfHeaders } from '@/lib/csrf-client';
import { useToast } from '@/hooks/useToast';
import { formatDate } from '@/lib/formatNumber';

type Req = {
  id: string;
  teacherName: string | null;
  subject: string | null;
  message: string | null;
  createdAt: string;
};

type Group = { id: string; name: string | null };

/**
 * Center-side "Teacher join requests" section, rendered inside the team/staff
 * settings page (owner/admin only). Lists pending teacher-initiated join
 * requests and lets the owner accept (optionally assigning the teacher to a
 * center group) or decline.
 */
export default function TeacherJoinRequests() {
  const t = useTranslations('settings.joinRequests');
  const locale = useLocale();
  const toast = useToast();

  const [requests, setRequests] = useState<Req[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Accept modal state
  const [acceptTarget, setAcceptTarget] = useState<Req | null>(null);
  const [selectedGroup, setSelectedGroup] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch('/api/center/teacher-requests', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        setLoadError(true);
        return;
      }
      const json = (await res.json()) as { requests: Req[]; groups: Group[] };
      setRequests(json.requests ?? []);
      setGroups(json.groups ?? []);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const respond = useCallback(
    async (req: Req, action: 'accept' | 'decline', groupId?: string) => {
      if (busyId) return;
      setBusyId(req.id);
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) return;
        const res = await fetch(`/api/center/teacher-requests/${req.id}/respond`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
            ...(await getCsrfHeaders(session.access_token)),
          },
          body: JSON.stringify({ action, groupId: groupId || undefined }),
        });
        if (!res.ok) {
          toast.error(t('errorToast'));
          return;
        }
        const teacher = req.teacherName ?? t('unknownTeacher');
        toast.success(action === 'accept' ? t('acceptedToast', { teacher }) : t('declinedToast', { teacher }));
        setAcceptTarget(null);
        setSelectedGroup('');
        load();
      } catch {
        toast.error(t('errorToast'));
      } finally {
        setBusyId(null);
      }
    },
    [busyId, load, t, toast],
  );

  // Hidden entirely until we know there is something to show or an error - keeps
  // the team page clean for centers that never receive requests.
  if (loading) return null;
  if (loadError) return null;
  if (requests.length === 0) {
    return (
      <section className="mb-6 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] card-shadow p-5">
        {/* §01 quiet variant · a join request is sent by a teacher; the owner
            cannot create one, so this state has no action by design and takes
            the muted tile rather than the mint one. The section heading stays
            because it is the card's own label, not part of the empty state. */}
        <h2 className="mb-1 flex items-center gap-2 text-lg font-bold text-[var(--color-text-primary)]">
          <UserPlus className="h-5 w-5 text-[var(--color-teal-deep)]" aria-hidden />
          {t('title')}
        </h2>
        <EmptyState icon={UserPlus} title={t('empty')} quiet />
      </section>
    );
  }

  return (
    <section className="mb-6 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] card-shadow p-5">
      <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-[var(--color-text-primary)]">
        <UserPlus className="h-5 w-5 text-[var(--color-teal-deep)]" aria-hidden />
        {t('title')}
      </h2>
      <ul className="flex flex-col gap-3">
        {requests.map((r) => (
          <li
            key={r.id}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-[var(--color-text-primary)]">
                  {r.teacherName ?? t('unknownTeacher')}
                  {r.subject && (
                    <span className="ms-2 text-sm font-normal text-[var(--color-text-muted)]">
                      {r.subject}
                    </span>
                  )}
                </p>
                {r.message && (
                  <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{r.message}</p>
                )}
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                  {formatDate(r.createdAt, locale)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedGroup('');
                    setAcceptTarget(r);
                  }}
                  disabled={busyId === r.id}
                  className="rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-teal-700 disabled:opacity-50"
                >
                  {t('accept')}
                </button>
                <button
                  type="button"
                  onClick={() => respond(r, 'decline')}
                  disabled={busyId === r.id}
                  className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-2)] disabled:opacity-50"
                >
                  {t('decline')}
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {acceptTarget && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => (busyId ? null : setAcceptTarget(null))}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-2">
              <h3 className="text-base font-bold text-[var(--color-text-primary)]">{t('assignTitle')}</h3>
              <button
                type="button"
                onClick={() => (busyId ? null : setAcceptTarget(null))}
                aria-label={t('cancel')}
                className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <p className="mb-4 text-sm text-[var(--color-text-secondary)]">{t('assignSubtitle')}</p>
            <select
              value={selectedGroup}
              onChange={(e) => setSelectedGroup(e.target.value)}
              className="mb-5 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              <option value="">{t('noGroup')}</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name ?? g.id}
                </option>
              ))}
            </select>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => (busyId ? null : setAcceptTarget(null))}
                className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-2)]"
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                onClick={() => respond(acceptTarget, 'accept', selectedGroup)}
                disabled={busyId === acceptTarget.id}
                className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-teal-700 disabled:opacity-50"
              >
                {busyId === acceptTarget.id && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                {selectedGroup ? t('acceptWithGroup') : t('acceptWithoutGroup')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
