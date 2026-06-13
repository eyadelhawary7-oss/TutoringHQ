'use client';

import { use, useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowRight, ArrowLeft, Loader2, Plus, Settings2, UserRound } from 'lucide-react';
import { Link, useRouter } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/formatNumber';
import AddStudentModal from './AddStudentModal';
import EditGroupModal from './EditGroupModal';
import SessionsSection from './SessionsSection';
import GroupJoinLinkCard from '../../../GroupJoinLinkCard';

type RosterEntry = {
  enrollmentId: string;
  status: string;
  payer: string | null;
  joinedAt: string | null;
  student: { id: string; name: string | null; phone: string | null };
};

type RosterData = {
  group: {
    id: string;
    name: string | null;
    fee_per_class: number;
    approval_mode: string | null;
    status: string | null;
  };
  roster: RosterEntry[];
};

export default function TeacherGroupDetailPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = use(params);
  const t = useTranslations('teacherPortal.roster');
  const tPortal = useTranslations('teacherPortal');
  const tCaps = useTranslations('caps');
  const locale = useLocale();
  const router = useRouter();

  const [data, setData] = useState<RosterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState(false);

  const loadRoster = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.replace('/login');
        return;
      }
      const res = await fetch(`/api/teacher/private/groups/${groupId}/roster`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.status === 401) {
        router.replace('/login');
        return;
      }
      if (res.status === 403 || res.status === 404) {
        // Lapsed (gate) or not the teacher's group - the home renders the
        // correct state either way.
        router.replace('/teacher');
        return;
      }
      if (!res.ok) {
        setLoadError(true);
        return;
      }
      setData((await res.json()) as RosterData);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [groupId, router]);

  useEffect(() => {
    loadRoster();
  }, [loadRoster]);

  const decide = async (enrollmentId: string, action: 'approve' | 'reject') => {
    setDecidingId(enrollmentId);
    setActionError(false);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.replace('/login');
        return;
      }
      const res = await fetch(`/api/teacher/private/groups/${groupId}/enrollments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ enrollment_id: enrollmentId, action }),
      });
      // 409 invalid_transition means it was decided elsewhere - the refetch
      // below shows the truth either way.
      if (!res.ok && res.status !== 409) {
        setActionError(true);
      }
      await loadRoster();
    } catch {
      setActionError(true);
    } finally {
      setDecidingId(null);
    }
  };

  const BackIcon = locale === 'ar' ? ArrowRight : ArrowLeft;

  if (loading && !data) {
    return (
      <div>
        <div className="mb-6 h-7 w-44 animate-pulse rounded-lg bg-[var(--color-surface-2)]" />
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="mb-3 h-16 animate-pulse rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)]"
          />
        ))}
      </div>
    );
  }

  if (loadError || !data) {
    return (
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-8 text-center">
        <h2 className="mb-2 text-lg font-bold text-[var(--color-text-primary)]">
          {tPortal('errorTitle')}
        </h2>
        <p className="mb-6 text-sm text-[var(--color-text-secondary)]">{tPortal('errorBody')}</p>
        <button
          onClick={loadRoster}
          className="rounded-lg bg-teal-600 px-4 py-2 font-medium text-primary-foreground transition-colors hover:bg-teal-700"
        >
          {tPortal('retry')}
        </button>
      </div>
    );
  }

  const pending = data.roster.filter((r) => r.status === 'pending');
  const active = data.roster.filter((r) => r.status === 'active');

  const payerLabel = (payer: string | null) =>
    payer === 'parent' ? t('payerParent') : payer === 'student' ? t('payerStudent') : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/teacher"
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
        >
          <BackIcon size={16} aria-hidden />
          {t('back')}
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{data.group.name}</h1>
            <button
              type="button"
              onClick={() => setShowEdit(true)}
              aria-label={tPortal('editGroup.title')}
              className="rounded-lg border border-[var(--color-border)] p-2 text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-2)]"
            >
              <Settings2 size={16} aria-hidden />
            </button>
          </div>
          <span className="text-sm text-[var(--color-text-secondary)]">
            {tPortal('groups.feePerClass')}{' '}
            <span className="font-semibold text-[var(--color-text-primary)]">
              {formatCurrency(data.group.fee_per_class, locale)}
            </span>
          </span>
        </div>
      </div>

      <GroupJoinLinkCard groupId={groupId} groupName={data.group.name} />

      {actionError && (
        <p className="rounded-lg border border-[var(--color-danger-muted)] bg-[var(--color-danger-muted)] p-3 text-sm text-[var(--color-danger)]">
          {t('actionError')}
        </p>
      )}

      {pending.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-[var(--color-warning)]">{t('pendingTitle')}</h2>
          <ul className="flex flex-col gap-2">
            {pending.map((r) => (
              <li
                key={r.enrollmentId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-warning)]/30 bg-[var(--color-surface-1)] px-4 py-3"
              >
                <div>
                  <p className="font-medium text-[var(--color-text-primary)]">{r.student.name}</p>
                  <p className="text-sm text-[var(--color-text-muted)]" dir="ltr">
                    {r.student.phone}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {decidingId === r.enrollmentId ? (
                    <Loader2 className="h-4 w-4 animate-spin text-[var(--color-text-muted)]" aria-hidden />
                  ) : (
                    <>
                      <button
                        onClick={() => decide(r.enrollmentId, 'approve')}
                        className="rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-teal-700"
                      >
                        {t('approve')}
                      </button>
                      <button
                        onClick={() => decide(r.enrollmentId, 'reject')}
                        className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-2)]"
                      >
                        {t('reject')}
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-muted)]">
            <UserRound size={14} aria-hidden />
            {t('studentsTitle')}
          </h2>
          <button
            onClick={() => setShowAdd(true)}
            title={tCaps('studentTooltip')}
            className="flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-teal-700"
          >
            <Plus size={16} aria-hidden />
            {t('addStudent')}
          </button>
        </div>

        {active.length === 0 && pending.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface-1)] p-6 text-sm text-[var(--color-text-secondary)]">
            {t('empty')}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {active.map((r) => (
              <li
                key={r.enrollmentId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-4 py-3"
              >
                <div>
                  <p className="font-medium text-[var(--color-text-primary)]">{r.student.name}</p>
                  <p className="text-sm text-[var(--color-text-muted)]" dir="ltr">
                    {r.student.phone}
                  </p>
                </div>
                {payerLabel(r.payer) && (
                  <span className="rounded-full bg-[var(--color-surface-2)] px-3 py-1 text-xs text-[var(--color-text-secondary)]">
                    {payerLabel(r.payer)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <SessionsSection groupId={groupId} />

      <AddStudentModal
        groupId={groupId}
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onAdded={() => {
          setShowAdd(false);
          loadRoster();
        }}
      />

      <EditGroupModal
        group={{
          id: data.group.id,
          name: data.group.name,
          fee_per_class: data.group.fee_per_class,
        }}
        enrolledCount={active.length}
        open={showEdit}
        onClose={() => setShowEdit(false)}
        onSaved={() => {
          setShowEdit(false);
          loadRoster();
        }}
        onArchived={() => {
          setShowEdit(false);
          router.replace('/teacher/groups');
        }}
      />
    </div>
  );
}
