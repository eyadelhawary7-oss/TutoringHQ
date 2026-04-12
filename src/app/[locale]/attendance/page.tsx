'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { dbSelect } from '@/lib/db-proxy';
import { useRouter } from 'next/navigation';
import { Download, Search, ClipboardList, BookOpen, X } from 'lucide-react';
import { AttendanceHeatmap } from '@/components/AttendanceHeatmap';
import EmptyState from '@/components/empty-states/EmptyState';
import { LocalizedDateInput } from '@/components/forms/LocalizedDateInput';
import { formatDate, formatDateTime } from '@/lib/formatNumber';

interface ScanRecord {
  id: string;
  student_id: string;
  center_id: string;
  scanned_at: string;
  group_id?: string | null;
  payment_status_at_scan?: string | null;
  payment_method?: string | null;
  payment_recorded?: boolean;
  session_date?: string | null;
}

interface Student {
  id: string;
  name: string;
  phone?: string | null;
  student_number?: string | null;
}

interface Group {
  id: string;
  name: string;
  subject: string | null;
}

function getLast7Days() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 6);
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  };
}

function formatRelativeTime(dateStr: string, locale: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  const diffHours = Math.floor(diffMs / (60 * 60 * 1000));
  const diffMins = Math.floor(diffMs / (60 * 1000));

  if (locale === 'ar') {
    if (diffMins < 1) return 'الآن';
    if (diffMins < 60) return `منذ ${diffMins} دقيقة`;
    if (diffHours < 24) return `منذ ${diffHours} ساعة`;
    if (diffDays === 1) return 'منذ يوم';
    if (diffDays === 2) return 'منذ يومين';
    if (diffDays < 7) return `منذ ${diffDays} أيام`;
    if (diffDays < 30) return `منذ ${Math.floor(diffDays / 7)} أسبوع`;
    return formatDate(d, locale, { dateStyle: 'short' });
  }
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return '1 day ago';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return formatDate(d, locale, { dateStyle: 'short' });
}

function deriveResultBadge(scan: ScanRecord, t: (k: string) => string): { label: string; cls: string } {
  if (scan.payment_status_at_scan === 'paid') {
    return { label: t('resultPaid'), cls: 'bg-green-100 text-green-700' };
  }
  if (scan.payment_recorded && scan.payment_method) {
    const digital = ['instapay', 'vodacash', 'vodafone_cash', 'orange', 'orange_cash', 'fawry', 'bank', 'bank_transfer'];
    if (digital.includes(String(scan.payment_method).toLowerCase())) {
      return { label: t('resultPending'), cls: 'bg-purple-100 text-purple-700' };
    }
    return { label: t('resultPaid'), cls: 'bg-green-100 text-green-700' };
  }
  return { label: t('resultUnpaid'), cls: 'bg-yellow-100 text-yellow-700' };
}

export default function AttendancePage() {
  const t = useTranslations('attendance');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const isRTL = locale === 'ar';

  const { from: defaultFrom, to: defaultTo } = getLast7Days();
  const [activeTab, setActiveTab] = useState<'student' | 'group'>('student');
  const [dateFrom, setDateFrom] = useState(defaultFrom);
  const [dateTo, setDateTo] = useState(defaultTo);
  const [searchQuery, setSearchQuery] = useState('');
  const [centerId, setCenterId] = useState<string | null>(null);
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [studentGroupMap, setStudentGroupMap] = useState<Record<string, string[]>>({});
  const [groupNameMap, setGroupNameMap] = useState<Record<string, { name: string; subject: string | null }>>({});
  const [groupMemberCount, setGroupMemberCount] = useState<Record<string, number>>({});
  const [expandedStudent, setExpandedStudent] = useState<string | null>(null);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadData = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const meRes = await fetch('/api/me', { headers: { Authorization: `Bearer ${session.access_token}` } });
    const meData = await meRes.json();
    if (!meData?.user?.center_id) return;
    const cid = meData.user.center_id;
    setCenterId(cid);

    setIsLoading(true);
    const fromTs = `${dateFrom}T00:00:00.000Z`;
    const toTs = `${dateTo}T23:59:59.999Z`;

    try {
      const [scansRes, studentsRes, groupsRes] = await Promise.all([
        dbSelect({
          table: 'attendance_scans',
          select: 'id, student_id, center_id, scanned_at, group_id, payment_status_at_scan, payment_method, payment_recorded, session_date',
          filters: [
            { column: 'center_id', op: 'eq', value: cid },
            { column: 'scanned_at', op: 'gte', value: fromTs },
            { column: 'scanned_at', op: 'lte', value: toTs },
          ],
          order: { column: 'scanned_at', ascending: false },
        }),
        dbSelect({
          table: 'students',
          select: 'id, name, phone, student_number',
          filters: [{ column: 'center_id', op: 'eq', value: cid }],
        }),
        dbSelect({
          table: 'student_groups',
          select: 'id, name, subject',
          filters: [{ column: 'center_id', op: 'eq', value: cid }],
        }),
      ]);

      const groupsData = (groupsRes.data || []) as Group[];
      setGroups(groupsData);
      const groupIds = groupsData.map((g) => g.id);
      setGroupNameMap(Object.fromEntries(groupsData.map((g) => [g.id, { name: g.name, subject: g.subject }])));

      let members: { student_id: string; group_id: string }[] = [];
      if (groupIds.length > 0) {
        const mRes = await dbSelect({
          table: 'student_group_members',
          select: 'student_id, group_id',
          filters: [{ column: 'group_id', op: 'in', value: groupIds }],
        });
        members = (mRes.data || []) as { student_id: string; group_id: string }[];
      }

      const sgm: Record<string, string[]> = {};
      const gmc: Record<string, number> = {};
      members.forEach((m) => {
        if (!sgm[m.student_id]) sgm[m.student_id] = [];
        sgm[m.student_id].push(m.group_id);
        gmc[m.group_id] = (gmc[m.group_id] || 0) + 1;
      });
      setStudentGroupMap(sgm);
      setGroupMemberCount(gmc);

      setScans((scansRes.data || []) as ScanRecord[]);
      setStudents((studentsRes.data || []) as Student[]);
    } catch (err) {
      console.error('Attendance load error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const byStudent = useMemo(() => {
    const scanCount: Record<string, number> = {};
    const lastScan: Record<string, string> = {};
    const scansByStudent: Record<string, ScanRecord[]> = {};
    const sessionDatesByGroup: Record<string, Set<string>> = {};

    scans.forEach((s) => {
      scanCount[s.student_id] = (scanCount[s.student_id] || 0) + 1;
      if (!lastScan[s.student_id] || s.scanned_at > lastScan[s.student_id]) {
        lastScan[s.student_id] = s.scanned_at;
      }
      if (!scansByStudent[s.student_id]) scansByStudent[s.student_id] = [];
      scansByStudent[s.student_id].push(s);
      if (s.group_id && s.session_date) {
        if (!sessionDatesByGroup[s.group_id]) sessionDatesByGroup[s.group_id] = new Set();
        sessionDatesByGroup[s.group_id].add(s.session_date);
      }
    });

    const expectedByStudent: Record<string, number> = {};
    Object.entries(studentGroupMap).forEach(([sid, gids]) => {
      let exp = 0;
      gids.forEach((gid) => {
        exp += sessionDatesByGroup[gid]?.size ?? 0;
      });
      expectedByStudent[sid] = exp;
    });

    return students
      .filter((s) => scanCount[s.id] > 0)
      .map((s) => ({
        student: s,
        totalScans: scanCount[s.id] || 0,
        lastScan: lastScan[s.id] || '',
        expected: expectedByStudent[s.id] || 0,
        scans: (scansByStudent[s.id] || []).sort((a, b) => (b.scanned_at > a.scanned_at ? 1 : -1)),
      }))
      .filter((r) => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.trim().toLowerCase();
        const name = (r.student.name || '').toLowerCase();
        const phone = (r.student.phone || '').replace(/\D/g, '');
        const num = (r.student.student_number || '').toLowerCase();
        return name.includes(q) || num.includes(q) || phone.includes(searchQuery.replace(/\D/g, ''));
      })
      .sort((a, b) => (b.lastScan > a.lastScan ? 1 : -1));
  }, [scans, students, studentGroupMap, searchQuery]);

  const byGroup = useMemo(() => {
    const byGroupId: Record<string, { group: Group; scans: ScanRecord[]; sessionDates: Set<string> }> = {};
    groups.forEach((g) => {
      byGroupId[g.id] = { group: g, scans: [], sessionDates: new Set() };
    });
    scans.forEach((s) => {
      if (s.group_id && byGroupId[s.group_id]) {
        byGroupId[s.group_id].scans.push(s);
        if (s.session_date) byGroupId[s.group_id].sessionDates.add(s.session_date);
      }
    });

    const studentsPerSession: Record<string, Record<string, number>> = {};
    Object.entries(byGroupId).forEach(([gid, data]) => {
      studentsPerSession[gid] = {};
      data.scans.forEach((sc) => {
        const key = sc.session_date || sc.scanned_at.slice(0, 10);
        studentsPerSession[gid][key] = (studentsPerSession[gid][key] || 0) + 1;
      });
    });

    return Object.entries(byGroupId)
      .filter(([, data]) => data.scans.length > 0)
      .map(([gid, data]) => {
        const sessionDates = Array.from(data.sessionDates).sort();
        const avgPerSession =
          sessionDates.length > 0
            ? data.scans.length / sessionDates.length
            : 0;
        const lastSession = sessionDates.length > 0 ? sessionDates[sessionDates.length - 1] : null;
        const sessionBreakdown = sessionDates.map((d) => ({
          date: d,
          present: studentsPerSession[gid]?.[d] ?? 0,
        }));
        return {
          group: data.group,
          sessionsCount: sessionDates.length,
          avgAttendance: Math.round(avgPerSession * 10) / 10,
          lastSession,
          sessionBreakdown,
          scans: data.scans,
        };
      })
      .filter((r) => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.trim().toLowerCase();
        const name = (r.group.name || '').toLowerCase();
        const subj = (r.group.subject || '').toLowerCase();
        return name.includes(q) || subj.includes(q);
      })
      .sort((a, b) => ((b.lastSession || '') > (a.lastSession || '') ? 1 : -1));
  }, [scans, groups, searchQuery]);

  const handleExportCSV = () => {
    const today = new Date().toISOString().slice(0, 10);
    if (activeTab === 'student') {
      const cols = ['Student Name', 'Phone', 'Total Scans', 'Last Scan Date', 'Attendance %'];
      const rows = byStudent.map((r) => [
        r.student.name || '',
        r.student.phone || '',
        String(r.totalScans),
        r.lastScan ? formatDate(r.lastScan, locale, { dateStyle: 'short' }) : '',
        r.expected > 0 ? `${Math.round((r.totalScans / r.expected) * 100)}%` : `${r.totalScans}`,
      ]);
      const csv = '\uFEFF' + [cols.join(','), ...rows.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `attendance-by-student-${today}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const cols = ['Group Name', 'Subject', 'Session Date', 'Students Present', 'Attendance %'];
      const rows: string[][] = [];
      byGroup.forEach((r) => {
        r.sessionBreakdown.forEach((sb) => {
          rows.push([
            r.group.name || '',
            r.group.subject || '',
            sb.date,
            String(sb.present),
            r.sessionsCount > 0 ? `${Math.round((sb.present / r.avgAttendance) * 100)}%` : tCommon('notSet'),
          ]);
        });
      });
      const csv = '\uFEFF' + [cols.join(','), ...rows.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `attendance-by-group-${today}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'} className="p-4 md:p-6 space-y-5 animate-fade-in min-h-screen w-full bg-[var(--color-surface-0)]">
      <div>
        <h1 className="text-2xl font-bold text-white">{t('title')}</h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">{t('subtitle')}</p>
      </div>

      {/* Filter bar */}
      <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm p-4 flex flex-col sm:flex-row flex-wrap gap-3 items-stretch sm:items-center">
        <LocalizedDateInput
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          locale={locale}
          className="px-3 py-2 rounded-lg text-sm border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] text-[var(--color-text-primary)]"
        />
        <LocalizedDateInput
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          locale={locale}
          className="px-3 py-2 rounded-lg text-sm border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] text-[var(--color-text-primary)]"
        />
        <div className="relative flex-1 min-w-[160px]">
          <Search size={15} className="absolute top-1/2 -translate-y-1/2 start-3 text-slate-400" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={activeTab === 'student' ? t('searchStudent') : t('searchGroup')}
            className="w-full ps-9 pe-4 py-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)]"
          />
        </div>
        <button
          onClick={handleExportCSV}
          className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-lg transition-colors shrink-0"
        >
          <Download size={14} /> {tCommon('exportCsv')}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[var(--color-surface-2)] p-1 rounded-xl">
        <button
          onClick={() => setActiveTab('student')}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors ${activeTab === 'student' ? 'bg-[var(--color-surface-1)] text-teal-600 shadow-sm' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}
        >
          <ClipboardList size={18} /> {t('byStudent')}
        </button>
        <button
          onClick={() => setActiveTab('group')}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors ${activeTab === 'group' ? 'bg-[var(--color-surface-1)] text-teal-600 shadow-sm' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}
        >
          <BookOpen size={18} /> {t('byGroup')}
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin h-8 w-8 border-2 border-teal-500 border-t-transparent rounded-full" />
        </div>
      ) : activeTab === 'student' ? (
        /* Tab 1: By Student */
        <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm overflow-hidden">
          {groups.length === 0 && byStudent.length === 0 ? (
            <EmptyState
              icon={<ClipboardList />}
              titleKey="attendance.title"
              descriptionKey="attendance.description"
              namespace="emptyStates"
              actionLabel="attendance.action"
              onAction={() => router.push(`/${locale}/scan`)}
            />
          ) : byStudent.length === 0 ? (
            <EmptyState
              icon={<ClipboardList />}
              titleKey="attendance.title"
              descriptionKey="attendance.description"
              namespace="emptyStates"
              actionLabel="attendance.action"
              onAction={() => router.push(`/${locale}/scan`)}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-0)]">
                    <th className="text-end py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase">{t('student')}</th>
                    <th className="text-end py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase">{t('totalAttendance')}</th>
                    <th className="text-end py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase">{t('lastSeen')}</th>
                    <th className="text-end py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase">{t('attendanceRate')}</th>
                    <th className="text-end py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase">{tCommon('actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {byStudent.map((r) => (
                    <React.Fragment key={r.student.id}>
                      <tr className="hover:bg-[var(--color-surface-0)] transition-colors">
                        <td className="py-3.5 px-4 text-end">
                          <div className="font-medium text-[var(--color-text-primary)]">{r.student.name}</div>
                          {r.student.student_number ? (
                            <div className="text-xs text-slate-400 mt-0.5" dir="ltr">
                              #{r.student.student_number}
                            </div>
                          ) : null}
                          {r.student.phone ? (
                            <div className="text-xs text-[var(--color-text-secondary)] font-mono mt-0.5" dir="ltr">
                              {r.student.phone}
                            </div>
                          ) : null}
                          {!r.student.student_number && !r.student.phone ? (
                            <div className="text-xs text-[var(--color-text-secondary)]">-</div>
                          ) : null}
                        </td>
                        <td className="py-3.5 px-4 text-sm font-mono font-bold text-[var(--color-text-primary)] text-end">{r.totalScans}</td>
                        <td className="py-3.5 px-4 text-sm text-[var(--color-text-secondary)] text-end">{formatRelativeTime(r.lastScan, locale)}</td>
                        <td className="py-3.5 px-4 text-end">
                          {r.expected > 0 ? (
                            <div className="flex items-center gap-2 justify-end">
                              <div className="w-20 h-2 bg-slate-200 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-teal-500 rounded-full"
                                  style={{ width: `${Math.min(100, (r.totalScans / r.expected) * 100)}%` }}
                                />
                              </div>
                              <span className="text-sm font-mono font-semibold">{Math.round((r.totalScans / r.expected) * 100)}%</span>
                            </div>
                          ) : (
                            <span className="text-sm font-mono">{r.totalScans}</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-end">
                          <button
                            onClick={() => setExpandedStudent(expandedStudent === r.student.id ? null : r.student.id)}
                            className="px-3 py-1.5 border border-teal-500 text-teal-600 hover:bg-teal-50 text-xs font-semibold rounded-lg transition-colors"
                          >
                            {t('viewLog')}
                          </button>
                        </td>
                      </tr>
                      {expandedStudent === r.student.id && (
                        <tr>
                          <td colSpan={5} className="bg-[var(--color-surface-0)] p-4">
                            <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] overflow-hidden">
                              <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border-subtle)]">
                                <h4 className="font-semibold text-[var(--color-text-primary)]">{r.student.name} - {t('scanLog')}</h4>
                                <button onClick={() => setExpandedStudent(null)} className="p-1 hover:bg-[var(--color-surface-2)] rounded">
                                  <X size={18} />
                                </button>
                              </div>
                              <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-0)]">
                                      <th className="text-end py-2 px-4 text-xs font-semibold text-[var(--color-text-secondary)]">{t('dateTime')}</th>
                                      <th className="text-end py-2 px-4 text-xs font-semibold text-[var(--color-text-secondary)]">{t('group')}</th>
                                      <th className="text-end py-2 px-4 text-xs font-semibold text-[var(--color-text-secondary)]">{t('result')}</th>
                                      <th className="text-end py-2 px-4 text-xs font-semibold text-[var(--color-text-secondary)]">{t('note')}</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {r.scans.map((sc) => {
                                      const badge = deriveResultBadge(sc, t);
                                      const grp = sc.group_id ? groupNameMap[sc.group_id] : null;
                                      return (
                                        <tr key={sc.id} className="border-b border-[var(--color-border-subtle)]">
                                          <td className="py-2 px-4 text-[var(--color-text-secondary)] text-end" dir="ltr">
                                            {sc.scanned_at
                                              ? formatDateTime(sc.scanned_at, locale, {
                                                  dateStyle: 'short',
                                                  timeStyle: 'short',
                                                })
                                              : tCommon('notSet')}
                                          </td>
                                          <td className="py-2 px-4 text-[var(--color-text-secondary)] text-end">
                                            {grp?.name ?? tCommon('notAvailable')}
                                          </td>
                                          <td className="py-2 px-4 text-end">
                                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${badge.cls}`}>{badge.label}</span>
                                          </td>
                                          <td className="py-2 px-4 text-[var(--color-text-secondary)] text-end">
                                            <span className="text-slate-600 text-xs" aria-hidden>
                                              -
                                            </span>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        /* Tab 2: By Group */
        <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm overflow-hidden">
          {groups.length === 0 ? (
            <EmptyState
              icon={<BookOpen />}
              titleKey="groups.title"
              descriptionKey="groups.description"
              namespace="emptyStates"
              actionLabel="groups.action"
              onAction={() => router.push(`/${locale}/groups`)}
            />
          ) : byGroup.length === 0 ? (
            <EmptyState
              icon={<BookOpen />}
              titleKey="attendance.title"
              descriptionKey="attendance.description"
              namespace="emptyStates"
              actionLabel="attendance.action"
              onAction={() => router.push(`/${locale}/scan`)}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-0)]">
                    <th className="text-end py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase">{t('group')}</th>
                    <th className="text-end py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase">{t('sessions')}</th>
                    <th className="text-end py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase">{t('avgAttendance')}</th>
                    <th className="text-end py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase">{t('lastSession')}</th>
                    <th className="text-end py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase">{tCommon('actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {byGroup.map((r) => (
                    <React.Fragment key={r.group.id}>
                      <tr className="hover:bg-[var(--color-surface-0)] transition-colors">
                        <td className="py-3.5 px-4 text-end">
                          <div className="font-medium text-[var(--color-text-primary)]">{r.group.name}</div>
                          {r.group.subject && (
                            <span className="inline-block mt-1 px-2 py-0.5 rounded text-xs bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]">{r.group.subject}</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-sm font-mono font-bold text-[var(--color-text-primary)] text-end">{r.sessionsCount}</td>
                        <td className="py-3.5 px-4 text-sm font-mono text-[var(--color-text-primary)] text-end">{r.avgAttendance}</td>
                        <td className="py-3.5 px-4 text-sm text-[var(--color-text-secondary)] text-end" dir="ltr">
                          {r.lastSession
                            ? formatDate(r.lastSession, locale, { dateStyle: 'short' })
                            : tCommon('notSet')}
                        </td>
                        <td className="py-3.5 px-4 text-end">
                          <button
                            onClick={() => setExpandedGroup(expandedGroup === r.group.id ? null : r.group.id)}
                            className="px-3 py-1.5 border border-teal-500 text-teal-600 hover:bg-teal-50 text-xs font-semibold rounded-lg transition-colors"
                          >
                            {t('viewDetails')}
                          </button>
                        </td>
                      </tr>
                      {expandedGroup === r.group.id && (
                        <tr>
                          <td colSpan={5} className="bg-[var(--color-surface-0)] p-4">
                            <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] overflow-hidden">
                              <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border-subtle)]">
                                <h4 className="font-semibold text-[var(--color-text-primary)]">{r.group.name} - {t('sessionBreakdown')}</h4>
                                <button onClick={() => setExpandedGroup(null)} className="p-1 hover:bg-[var(--color-surface-2)] rounded">
                                  <X size={18} />
                                </button>
                              </div>
                              <div className="px-4 py-3 border-b border-[var(--color-border-subtle)]">
                                <AttendanceHeatmap
                                  groupId={r.group.id}
                                  groupSize={groupMemberCount[r.group.id] ?? 0}
                                  weeks={8}
                                />
                              </div>
                              <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-0)]">
                                      <th className="text-end py-2 px-4 text-xs font-semibold text-[var(--color-text-secondary)]">{t('date')}</th>
                                      <th className="text-end py-2 px-4 text-xs font-semibold text-[var(--color-text-secondary)]">{t('studentsPresent')}</th>
                                      <th className="text-end py-2 px-4 text-xs font-semibold text-[var(--color-text-secondary)]">{t('attendanceRate')}</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {r.sessionBreakdown.map((sb) => (
                                      <tr key={sb.date} className="border-b border-[var(--color-border-subtle)]">
                                        <td className="py-2 px-4 text-[var(--color-text-secondary)] text-end" dir="ltr">
                                          {formatDate(sb.date, locale, { dateStyle: 'short' })}
                                        </td>
                                        <td className="py-2 px-4 text-[var(--color-text-primary)] font-mono text-end">{sb.present}</td>
                                        <td className="py-2 px-4 text-end">
                                          {r.avgAttendance > 0
                                            ? `${Math.round((sb.present / r.avgAttendance) * 100)}%`
                                            : tCommon('notSet')}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
