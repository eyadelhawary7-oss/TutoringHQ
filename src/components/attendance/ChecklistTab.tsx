'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
import { DirectionalIcon } from '@/components/icons/DirectionalIcon';
import { ListChecks, BookOpen, Search, X, Check, Banknote, Smartphone, Gift, ChevronLeft, ChevronRight, Users } from 'lucide-react';
import { ListSkeleton } from '@/components/patterns';
import { EmptyState } from '@/components/shared';

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
  fee?: number;
  groups?: { id: string; name: string; fee_per_class: number; subject?: string | null }[];
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
          {/* Roster header */}
          <div className="mb-3 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => { setSelectedGroup(null); setPending(new Set()); setOpenFor(null); }}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-teal-600 hover:text-teal-700"
            >
              <DirectionalIcon icon={ChevronLeft} className="h-4 w-4" />
              {t('backToGroups')}
            </button>
            <div className="text-end">
              <div className="font-semibold text-[var(--color-text-primary)]">{selectedGroup.name}</div>
              <div className="text-xs text-[var(--color-text-secondary)] font-mono">{formatCurrency(selectedGroup.fee_per_class, locale)}</div>
            </div>
          </div>

          {/* Live "needs method" counter + present tally */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-100 px-3 py-1 text-xs font-semibold text-teal-700">
              <Check className="h-3.5 w-3.5" /> {t('presentTally', { count: formatNumber(presentCount, locale), total: formatNumber(roster.length, locale) })}
            </span>
            {needsMethod > 0 && (
              <span className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700" role="status">
                {t('needsMethod', { count: formatNumber(needsMethod, locale) })}
              </span>
            )}
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
                    className={`rounded-xl border bg-[var(--color-surface-1)] ${
                      resolved
                        ? 'border-teal-500/40'
                        : isPending
                          ? 'border-amber-500/50'
                          : 'border-[var(--color-border-subtle)]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => (resolved ? undefined : handleTap(s.id))}
                      disabled={!!resolved || isBusy}
                      className="flex w-full items-center justify-between gap-3 p-4 text-start disabled:cursor-default"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-[var(--color-text-primary)]">{s.name}</span>
                        {s.student_number ? (
                          <span className="block truncate text-xs text-[var(--color-text-tertiary)]" dir="ltr">
                            {formatStudentNumberForDisplay(s.student_number)}
                          </span>
                        ) : null}
                      </span>
                      {resolved ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-teal-100 px-2.5 py-1 text-xs font-semibold text-teal-700">
                          <Check className="h-3.5 w-3.5" />
                          {resolved === 'recorded' ? t('present') : methodLabel(resolved)}
                        </span>
                      ) : isPending ? (
                        <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">
                          {t('chooseMethod')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full border border-[var(--color-border-subtle)] px-2.5 py-1 text-xs font-medium text-[var(--color-text-secondary)]">
                          {t('tapToMark')}
                        </span>
                      )}
                    </button>

                    {/* Inline payment-method menu — opens directly under the tapped name. */}
                    {isOpen && !resolved && (
                      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-border-subtle)] p-3">
                        {METHOD_OPTIONS.map((opt, i) => (
                          <button
                            key={opt.key}
                            ref={i === 0 ? firstMethodRef : undefined}
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleSelectMethod(s, opt.key)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:opacity-50"
                          >
                            <opt.Icon className="h-4 w-4" />
                            {methodLabel(opt.key)}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => dismissPending(s.id)}
                          aria-label={tCommon('cancel')}
                          className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-border-subtle)] px-3 py-2 text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
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
    </div>
  );
}
