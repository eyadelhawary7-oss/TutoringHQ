'use client';

import { use, useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import {
  ArrowRight,
  ArrowLeft,
  Check,
  Loader2,
  MessageCircle,
  Phone,
  Plus,
  Settings2,
  UserMinus,
  UserRound,
  X,
} from 'lucide-react';
import { Link, useRouter } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { getCsrfHeaders } from '@/lib/csrf-client';
import { formatCurrency, formatDate, formatNumber } from '@/lib/formatNumber';
import { useToast } from '@/hooks/useToast';
import {
  ActionSheet,
  ExpandableRow,
  ListRow,
  type InlineAction,
  type SheetAction,
} from '@/components/patterns';
import AddStudentModal from './AddStudentModal';
import EditGroupModal from './EditGroupModal';
import StudentNoteRow from './StudentNoteRow';
import GroupJoinLinkCard from '../../../GroupJoinLinkCard';
import GroupClassesTab from './GroupClassesTab';
import GroupRecentClasses from './GroupRecentClasses';
import GroupScheduleTab from './GroupScheduleTab';
import { fetchTeacherSubscription } from '@/components/teacher/teacherSubscriptionClient';
import { isProOrAbove } from '@/lib/teacherPlans';
import { initialsOf } from '@/lib/initials';
import { formatRelativeMinutesAgo } from '@/lib/formatNumber';

type RosterEntry = {
  enrollmentId: string;
  status: string;
  payer: string | null;
  joinedAt: string | null;
  createdAt: string;
  source: string | null;
  outstanding: number;
  student: {
    id: string;
    name: string | null;
    phone: string | null;
    parentPhone: string | null;
    gradeLevel: string | null;
  };
};

/** Digits, country-code-prefixed, no leading '+' - the wa.me / tel: contract used across the app. */
function intlDigits(raw: string | null): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('20')) return d;
  if (d.startsWith('0')) return `20${d.slice(1)}`;
  return `20${d}`;
}

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

const TABS = ['overview', 'students', 'classes', 'schedule'] as const;
type Tab = (typeof TABS)[number];

export default function TeacherGroupDetailPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = use(params);
  const t = useTranslations('teacherPortal.roster');
  const tTabs = useTranslations('teacherPortal.groupTabs');
  const tPortal = useTranslations('teacherPortal');
  const tGroups = useTranslations('teacherPortal.groups');
  const tCaps = useTranslations('caps');
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const searchParams = useSearchParams();
  const tabParam = searchParams?.get('tab') ?? null;

  const [tab, setTab] = useState<Tab>('overview');
  // URL is the source of truth for the active tab (same pattern as admin tabs).
  useLayoutEffect(() => {
    setTab(TABS.includes(tabParam as Tab) ? (tabParam as Tab) : 'overview');
  }, [tabParam]);
  const changeTab = (next: Tab) => {
    setTab(next);
    router.replace(`/teacher/groups/${groupId}?tab=${next}`, { scroll: false });
  };

  const [data, setData] = useState<RosterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [actionError, setActionError] = useState(false);
  // §03: the oldest request opens expanded, the rest collapse behind a
  // three-dot. `null` means "not chosen yet" so the default can be derived
  // from data once it lands; `''` means the teacher collapsed all of them.
  const [expandedPendingId, setExpandedPendingId] = useState<string | null>(null);
  const [sheetEnrollmentId, setSheetEnrollmentId] = useState<string | null>(null);
  // Plan gates the per-student private-note feature. Fetched once; defaults to
  // Standard until it loads.
  const [isPro, setIsPro] = useState(false);
  useEffect(() => {
    let on = true;
    fetchTeacherSubscription().then((s) => {
      if (on && s) setIsPro(isProOrAbove(s.plan_key));
    });
    return () => {
      on = false;
    };
  }, []);

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

  const decide = async (enrollmentId: string, action: 'approve' | 'reject' | 'remove') => {
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
      if (!res.ok && res.status !== 409) {
        setActionError(true);
      }
      await loadRoster();
    } catch {
      setActionError(true);
    } finally {
      setDecidingId(null);
      setConfirmRemoveId(null);
    }
  };

  const restoreGroup = async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(`/api/teacher/private/groups/${groupId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          ...(await getCsrfHeaders(session.access_token)),
        },
        body: JSON.stringify({ status: 'active' }),
      });
      if (res.ok) {
        loadRoster();
      } else {
        toast.error(tGroups('restoreError'));
      }
    } catch {
      toast.error(tGroups('restoreError'));
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
  const archived = data.group.status === 'archived';
  // Oldest pending request's createdAt, for the Overview "waiting to join" banner.
  const oldestPendingCreatedAt = pending.reduce<string | null>(
    (oldest, r) => (oldest === null || new Date(r.createdAt) < new Date(oldest) ? r.createdAt : oldest),
    null,
  );

  const payerLabel = (payer: string | null) =>
    payer === 'parent' ? t('payerParent') : payer === 'student' ? t('payerStudent') : null;

  const sourceLabel = (source: string | null) => {
    const key =
      source === 'self_link'
        ? 'sourceSelfLink'
        : source === 'walk_in'
          ? 'sourceWalkIn'
          : source === 'inherited'
            ? 'sourceInherited'
            : source === 'import'
              ? 'sourceImport'
              : null;
    return key ? t(key) : null;
  };

  // §03 draws the oldest request already open and the rest collapsed behind a
  // three-dot. `pending` is newest-first, so the oldest is the last row.
  const oldestPendingId = pending.length > 0 ? pending[pending.length - 1].enrollmentId : null;
  const openPendingId = expandedPendingId === null ? oldestPendingId : expandedPendingId;
  const sheetEntry =
    sheetEnrollmentId === null
      ? null
      : (data.roster.find((r) => r.enrollmentId === sheetEnrollmentId) ?? null);

  const call = (digits: string) => {
    window.location.href = `tel:+${digits}`;
  };
  const whatsapp = (digits: string) => {
    window.open(`https://wa.me/${digits}`, '_blank', 'noopener,noreferrer');
  };

  /**
   * The contact half of the row sheet. §03's request-detail screen offers the
   * student and the parent separately, each with Call and WhatsApp - only the
   * numbers that actually exist get an entry, never a dead button.
   */
  const contactActions = (r: RosterEntry): SheetAction[] => {
    const out: SheetAction[] = [];
    const studentDigits = intlDigits(r.student.phone);
    const parentDigits = intlDigits(r.student.parentPhone);
    if (studentDigits) {
      out.push({
        id: 'call-student',
        label: `${t('contactStudent')} · ${t('callAction')}`,
        icon: Phone,
        onSelect: () => call(studentDigits),
      });
      out.push({
        id: 'wa-student',
        label: `${t('contactStudent')} · ${t('messageAction')}`,
        icon: MessageCircle,
        onSelect: () => whatsapp(studentDigits),
      });
    }
    if (parentDigits) {
      out.push({
        id: 'call-parent',
        label: `${t('contactParent')} · ${t('callAction')}`,
        icon: Phone,
        onSelect: () => call(parentDigits),
      });
      out.push({
        id: 'wa-parent',
        label: `${t('contactParent')} · ${t('messageAction')}`,
        icon: MessageCircle,
        onSelect: () => whatsapp(parentDigits),
      });
    }
    return out;
  };

  const rowSheetActions = (r: RosterEntry): SheetAction[] => {
    const actions: SheetAction[] = [
      {
        id: 'open',
        label: t('openStudent'),
        icon: UserRound,
        onSelect: () => router.push(`/teacher/students/${r.student.id}`),
      },
      ...contactActions(r),
    ];
    if (r.status === 'pending') {
      actions.push({
        id: 'reject',
        label: t('reject'),
        icon: X,
        destructive: true,
        onSelect: () => decide(r.enrollmentId, 'reject'),
      });
    } else {
      // The remove itself stays behind the existing inline confirm - the sheet
      // only arms it. A one-tap destructive action inside a sheet is exactly
      // the mis-tap this list should not have.
      actions.push({
        id: 'remove',
        label: tTabs('removeStudent'),
        icon: UserMinus,
        destructive: true,
        onSelect: () => setConfirmRemoveId(r.enrollmentId),
      });
    }
    return actions;
  };

  /**
   * §03's expanded request card: Approve, Decline, then the More chip that
   * ExpandableRow renders itself. Two inline actions, not three - the third
   * slot in the design IS the More chip.
   */
  const pendingInlineActions = (r: RosterEntry): InlineAction[] => [
    {
      id: 'approve',
      label: t('approve'),
      icon: Check,
      onSelect: () => decide(r.enrollmentId, 'approve'),
      disabled: decidingId !== null,
    },
    {
      id: 'reject',
      label: t('reject'),
      icon: X,
      onSelect: () => decide(r.enrollmentId, 'reject'),
      disabled: decidingId !== null,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/teacher/groups"
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
        >
          <BackIcon size={16} aria-hidden />
          {t('back')}
        </Link>
        <div className="flex items-center gap-3">
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--color-mint)] text-sm font-semibold text-[var(--color-accent-deep)]"
            aria-hidden
          >
            {initialsOf(data.group.name)}
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold text-[var(--color-text-primary)]">
              {data.group.name}
            </h1>
            <p className="text-sm text-[var(--color-text-secondary)]">
              {tGroups('privateGroupSubtitle')}
            </p>
            {/* §03 topbar `.ts`: "18 students · 150 EGP per session", 11px. */}
            <p className="mt-1 text-xs text-[var(--color-muted)]">
              {tGroups('headerSummary', {
                count: formatNumber(active.length, locale, { integerOnly: true }),
                fee: formatCurrency(data.group.fee_per_class, locale),
              })}
            </p>
          </div>
        </div>

        {/* §02 `.gstats` / `.gtile`: flex-1, #F2EEE5, radius 12, padding 12.
            `.gtl` 11px muted over `.gtv` 15px/700. */}
        <dl className="mt-3 flex gap-2">
          <div className="flex-1 rounded-md bg-[var(--color-tile)] p-3">
            <dt className="text-xs text-[var(--color-muted)]">{tGroups('statStudents')}</dt>
            <dd className="mt-1 text-md font-bold tabular-nums text-[var(--color-ink)]">
              {formatNumber(active.length, locale, { integerOnly: true })}
            </dd>
          </div>
          <div className="flex-1 rounded-md bg-[var(--color-tile)] p-3">
            <dt className="text-xs text-[var(--color-muted)]">{tGroups('statPerClass')}</dt>
            <dd className="mt-1 text-md font-bold tabular-nums text-[var(--color-ink)]">
              {formatCurrency(data.group.fee_per_class, locale)}
            </dd>
          </div>
        </dl>

        {/* §02 `.gacts` / `.btn`: two flex-1 buttons, height 46, radius 12,
            13px/600 - `.primary` solid teal, `.ghost` panel on a hairline. */}
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            title={tCaps('studentTooltip')}
            className="flex min-h-[46px] flex-1 items-center justify-center gap-1 rounded-md bg-teal-600 px-4 text-base font-semibold text-primary-foreground transition-colors hover:bg-teal-700 btn-press chq-focus"
          >
            <Plus size={17} aria-hidden />
            {t('addStudent')}
          </button>
          <button
            type="button"
            onClick={() => setShowEdit(true)}
            className="flex min-h-[46px] flex-1 items-center justify-center gap-1 rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] px-4 text-base font-semibold text-[var(--color-accent-deep)] transition-colors hover:bg-[var(--color-tile)] btn-press chq-focus"
          >
            <Settings2 size={16} aria-hidden />
            {tPortal('editGroup.title')}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-[var(--color-border)]">
        {TABS.map((tk) => (
          <button
            key={tk}
            type="button"
            onClick={() => changeTab(tk)}
            className={[
              'whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition-colors',
              tab === tk
                ? 'border-[var(--color-teal)] text-[var(--color-teal-deep)]'
                : 'border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
            ].join(' ')}
          >
            {tTabs(
              tk === 'overview'
                ? 'tabOverview'
                : tk === 'students'
                  ? 'tabStudents'
                  : tk === 'classes'
                    ? 'tabClasses'
                    : 'tabSchedule',
            )}
          </button>
        ))}
      </div>

      {actionError && (
        <p className="rounded-lg border border-[var(--color-danger-muted)] bg-[var(--color-danger-muted)] p-3 text-sm text-[var(--color-danger)]">
          {t('actionError')}
        </p>
      )}

      {/* OVERVIEW */}
      {tab === 'overview' && (
        <div className="flex flex-col gap-4">
          {pending.length > 0 && (
            <div className="flex items-center gap-3 rounded-xl border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[var(--color-warning)]">
                  {tTabs('pendingBanner', {
                    count: formatNumber(pending.length, locale, { integerOnly: true }),
                  })}
                </p>
                {oldestPendingCreatedAt && (
                  <p className="mt-0.5 text-xs text-[var(--color-warning)]/85">
                    {tTabs('pendingBannerOldest', {
                      ago: formatRelativeMinutesAgo(oldestPendingCreatedAt, locale),
                    })}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => changeTab('students')}
                className="shrink-0 rounded-lg bg-[var(--color-warning)] px-3 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90"
              >
                {tTabs('reviewCta')}
              </button>
            </div>
          )}

          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4">
            <dl className="flex flex-col gap-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-[var(--color-text-secondary)]">{tTabs('statusLabel')}</dt>
                <dd className="flex items-center gap-2">
                  <span
                    className={
                      archived
                        ? 'rounded-full bg-[var(--color-surface-2)] px-3 py-0.5 text-xs font-medium text-[var(--color-text-secondary)]'
                        : 'rounded-full bg-[var(--color-teal-soft)] px-3 py-0.5 text-xs font-medium text-[var(--color-teal-deep)]'
                    }
                  >
                    {archived ? tTabs('statusArchived') : tTabs('statusActive')}
                  </span>
                  {archived && (
                    <button
                      type="button"
                      onClick={restoreGroup}
                      className="rounded-lg border border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-2)]"
                    >
                      {tTabs('restore')}
                    </button>
                  )}
                </dd>
              </div>
            </dl>
          </div>

          {/* §02 "Recent classes" - the three latest, then out to the tab. */}
          <GroupRecentClasses groupId={groupId} onSeeAll={() => changeTab('classes')} />

          <GroupJoinLinkCard groupId={groupId} groupName={data.group.name} />
        </div>
      )}

      {/* STUDENTS */}
      {tab === 'students' && (
        <div className="flex flex-col gap-6">
          {/* §03 "this group's queue": the explanatory note, then the requests
              themselves on the shared expand-in-place row.

              NOT BUILT, and why (verified live against project
              lczmjpnbuhnsislcvzar on 4 Aug 2026, not inferred):
                · §03's request-detail "School" - `students` has 39 columns and
                  none of school / school_name / school_id. Needs a new column
                  (D18); a migration is Eyad's call, so the field is absent
                  rather than faked.
                · §03's "Note from them" - `enrollments` has exactly 9 columns
                  (id, group_id, student_id, status, payer, source,
                  approved_by, joined_at, created_at). No note column. Same
                  blocker, same reason.
                · The review gate itself - D18: both create paths call
                  apply_enrollment_transition(..., 'active', ...) right after
                  create_enrollment, so a request rarely stays pending at all.
                  This queue is drawn honestly for the rows that do.
              Everything else §03 draws off columns that exist is built. */}
          {pending.length > 0 && (
            <section>
              {/* §03 `.sec` 15px/700, then `.note`: mint fill, radius 12,
                  11px on accent - the queue's own explanation, not a warning. */}
              <h2 className="mb-2 text-md font-bold text-[var(--color-ink)]">
                {t('pendingTitle')}
              </h2>
              <p className="mb-2 rounded-md bg-[var(--color-mint)] p-3 text-xs leading-relaxed text-[var(--color-accent)]">
                {t('queueNote', { group: data.group.name ?? '' })}
              </p>
              <ul className="flex flex-col gap-2">
                {pending.map((r) => (
                  <li key={r.enrollmentId}>
                    <ExpandableRow
                      avatar={initialsOf(r.student.name)}
                      title={r.student.name ?? ''}
                      meta={
                        <>
                          <span className="block truncate" dir="ltr">
                            {r.student.phone}
                          </span>
                          <span className="mt-1 block truncate">
                            {[
                              r.student.gradeLevel
                                ? t('gradeLabel', { grade: r.student.gradeLevel })
                                : null,
                              t('asked', { ago: formatRelativeMinutesAgo(r.createdAt, locale) }),
                              sourceLabel(r.source),
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </>
                      }
                      badge={
                        decidingId === r.enrollmentId ? (
                          <Loader2
                            className="h-4 w-4 shrink-0 animate-spin text-[var(--color-text-muted)]"
                            aria-hidden
                          />
                        ) : undefined
                      }
                      expanded={openPendingId === r.enrollmentId}
                      onToggle={() =>
                        setExpandedPendingId((v) =>
                          (v === null ? oldestPendingId : v) === r.enrollmentId
                            ? ''
                            : r.enrollmentId,
                        )
                      }
                      inlineActions={pendingInlineActions(r)}
                      onMore={() => setSheetEnrollmentId(r.enrollmentId)}
                      moreLabel={t('more')}
                    />
                  </li>
                ))}
              </ul>
              {/* §03's closing note: a per-group link only ever fills its own
                  group, so the other groups' queues are elsewhere. */}
              <p className="mt-2 rounded-md bg-[var(--color-mint)] p-3 text-xs leading-relaxed text-[var(--color-accent)]">
                {t('queueOtherGroupsNote')}
              </p>
            </section>
          )}

          <section>
            {/* §03 `.sec` 15px/700 with its count, over `.sub` 12px muted. */}
            <h2 className="flex items-center gap-2 text-md font-bold text-[var(--color-ink)]">
              <UserRound size={15} aria-hidden />
              {t('enrolledHeading', {
                count: formatNumber(active.length, locale, { integerOnly: true }),
              })}
            </h2>
            <p className="mb-2 mt-1 text-sm leading-relaxed text-[var(--color-muted)]">
              {t('enrolledSub')}
            </p>

            {active.length === 0 ? (
              <p className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface-1)] p-6 text-sm text-[var(--color-text-secondary)]">
                {tTabs('noStudents')}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {active.map((r) => (
                  <li key={r.enrollmentId} className="flex flex-col gap-2">
                    <ListRow
                      avatar={initialsOf(r.student.name)}
                      title={r.student.name ?? ''}
                      meta={
                        <>
                          <span className="block truncate" dir="ltr">
                            {r.student.phone}
                          </span>
                          <span className="mt-1 block truncate">
                            {[
                              // §03's enrolled row carries a joined date.
                              // `enrollments.joined_at` is nullable, so a row
                              // without one says nothing rather than guessing.
                              r.joinedAt
                                ? t('joinedOn', { date: formatDate(r.joinedAt, locale, 'short') })
                                : null,
                              payerLabel(r.payer),
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </>
                      }
                      badge={
                        r.outstanding > 0 ? (
                          <span className="shrink-0 text-xs font-medium text-[var(--color-brass)]">
                            {tTabs('outstandingShort', {
                              amount: formatCurrency(r.outstanding, locale),
                            })}
                          </span>
                        ) : undefined
                      }
                      onOpen={() => router.push(`/teacher/students/${r.student.id}`)}
                      onActions={() => setSheetEnrollmentId(r.enrollmentId)}
                      actionsLabel={t('rowActions', { name: r.student.name ?? '' })}
                    />

                    {confirmRemoveId === r.enrollmentId && (
                      <div className="flex items-center justify-end gap-2">
                        {decidingId === r.enrollmentId ? (
                          <Loader2
                            className="h-4 w-4 animate-spin text-[var(--color-text-muted)]"
                            aria-hidden
                          />
                        ) : (
                          <>
                            <button
                              onClick={() => decide(r.enrollmentId, 'remove')}
                              className="rounded-lg bg-[var(--color-danger)] px-3 py-1 text-xs font-medium text-white transition-opacity hover:opacity-90"
                            >
                              {tTabs('confirmRemove')}
                            </button>
                            <button
                              onClick={() => setConfirmRemoveId(null)}
                              className="rounded-lg border border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-2)]"
                            >
                              {tTabs('cancel')}
                            </button>
                          </>
                        )}
                      </div>
                    )}

                    <StudentNoteRow groupId={groupId} studentId={r.student.id} isPro={isPro} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {/* CLASSES */}
      {tab === 'classes' && <GroupClassesTab groupId={groupId} />}

      {/* SCHEDULE */}
      {tab === 'schedule' && <GroupScheduleTab groupId={groupId} />}

      {/* §03/§04's one row sheet, shared: the row decides the actions, the
          sheet only presents them. Same instance for pending and enrolled. */}
      <ActionSheet
        open={sheetEntry !== null}
        onClose={() => setSheetEnrollmentId(null)}
        title={sheetEntry?.student.name ?? ''}
        subtitle={sheetEntry?.student.phone ?? undefined}
        actions={sheetEntry ? rowSheetActions(sheetEntry) : []}
      />

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
