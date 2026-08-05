'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { dbSelect } from '@/lib/db-proxy';
import {
  queueScan,
  getUnsyncedCount,
  markPaidTodayOffline,
  getDB,
  getAllStudentsOffline,
  syncStudentsToLocal,
  getTodayHistoryRecord,
  appendTodayHistoryRow,
  pruneStaleTodayHistory,
} from '@/lib/db';
import { syncQueuedScans } from '@/lib/sync';
import { useNetworkStatus } from '@/lib/scanner/networkStatus';
import {
  commitChecklistAttendance,
  countNeedsMethod,
  type ChecklistMethod,
  type ChecklistCommitDeps,
} from '@/lib/checklist';
import { useUser } from '@/contexts/UserContext';
import { useToast } from '@/hooks/useToast';
import { formatNumber, formatCurrency } from '@/lib/formatNumber';
import { formatStudentNumberForDisplay } from '@/lib/studentNumberDisplay';
import { cairoDateKey } from '@/lib/cairo/day';
import { normalizePhone } from '@/lib/utils/phone';
import { DirectionalIcon } from '@/components/icons/DirectionalIcon';
import { ActionSheet, ListSkeleton, type SheetAction } from '@/components/patterns';
import { EmptyState } from '@/components/shared';
import {
  ListChecks,
  BookOpen,
  Search,
  X,
  Check,
  Banknote,
  Smartphone,
  Gift,
  ChevronLeft,
  ChevronRight,
  UserRound,
  MessageCircle,
  Users,
} from 'lucide-react';

interface ChecklistGroup {
  id: string;
  name: string;
  fee_per_class: number;
  subject: string | null;
}

interface RosterStudent {
  id: string;
  name: string;
  student_number?: string | null;
  /** Already selected by `loadStudents` — the design's "Message parent" action needs it. */
  parent_phone?: string | null;
  fee?: number;
  groups?: { id: string; name: string; fee_per_class: number; subject?: string | null }[];
}

/**
 * wa.me wants bare international digits. `normalizePhone` is THE single Egyptian
 * normalizer (`src/lib/utils/phone.ts`) and returns E.164 (`+20…`), so the link
 * is that minus the plus — deliberately NOT a fifth hand-rolled `intlDigits`.
 */
function waDigitsFor(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const e164 = normalizePhone(raw);
  if (!e164) return null;
  const digits = e164.replace(/\D/g, '');
  return digits.length > 0 ? digits : null;
}

/** Fire-and-forget parent notify after the server accepts the attendance row (mirrors scan/page.tsx). */
function notifyParentScan(
  studentId: string,
  result: 'attended' | 'absent' | 'pending_payment',
  scannedAt: string,
) {
  supabase.auth.getSession().then(({ data: { session } }) => {
    if (!session) return;
    fetch('/api/parents/notify-scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ student_id: studentId, result, scanned_at: scannedAt }),
    }).catch(() => {});
  });
}

const METHOD_OPTIONS: { key: ChecklistMethod; Icon: typeof Banknote }[] = [
  { key: 'cash', Icon: Banknote },
  { key: 'instapay', Icon: Smartphone },
  { key: 'exempt', Icon: Gift },
];

/** Static method→label map (keeps t() keys literal for the i18n parity checker). */
function useMethodLabel() {
  const t = useTranslations('checklist');
  return (m: ChecklistMethod) =>
    m === 'cash' ? t('method_cash') : m === 'instapay' ? t('method_instapay') : t('method_exempt');
}

export default function ChecklistTab({ initialGroupId }: { initialGroupId?: string | null }) {
  const t = useTranslations('checklist');
  const tCommon = useTranslations('common');
  const tToast = useTranslations('toasts');
  const locale = useLocale();
  const router = useRouter();
  const isRTL = locale === 'ar';
  const { user } = useUser();
  const toast = useToast();
  const methodLabel = useMethodLabel();
  const { online: netOnline, probeOk } = useNetworkStatus();

  const [mounted, setMounted] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [centerId, setCenterId] = useState<string | null>(null);
  const [subActive, setSubActive] = useState(true);

  const [groups, setGroups] = useState<ChecklistGroup[]>([]);
  const [allStudents, setAllStudents] = useState<RosterStudent[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<ChecklistGroup | null>(null);
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [search, setSearch] = useState('');

  // In-memory only: tapped-present students still awaiting a method.
  const [pending, setPending] = useState<Set<string>>(new Set());
  // Resolved students this session (method) plus history-recorded ('recorded').
  const [done, setDone] = useState<Record<string, ChecklistMethod | 'recorded'>>({});
  const [openFor, setOpenFor] = useState<string | null>(null);
  /** §01's third tap target: the NAME opens details, separately from the box. */
  const [detailFor, setDetailFor] = useState<RosterStudent | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const firstMethodRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => { void getDB(); void pruneStaleTodayHistory(); }, []);

  // Load user + center.
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      setUserId(session.user.id);
      const meRes = await fetch('/api/me', { headers: { Authorization: `Bearer ${session.access_token}` } });
      const meData = await meRes.json();
      if (meData?.user?.center_id) setCenterId(meData.user.center_id);
      const sub = meData?.user?.center?.subscription_status;
      if (typeof sub === 'string') setSubActive(sub === 'active');
    })();
  }, []);

  // Load checklist-mode groups for this center.
  const loadGroups = useCallback(async () => {
    if (!centerId) return;
    setLoadingGroups(true);
    try {
      // No mode gate: the checklist is always available for every group.
      const { data } = await dbSelect({
        table: 'student_groups',
        select: 'id, name, fee_per_class, subject',
        filters: [{ column: 'center_id', op: 'eq', value: centerId }],
        order: { column: 'name' },
      });
      const rows = (data || []) as ChecklistGroup[];
      setGroups(rows.map((g) => ({ id: g.id, name: g.name, fee_per_class: g.fee_per_class ?? 0, subject: g.subject ?? null })));
    } catch {
      setGroups([]);
    } finally {
      setLoadingGroups(false);
    }
  }, [centerId]);

  // Load + cache all center students with their groups (offline-safe, mirrors scan/page.tsx).
  const loadStudents = useCallback(async () => {
    if (!centerId) return;
    try {
      const { data: studentsRaw } = await dbSelect({
        table: 'students',
        select: 'id, name, parent_phone, subject, fee, student_number',
        filters: [{ column: 'center_id', op: 'eq', value: centerId }],
      });
      const list = (studentsRaw || []) as RosterStudent[];
      if (list.length > 0) {
        const { data: membersData } = await dbSelect({
          table: 'student_group_members',
          select: 'student_id, group_id',
          filters: [{ column: 'student_id', op: 'in', value: list.map((s) => s.id) }],
        });
        const members = (membersData || []) as { student_id: string; group_id: string }[];
        const groupIds = [...new Set(members.map((m) => m.group_id))];
        let groupsMap: Record<string, { id: string; name: string; fee_per_class: number; subject?: string | null }> = {};
        if (groupIds.length > 0) {
          const { data: groupsData } = await dbSelect({
            table: 'student_groups',
            select: 'id, name, fee_per_class, subject',
            filters: [{ column: 'id', op: 'in', value: groupIds }],
          });
          groupsMap = Object.fromEntries(
            ((groupsData || []) as { id: string; name?: string; fee_per_class?: number; subject?: string | null }[]).map((g) => [
              g.id,
              { id: g.id, name: g.name ?? '', fee_per_class: g.fee_per_class ?? 0, subject: g.subject ?? null },
            ]),
          );
        }
        const withGroups = list.map((s) => ({
          ...s,
          groups: members.filter((m) => m.student_id === s.id).map((m) => groupsMap[m.group_id]).filter(Boolean),
        })) as RosterStudent[];
        await syncStudentsToLocal(
          withGroups as unknown as (Record<string, unknown> & { id: string; student_number?: string | null })[],
        );
        setAllStudents(withGroups);
      } else {
        setAllStudents([]);
      }
    } catch {
      try {
        const cached = await getAllStudentsOffline();
        setAllStudents((cached ?? []) as RosterStudent[]);
      } catch {
        setAllStudents([]);
      }
    }
  }, [centerId]);

  useEffect(() => {
    if (!centerId) return;
    loadGroups();
    loadStudents();
    window.addEventListener('online', loadStudents);
    return () => window.removeEventListener('online', loadStudents);
  }, [centerId, loadGroups, loadStudents]);

  // Drain the queue periodically while online + keep the pending badge fresh.
  useEffect(() => {
    const run = async () => {
      try {
        if (netOnline) await syncQueuedScans();
        setPendingCount(await getUnsyncedCount());
      } catch {
        //
      }
    };
    void run();
    const id = setInterval(() => void run(), 30000);
    return () => clearInterval(id);
  }, [netOnline]);

  const roster = useMemo(() => {
    if (!selectedGroup) return [];
    let list = allStudents.filter((s) => (s.groups ?? []).some((g) => g.id === selectedGroup.id));
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (s) => (s.name || '').toLowerCase().includes(q) || (s.student_number || '').toLowerCase().includes(q),
      );
    }
    return [...list].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [allStudents, selectedGroup, search]);

  // When a group opens, pre-mark students already admitted today (dedup, mirrors scanner).
  const openGroup = useCallback(async (group: ChecklistGroup) => {
    setSelectedGroup(group);
    setSearch('');
    setPending(new Set());
    setOpenFor(null);
    setRosterLoading(true);
    try {
      const rec = await getTodayHistoryRecord(cairoDateKey());
      const admitted: Record<string, 'recorded'> = {};
      for (const s of rec?.scans ?? []) {
        if (s.status === 'admitted' && s.studentId) admitted[s.studentId] = 'recorded';
      }
      setDone(admitted);
    } catch {
      setDone({});
    } finally {
      setRosterLoading(false);
    }
  }, []);

  // Schedule deep-link: when launched scoped to a class, auto-open that group's
  // roster once the groups list has loaded (one-shot).
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (autoOpenedRef.current || !initialGroupId || groups.length === 0) return;
    const g = groups.find((x) => x.id === initialGroupId);
    if (!g) return;
    autoOpenedRef.current = true;
    void openGroup(g);
  }, [initialGroupId, groups, openGroup]);

  const handleTap = (studentId: string) => {
    if (done[studentId]) return; // already present today
    setPending((prev) => {
      const next = new Set(prev);
      next.add(studentId);
      return next;
    });
    setOpenFor((prev) => (prev === studentId ? prev : studentId));
    // Auto-focus the first method as soon as the inline menu opens.
    setTimeout(() => firstMethodRef.current?.focus(), 0);
  };

  const dismissPending = (studentId: string) => {
    setPending((prev) => {
      const next = new Set(prev);
      next.delete(studentId);
      return next;
    });
    setOpenFor((prev) => (prev === studentId ? null : prev));
  };

  const handleSelectMethod = async (student: RosterStudent, method: ChecklistMethod) => {
    if (!centerId || !userId || !selectedGroup) return;
    if (done[student.id]) return;
    if (!subActive) {
      toast.error(tToast('error'), t('subscriptionInactive'));
      return;
    }
    setBusyId(student.id);
    try {
      // Paid-today dedup: if already admitted today, don't double-write (mirrors scanner).
      const rec = await getTodayHistoryRecord(cairoDateKey());
      if (rec?.scans.some((s) => s.studentId === student.id && s.status === 'admitted')) {
        setDone((prev) => ({ ...prev, [student.id]: 'recorded' }));
        dismissPending(student.id);
        toast.success(t('alreadyPresent', { name: student.name }));
        return;
      }

      const scannedAt = new Date().toISOString();
      const fee = selectedGroup.fee_per_class ?? student.fee ?? 0;
      const deps: ChecklistCommitDeps = {
        queueScan,
        markPaidTodayOffline,
        getUnsyncedCount,
        syncQueuedScans,
        notifyParentScan,
        netOnline,
      };
      const result = await commitChecklistAttendance(deps, {
        studentId: student.id,
        centerId,
        userId,
        scannedAt,
        method,
        fee,
        groupId: selectedGroup.id,
      });

      if (!result.queued) {
        toast.error(tToast('error'), t('saveFailed'));
        return;
      }

      await appendTodayHistoryRow(cairoDateKey(), {
        id: crypto.randomUUID(),
        rawInput: student.student_number ?? student.id,
        normalizedInput: student.id,
        status: 'admitted',
        studentName: student.name,
        studentId: student.id,
        timestamp: Date.now(),
      });

      setDone((prev) => ({ ...prev, [student.id]: method }));
      dismissPending(student.id);
      if (typeof result.pendingCount === 'number') setPendingCount(result.pendingCount);
      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(40);
      toast.success(t('markedPresent', { name: student.name }));
    } catch {
      toast.error(tToast('error'), t('saveFailed'));
    } finally {
      setBusyId(null);
    }
  };

  const needsMethod = useMemo(
    () => countNeedsMethod(pending, new Set(Object.keys(done))),
    [pending, done],
  );
  const presentCount = useMemo(
    () => roster.reduce((n, s) => (done[s.id] ? n + 1 : n), 0),
    [roster, done],
  );

  /**
   * §01's summary-card chip row, one chip per outcome. Purely a fold of state
   * this component already holds — no extra query, no extra column.
   *
   * The design's fourth chip is "covered" (a student on a monthly plan or a
   * bundle, already paid for this session, never charged twice). It is NOT
   * rendered: `student_groups` has no billing-basis column live — the table
   * carries `fee_per_class` and nothing else (no `billing_type`, no
   * `monthly_fee`, no `bundle_size`), so there is no fact that could mark a
   * student covered. See D12. A chip that always read "0 covered" would be a
   * fabricated reassurance, not a smaller card.
   */
  const outcomeCounts = useMemo(() => {
    let cash = 0;
    let instapay = 0;
    let exempt = 0;
    let recorded = 0;
    for (const s of roster) {
      const d = done[s.id];
      if (d === 'cash') cash += 1;
      else if (d === 'instapay') instapay += 1;
      else if (d === 'exempt') exempt += 1;
      else if (d === 'recorded') recorded += 1;
    }
    return {
      cash,
      instapay,
      exempt,
      recorded,
      notMarked: Math.max(0, roster.length - (cash + instapay + exempt + recorded)),
    };
  }, [roster, done]);

  /** The design's "This session" line, from the state the row already carries. */
  const sessionStateLabel = (studentId: string): string => {
    const d = done[studentId];
    if (!d) return pending.has(studentId) ? t('chooseMethod') : t('notMarked');
    return d === 'recorded' ? t('present') : `${t('present')} · ${methodLabel(d)}`;
  };

  const detailWaDigits = waDigitsFor(detailFor?.parent_phone);
  const detailActions: SheetAction[] = detailFor
    ? [
        {
          id: 'profile',
          label: t('fullProfile'),
          icon: UserRound,
          onSelect: () => router.push(`/${locale}/students/${detailFor.id}`),
        },
        {
          id: 'parent',
          label: t('messageParent'),
          icon: MessageCircle,
          disabled: !detailWaDigits,
          onSelect: () => {
            if (detailWaDigits) {
              window.open(`https://wa.me/${detailWaDigits}`, '_blank', 'noopener,noreferrer');
            }
          },
        },
      ]
    : [];

  if (!mounted) return null;

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'} className="min-h-screen w-full bg-[var(--color-surface-0)] animate-fade-in pb-24">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)] flex items-center gap-2">
            <ListChecks className="w-6 h-6 text-teal-600" /> {t('title')}
          </h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!probeOk && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700">
              <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" /> {t('offline')}
            </span>
          )}
          {pendingCount > 0 && (
            <span className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
              {t('pendingSync', { count: formatNumber(pendingCount, locale) })}
            </span>
          )}
        </div>
      </div>

      {/* Group picker */}
      {!selectedGroup ? (
        loadingGroups ? (
          /* §02 · the word "Loading" is not a loading state; group cards are
             arriving, so the skeleton stands in at their shape. */
          <ListSkeleton rows={3} />
        ) : groups.length === 0 ? (
          /* §01 quiet variant · groups are created on the Groups screen, not
             here, so this state offers no action of its own. */
          <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] py-4">
            <EmptyState icon={BookOpen} title={t('noGroups')} quiet />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => openGroup(g)}
                className="flex items-center justify-between rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-5 text-start shadow-sm transition-shadow hover:shadow-md"
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-[var(--color-text-primary)]">{g.name}</span>
                  <span className="block truncate text-sm text-[var(--color-text-secondary)]">
                    {g.subject || tCommon('notSet')} · {formatCurrency(g.fee_per_class, locale)}
                  </span>
                </span>
                <DirectionalIcon icon={ChevronRight} className="h-5 w-5 shrink-0 text-[var(--color-text-tertiary)]" />
              </button>
            ))}
          </div>
        )
      ) : (
        <>
          {/* Roster header — §01's topbar. The design's subtitle is
              "teacher · room"; neither is rendered. `student_groups.teacher_id`
              is an FK to `users(id)` whose readable scope through the proxy is
              `center_id`-bound (a teacher row is not guaranteed to carry the
              center's id), and `student_groups` has NO room column at all
              (`sessions.room` exists but the checklist never opens a session).
              Subject is what the group row actually carries, so subject is what
              the subtitle shows. */}
          <div className="mb-3 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => { setSelectedGroup(null); setPending(new Set()); setOpenFor(null); }}
              className="inline-flex min-h-[44px] items-center gap-1.5 text-base font-medium text-[var(--color-accent)] hover:text-[var(--color-accent-deep)]"
            >
              <DirectionalIcon icon={ChevronLeft} className="h-4 w-4" />
              {t('backToGroups')}
            </button>
            <div className="min-w-0 text-end">
              <div className="truncate text-lg font-bold text-[var(--color-ink)]">{selectedGroup.name}</div>
              {selectedGroup.subject ? (
                <div className="truncate text-xs text-[var(--color-muted)]">{selectedGroup.subject}</div>
              ) : null}
            </div>
          </div>

          {/* §01 summary card: the tally, the per-session price, and one chip
              per outcome. Everything here is a fold of state already on screen. */}
          <div className="mb-2 rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-md font-bold text-[var(--color-ink)]">
                {t('presentTally', {
                  count: formatNumber(presentCount, locale),
                  total: formatNumber(roster.length, locale),
                })}
              </span>
              <span className="shrink-0 text-xs text-[var(--color-muted)]">
                {t('feePerSession', { amount: formatCurrency(selectedGroup.fee_per_class, locale) })}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {outcomeCounts.cash > 0 && (
                <span className="rounded-pill bg-[var(--color-sand)] px-2 py-1 text-xs font-bold text-[var(--color-brass)]">
                  {t('chipCount', { count: formatNumber(outcomeCounts.cash, locale), label: t('method_cash') })}
                </span>
              )}
              {outcomeCounts.instapay > 0 && (
                <span className="rounded-pill bg-[var(--color-mint)] px-2 py-1 text-xs font-bold text-[var(--color-accent-deep)]">
                  {t('chipCount', { count: formatNumber(outcomeCounts.instapay, locale), label: t('method_instapay') })}
                </span>
              )}
              {outcomeCounts.exempt > 0 && (
                <span className="rounded-pill bg-[var(--color-mint)] px-2 py-1 text-xs font-bold text-[var(--color-accent)]">
                  {t('chipCount', { count: formatNumber(outcomeCounts.exempt, locale), label: t('method_exempt') })}
                </span>
              )}
              {outcomeCounts.recorded > 0 && (
                <span className="rounded-pill bg-[var(--color-mint)] px-2 py-1 text-xs font-bold text-[var(--color-accent-deep)]">
                  {t('chipCount', { count: formatNumber(outcomeCounts.recorded, locale), label: t('present') })}
                </span>
              )}
              {outcomeCounts.notMarked > 0 && (
                <span className="rounded-pill bg-[var(--color-tile)] px-2 py-1 text-xs font-bold text-[var(--color-muted)]">
                  {t('chipNotMarked', { count: formatNumber(outcomeCounts.notMarked, locale) })}
                </span>
              )}
              {needsMethod > 0 && (
                <span
                  className="rounded-pill bg-[var(--color-sand)] px-2 py-1 text-xs font-bold text-[var(--color-brass)]"
                  role="status"
                >
                  {t('needsMethod', { count: formatNumber(needsMethod, locale) })}
                </span>
              )}
            </div>
          </div>

          {/* §01 legend — the three tap targets, named. The design's second
              line is "tap the chip to switch digital or cash"; live has no
              digital collection (V1/V3), so the second line names what the
              live second step actually is: choosing how they paid. */}
          <div className="mb-2 rounded-md border border-dashed border-[var(--color-line)] bg-[var(--color-panel)] px-3 py-2">
            {(['legendBox', 'legendMethod', 'legendName'] as const).map((key) => (
              <p key={key} className="flex items-center gap-2 py-1 text-xs leading-snug text-[var(--color-mid)]">
                <span className="h-[5px] w-[5px] shrink-0 rounded-pill bg-[var(--color-accent)]" aria-hidden />
                <span>
                  {t.rich(key, {
                    b: (chunks) => <b className="font-bold text-[var(--color-ink)]">{chunks}</b>,
                  })}
                </span>
              </p>
            ))}
          </div>

          {/* Search */}
          <div className="relative mb-3">
            <Search className="absolute top-1/2 -translate-y-1/2 start-3 h-4 w-4 text-[var(--color-text-tertiary)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('searchStudents')}
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] ps-9 pe-3 py-2.5 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)]"
            />
          </div>

          {/* Roster */}
          {rosterLoading ? (
            /* §02 · the roster is a list; the skeleton shows its shape. */
            <ListSkeleton rows={5} />
          ) : roster.length === 0 ? (
            /* §01 quiet variant · this group's roster is managed on the group,
               not from the attendance checklist. */
            <EmptyState icon={Users} title={t('noStudents')} quiet />
          ) : (
            <ul className="space-y-2">
              {roster.map((s) => {
                const resolved = done[s.id];
                const isOpen = openFor === s.id;
                const isPending = pending.has(s.id);
                const isBusy = busyId === s.id;
                return (
                  <li
                    key={s.id}
                    className={`rounded-md border ${
                      resolved
                        ? 'border-[var(--color-mint-deep)] bg-[var(--color-panel)]'
                        : isPending
                          ? 'border-[var(--color-brass)]/50 bg-[var(--color-panel)]'
                          : 'border-[var(--color-line)] bg-[var(--color-tile)]'
                    }`}
                  >
                    {/* §01's row is THREE tap targets, not one: the box marks
                        present, the name opens details, the chip states the
                        outcome. The chip is a state, not a switch — the design's
                        digital/cash toggle is V3 (see the PR note). */}
                    <div className="flex items-center gap-2 p-2">
                      <button
                        type="button"
                        onClick={() => (resolved ? undefined : handleTap(s.id))}
                        disabled={!!resolved || isBusy}
                        aria-label={t('markPresentAria', { name: s.name })}
                        aria-pressed={!!resolved}
                        className="flex h-11 w-11 shrink-0 items-center justify-center disabled:cursor-default"
                      >
                        <span
                          className={`flex h-[30px] w-[30px] items-center justify-center rounded-sm ${
                            resolved
                              ? 'bg-[var(--color-accent)] text-[var(--color-panel)]'
                              : isPending
                                ? 'border-[1.5px] border-[var(--color-brass)] bg-[var(--color-panel)]'
                                : 'border-[1.5px] border-[var(--color-canvas)] bg-[var(--color-panel)]'
                          }`}
                        >
                          {resolved ? <Check className="h-4 w-4" strokeWidth={3} aria-hidden /> : null}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setDetailFor(s)}
                        className="min-w-0 flex-1 py-1 text-start"
                      >
                        <span
                          className={`flex items-center gap-1 truncate text-base font-semibold ${
                            resolved ? 'text-[var(--color-ink)]' : 'text-[var(--color-mid)]'
                          }`}
                        >
                          <span className="truncate">{s.name}</span>
                          <DirectionalIcon
                            icon={ChevronRight}
                            className="h-3.5 w-3.5 shrink-0 text-[var(--color-faint)]"
                          />
                        </span>
                        {/* §01's sub-line is the row's own state. The student
                            number stays in front of it — the front desk reads
                            it off the card — so nothing live is lost. */}
                        <span className="mt-1 block truncate text-xs text-[var(--color-muted)]">
                          {s.student_number ? (
                            <>
                              <span dir="ltr">{formatStudentNumberForDisplay(s.student_number)}</span>
                              {' · '}
                            </>
                          ) : null}
                          {sessionStateLabel(s.id)}
                        </span>
                      </button>

                      {resolved ? (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-pill bg-[var(--color-mint)] px-3 py-2 text-xs font-bold text-[var(--color-accent-deep)]">
                          {resolved === 'recorded' ? t('present') : methodLabel(resolved)}
                        </span>
                      ) : isPending ? (
                        <span className="inline-flex shrink-0 items-center rounded-pill bg-[var(--color-sand)] px-3 py-2 text-xs font-bold text-[var(--color-brass)]">
                          {t('chooseMethod')}
                        </span>
                      ) : (
                        <span className="inline-flex shrink-0 items-center rounded-pill bg-[var(--color-tile)] px-3 py-2 text-xs font-bold text-[var(--color-muted)]">
                          {t('notMarked')}
                        </span>
                      )}
                    </div>

                    {/* Inline payment-method menu — opens directly under the tapped name. */}
                    {isOpen && !resolved && (
                      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-hairline)] p-3">
                        {METHOD_OPTIONS.map((opt, i) => (
                          <button
                            key={opt.key}
                            ref={i === 0 ? firstMethodRef : undefined}
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleSelectMethod(s, opt.key)}
                            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-sm bg-[var(--color-accent)] px-3 py-2 text-base font-semibold text-[var(--color-panel)] transition-colors hover:bg-[var(--color-accent-deep)] disabled:opacity-50"
                          >
                            <opt.Icon className="h-4 w-4" />
                            {methodLabel(opt.key)}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => dismissPending(s.id)}
                          aria-label={tCommon('cancel')}
                          className="inline-flex min-h-[44px] items-center gap-1 rounded-sm border border-[var(--color-line)] px-3 py-2 text-base font-medium text-[var(--color-mid)] hover:text-[var(--color-ink)]"
                        >
                          <X className="h-4 w-4" /> {tCommon('cancel')}
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {/* §01's name-tap detail, on the SHARED sheet primitive
          (`Merged-Design-Patterns` §04) rather than a local one.
          NOT rendered here, and deliberately: the design's sheet leads with a
          four-fact card (This session / Outstanding / Attendance / Last paid).
          `ActionSheet` takes title, subtitle and actions — it has no body slot,
          and widening it is a change to a primitive with eight adopters, so per
          the shared-primitive rule this stops rather than forks. "This session"
          is carried in the subtitle, which the primitive does have. */}
      <ActionSheet
        open={!!detailFor}
        onClose={() => setDetailFor(null)}
        title={detailFor?.name ?? ''}
        subtitle={
          detailFor && selectedGroup
            ? `${selectedGroup.name} · ${sessionStateLabel(detailFor.id)}`
            : undefined
        }
        actions={detailActions}
      />
    </div>
  );
}
