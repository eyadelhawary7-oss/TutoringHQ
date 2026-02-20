'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { dbSelect, dbUpdate, type Filter } from '@/lib/db-proxy';
import { useUser } from '@/contexts/UserContext';
import { exportPaymentsToExcel } from '@/lib/excel-export';
import { hasPlanFeature } from '@/lib/plans';
import { Link } from '@/i18n/routing';
import { Download, Search, Check, Clock, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';

interface PaymentRecord {
  id: string;
  student_id: string;
  center_id: string;
  amount: number;
  method: string;
  paid_at: string;
  status: string;
  confirmed?: boolean;
  confirmed_by?: string | null;
  confirmed_at?: string | null;
  confirmed_by_name?: string | null;
  recorded_by?: string | null;
  recorded_by_name?: string | null;
  group_id?: string | null;
  student_name?: string;
  student_number?: string;
  group_name?: string;
}

interface GroupOption {
  id: string;
  name: string;
}

const METHOD_KEYS: Record<string, string> = {
  cash: 'cash',
  instapay: 'instapay',
  vodafone_cash: 'vodacash',
  vodacash: 'vodacash',
  orange: 'orange',
  fawry: 'fawry',
  bank_transfer: 'bank',
  bank: 'bank',
  late_entry: 'lateEntry',
};

type StatusFilter = 'all' | 'confirmed' | 'pending' | 'late';

interface StudentSummaryRow {
  student_id: string;
  student_name: string;
  student_number: string;
  total_paid: number;
  total_pending: number;
  total_late: number;
  balance_due: number;
}

export default function PaymentsPage() {
  const t = useTranslations('payments');
  const tCommon = useTranslations('common');
  const tSettings = useTranslations('settings');
  const tDashboard = useTranslations('dashboard');
  const locale = useLocale();
  const { user, hasPermission } = useUser();
  const isRTL = locale === 'ar';
  const canConfirmPayments = user?.role === 'owner' || user?.role === 'admin' || hasPermission('can_record_payments');
  const canViewPayments = user?.role === 'owner' || user?.role === 'admin' || hasPermission('can_view_payments');

  const [records, setRecords] = useState<PaymentRecord[]>([]);
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [centerId, setCenterId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [view, setView] = useState<'log' | 'summary'>('log');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [methodFilter, setMethodFilter] = useState('all');
  const [groupFilter, setGroupFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [studentSummary, setStudentSummary] = useState<StudentSummaryRow[]>([]);
  const [sortOrder, setSortOrder] = useState<'high' | 'low'>('high');
  const [expandedStudent, setExpandedStudent] = useState<string | null>(null);
  const [showExportUpgradeModal, setShowExportUpgradeModal] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const filterRef = useRef({ dateFrom: '', dateTo: '', groupFilter: 'all', methodFilter: 'all' });
  const DEBUG = typeof window !== 'undefined' && process.env.NODE_ENV === 'development';

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const loadDataInner = useCallback(async () => {
    setLoadError(null);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    setUserId(session.user.id);

    const meRes = await fetch('/api/me', { headers: { 'Authorization': `Bearer ${session.access_token}` } });
    const meData = await meRes.json();
    if (!meData?.user?.center_id) return;
    setCenterId(meData.user.center_id);
    const cid = meData.user.center_id;

    const { dateFrom: df, dateTo: dt, groupFilter: gf, methodFilter: mf } = filterRef.current;

    const filters: Filter[] = [
      { column: 'center_id', op: 'eq', value: cid },
    ];
    if (df) filters.push({ column: 'paid_at', op: 'gte', value: `${df}T00:00:00.000Z` });
    if (dt) filters.push({ column: 'paid_at', op: 'lte', value: `${dt}T23:59:59.999Z` });
    if (gf && gf !== 'all') filters.push({ column: 'group_id', op: 'eq', value: gf });
    if (mf && mf !== 'all') filters.push({ column: 'method', op: 'eq', value: mf });

    const { data: paymentsData, error: payErr } = await dbSelect({
      table: 'payments',
      select: 'id, student_id, center_id, amount, method, recorded_by, paid_at, status, confirmed, confirmed_by, confirmed_at, group_id, students(name, student_number, phone), student_groups(name)',
      filters,
      order: { column: 'paid_at', ascending: false },
    });

    if (DEBUG && payErr) console.log('[payments] Pay err:', payErr);

    type PaymentRow = PaymentRecord & {
      students?: { name?: string; student_number?: string; phone?: string } | null;
      student_groups?: { name?: string } | null;
    };
    const payments = (paymentsData || []) as PaymentRow[];

    const { data: groupsData } = await dbSelect({
      table: 'student_groups',
      select: 'id, name',
      filters: [{ column: 'center_id', op: 'eq', value: cid }],
      order: { column: 'name' },
    });
    setGroups((groupsData || []) as GroupOption[]);

    const { data: scansDataPre } = await dbSelect({
      table: 'attendance_scans',
      select: 'student_id',
      filters: [{ column: 'center_id', op: 'eq', value: cid }],
    });
    const scanStudentIds = [...new Set(((scansDataPre || []) as { student_id: string }[]).map(s => s.student_id))];
    const studentIds = [...new Set([...payments.map(p => p.student_id), ...scanStudentIds])];
    const groupIds = [...new Set(payments.map(p => p.group_id).filter(Boolean))] as string[];

    let studentMap: Record<string, { name: string; student_number: string }> = {};
    let groupMap: Record<string, string> = {};
    if (studentIds.length > 0) {
      const { data: studentsData } = await dbSelect({
        table: 'students',
        select: 'id, name, student_number',
        filters: [{ column: 'id', op: 'in', value: studentIds }],
      });
      const students = (studentsData || []) as { id: string; name: string; student_number?: string }[];
      studentMap = Object.fromEntries(students.map(s => [s.id, { name: s.name || '', student_number: s.student_number || '\u2014' }]));
    }
    if (groupIds.length > 0) {
      const { data: groupsMapData } = await dbSelect({
        table: 'student_groups',
        select: 'id, name',
        filters: [{ column: 'id', op: 'in', value: groupIds }],
      });
      const gs = (groupsMapData || []) as { id: string; name: string }[];
      groupMap = Object.fromEntries(gs.map(g => [g.id, g.name || '']));
    }

    const userIds = [...new Set([
      ...payments.map(p => p.confirmed_by).filter(Boolean),
      ...payments.map(p => p.recorded_by).filter(Boolean),
    ])] as string[];
    let userMap: Record<string, string> = {};
    if (userIds.length > 0) {
      const { data: usersData } = await dbSelect({
        table: 'users',
        select: 'id, name',
        filters: [{ column: 'id', op: 'in', value: userIds }],
      });
      const users = (usersData || []) as { id: string; name: string | null }[];
      userMap = Object.fromEntries(users.map(u => [u.id, u.name || '\u2014']));
    }

    setRecords(payments.map(p => ({
      ...p,
      student_name: p.students?.name ?? studentMap[p.student_id]?.name ?? '\u2014',
      student_number: p.students?.student_number ?? studentMap[p.student_id]?.student_number ?? '\u2014',
      group_name: p.student_groups?.name ?? (p.group_id ? (groupMap[p.group_id] ?? '\u2014') : '\u2014'),
      confirmed_by_name: p.confirmed_by ? (userMap[p.confirmed_by] ?? '\u2014') : null,
      recorded_by_name: p.recorded_by ? (userMap[p.recorded_by] ?? '\u2014') : null,
    })));

    const totalPaid: Record<string, number> = {};
    const totalPending: Record<string, number> = {};
    const totalLate: Record<string, number> = {};
    const balanceDueByStudent: Record<string, number> = {};
    for (const p of payments) {
      const amt = parseFloat(String(p.amount ?? 0));
      if (p.confirmed === true && p.status !== 'late') {
        totalPaid[p.student_id] = (totalPaid[p.student_id] ?? 0) + amt;
      } else if (p.status === 'late') {
        totalLate[p.student_id] = (totalLate[p.student_id] ?? 0) + 1;
      } else if (p.confirmed === false || p.status === 'pending') {
        totalPending[p.student_id] = (totalPending[p.student_id] ?? 0) + amt;
        balanceDueByStudent[p.student_id] = (balanceDueByStudent[p.student_id] ?? 0) + amt;
      }
    }

    const allStudentIds = [...new Set([...Object.keys(totalPaid), ...Object.keys(totalPending), ...Object.keys(totalLate), ...Object.keys(balanceDueByStudent)])];
    const summaryRows: StudentSummaryRow[] = allStudentIds.map(sid => ({
      student_id: sid,
      student_name: studentMap[sid]?.name ?? '\u2014',
      student_number: studentMap[sid]?.student_number ?? '\u2014',
      total_paid: totalPaid[sid] ?? 0,
      total_pending: totalPending[sid] ?? 0,
      total_late: totalLate[sid] ?? 0,
      balance_due: balanceDueByStudent[sid] ?? 0,
    })).filter(r => r.total_paid > 0 || r.total_pending > 0 || r.total_late > 0 || r.balance_due > 0)
      .sort((a, b) => (b.balance_due - a.balance_due) || (b.total_pending - a.total_pending));
    setStudentSummary(summaryRows);
  }, []);

  const loadData = useCallback(async () => {
    filterRef.current = { dateFrom, dateTo, groupFilter, methodFilter };
    setIsLoading(true);
    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setIsOffline(true);
        setLoadError(t('offline', { defaultValue: 'You appear to be offline. Please check your connection.' }));
        setIsLoading(false);
        return;
      }
      setIsOffline(false);
      setLoadError(null);
      const maxRetries = 3;
      const delays = [1000, 2000, 4000];
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          if (attempt > 0) {
            setLoadError(t('retrying', { defaultValue: `Retrying... (${attempt}/${maxRetries})` }));
            await sleep(delays[attempt - 1]);
            setLoadError(null);
          }
          await loadDataInner();
          return;
        } catch (err) {
          if (attempt === maxRetries - 1) {
            setLoadError(err instanceof Error ? err.message : String(err));
          }
        }
      }
    } finally {
      setIsLoading(false);
    }
  }, [loadDataInner, t, dateFrom, dateTo, groupFilter, methodFilter]);

  useEffect(() => {
    const onOnline = () => { setIsOffline(false); loadData(); };
    const onOffline = () => setIsOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  }, [loadData]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    const onFocus = () => loadData();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [loadData]);

  const filtered = useMemo(() => {
    return records.filter(r => {
      if (statusFilter !== 'all') {
        if (statusFilter === 'confirmed' && (r.confirmed !== true || r.status !== 'confirmed')) return false;
        if (statusFilter === 'pending' && (r.status !== 'pending' && (r.confirmed !== false || r.status === 'late'))) return false;
        if (statusFilter === 'late' && r.status !== 'late') return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const name = (r.student_name ?? '').toLowerCase();
        const num = (r.student_number ?? '').toLowerCase();
        if (!name.includes(q) && !num.includes(q)) return false;
      }
      return true;
    });
  }, [records, statusFilter, searchQuery]);

  const sortedStudents = useMemo(() => {
    const list = studentSummary.filter(s => {
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const name = (s.student_name ?? '').toLowerCase();
        const num = (s.student_number ?? '').toLowerCase();
        if (!name.includes(q) && !num.includes(q)) return false;
      }
      return true;
    });
    if (sortOrder === 'high') return [...list].sort((a, b) => b.balance_due - a.balance_due);
    return [...list].sort((a, b) => a.balance_due - b.balance_due);
  }, [studentSummary, sortOrder, searchQuery]);

  const kpis = useMemo(() => {
    const confirmedTotal = records.filter(r => r.confirmed === true && r.status !== 'late').reduce((s, r) => s + (r.amount ?? 0), 0);
    const pendingCount = records.filter(r => (r.confirmed === false || r.status === 'pending') && r.status !== 'late').length;
    const lateCount = records.filter(r => r.status === 'late').length;
    return { confirmedTotal, pendingCount, lateCount };
  }, [records]);

  const handleConfirm = async (paymentId: string) => {
    if (!canConfirmPayments) return;
    setConfirmingId(paymentId);
    try {
      const { data: { user: u } } = await supabase.auth.getUser();
      await dbUpdate({
        table: 'payments',
        data: {
          confirmed: true,
          confirmed_by: u?.id ?? userId,
          confirmed_at: new Date().toISOString(),
          status: 'confirmed',
        },
        filters: [{ column: 'id', op: 'eq', value: paymentId }],
      });
      await loadData();
      setSuccessMessage(t('confirmed', { count: 1 }));
      setTimeout(() => setSuccessMessage(''), 4000);
    } catch (err) {
      console.error('Confirm error:', err);
    } finally {
      setConfirmingId(null);
    }
  };

  const canExportExcel = hasPlanFeature(user?.center?.plan, 'excel_export');
  const handleExport = () => {
    if (!canExportExcel) {
      setShowExportUpgradeModal(true);
      return;
    }
    exportPaymentsToExcel(filtered);
  };

  const formatMethod = (method: string) => {
    const key = METHOD_KEYS[method] || method;
    return (t(key as Parameters<typeof t>[0]) as string) || method;
  };

  const methods = useMemo(() => {
    const set = new Set(records.map(r => r.method).filter(Boolean));
    return Array.from(set);
  }, [records]);

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'} className="p-4 md:p-6 space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-[var(--text-primary)]">{t('title')}</h1>
        <button
          onClick={handleExport}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
        >
          <Download size={14} /> {t('exportExcel')}
        </button>
      </div>

      {/* Export upgrade modal */}
      {showExportUpgradeModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowExportUpgradeModal(false)}>
          <div className="bg-card rounded-2xl border border-border shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-foreground mb-2">{tSettings('upgradeToUnlockFeature')}</h3>
            <p className="text-sm text-muted-foreground mb-4">{tDashboard('exportExcelUpgrade')}</p>
            <div className="flex gap-2">
              <Link href="/settings/billing" className="inline-block px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-lg">
                {tDashboard('upgradePlan')}
              </Link>
              <button onClick={() => setShowExportUpgradeModal(false)} className="px-4 py-2 rounded-lg text-sm border border-border text-muted-foreground hover:bg-muted">
                {tCommon('cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {successMessage && (
        <div className="p-3 bg-green-50 border border-green-200 text-green-700 rounded-xl text-sm text-center">
          {successMessage}
        </div>
      )}

      {(loadError || isOffline) && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm">
          <p className="font-medium">{loadError || t('offline', { defaultValue: 'Offline' })}</p>
          <button onClick={() => loadData()} className="mt-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors">
            {t('retry', { defaultValue: 'Retry' })}
          </button>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: t('confirmedLabel'), value: `${kpis.confirmedTotal.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')} ${tCommon('egp')}`, color: '#16A34A', icon: Check },
          { label: t('filterPending'), value: kpis.pendingCount, color: '#F59E0B', icon: Clock },
          { label: t('lateEntry'), value: kpis.lateCount, color: '#7C3AED', icon: AlertTriangle },
        ].map(({ label, value, color, icon: Icon }) => (
          <div key={label} className="ch-card p-3 md:p-4 flex items-center gap-2 md:gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${color}18`, color }}><Icon size={16} /></div>
            <div className="min-w-0">
              <div className="font-black text-lg md:text-xl font-mono text-foreground">{value}</div>
              <div className="text-xs text-muted-foreground truncate">{label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* View toggle */}
      <div className="flex gap-1 p-1 rounded-xl border border-border w-fit" style={{ background: 'hsl(var(--muted))' }}>
        {[
          { key: 'log', label: t('transactionLog') },
          { key: 'summary', label: t('studentSummary') },
        ].map(({ key, label }) => (
          <button key={key} onClick={() => setView(key as 'log' | 'summary')} className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${view === key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="space-y-3">
        <div className="relative">
          <Search size={15} className="absolute top-1/2 -translate-y-1/2 start-3 text-muted-foreground" />
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={t('searchStudent', { defaultValue: 'Search student...' })}
            className="w-full ps-9 pe-4 py-2.5 rounded-xl border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-slate-400"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {(['all', 'confirmed', 'pending', 'late'] as const).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${statusFilter === s ? 'border-primary/50 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted'}`}
            >
              {s === 'all' ? tCommon('all', { defaultValue: 'All' }) : s === 'confirmed' ? t('confirmedStatus') : s === 'pending' ? t('filterPending') : t('lateEntry')}
            </button>
          ))}
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="px-3 py-1.5 rounded-lg text-xs border border-input bg-background text-foreground"
            />
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="px-3 py-1.5 rounded-lg text-xs border border-input bg-background text-foreground"
            />
          </div>
          <select value={groupFilter} onChange={e => setGroupFilter(e.target.value)} className="px-3 py-1.5 rounded-lg text-xs border border-input bg-background text-foreground">
            <option value="all">{t('allGroups', { defaultValue: 'All Groups' })}</option>
            {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <select value={methodFilter} onChange={e => setMethodFilter(e.target.value)} className="px-3 py-1.5 rounded-lg text-xs border border-input bg-background text-foreground">
            <option value="all">{t('allMethods', { defaultValue: 'All Methods' })}</option>
            {methods.map(m => <option key={m} value={m}>{formatMethod(m)}</option>)}
          </select>
        </div>
      </div>

      {/* Loading */}
      {isLoading ? (
        <div className="text-center py-16">
          <svg className="animate-spin h-8 w-8 text-teal-500 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        </div>
      ) : (
        <>
          {/* Transaction Log */}
          {view === 'log' && (
            <div className="ch-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead style={{ background: 'hsl(var(--muted))' }}>
                    <tr>
                      <th className="text-start px-4 py-3 font-medium text-muted-foreground">{t('student')}</th>
                      <th className="text-start px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">{t('group')}</th>
                      <th className="text-start px-4 py-3 font-medium text-muted-foreground">{t('amount')}</th>
                      <th className="text-start px-4 py-3 font-medium text-muted-foreground">{t('paymentMethod')}</th>
                      <th className="text-start px-4 py-3 font-medium text-muted-foreground">{tCommon('status')}</th>
                      <th className="text-start px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">{t('recordedBy', { defaultValue: 'Recorded By' })}</th>
                      {canViewPayments && <th className="text-start px-4 py-3 font-medium text-muted-foreground">{tCommon('actions')}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(p => (
                      <tr key={p.id} className="border-t border-border hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3">
                          <div className="font-medium text-foreground">{p.student_name}</div>
                          <div className="text-xs text-muted-foreground font-mono" dir="ltr">{p.student_number}</div>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground hidden md:table-cell text-xs">{p.group_name}</td>
                        <td className="px-4 py-3 font-bold text-foreground font-mono">{p.amount} {tCommon('egp')}</td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">{formatMethod(p.method)}</td>
                        <td className="px-4 py-3">
                          <span className={p.confirmed === true && p.status === 'confirmed' ? 'badge-confirmed' : p.status === 'late' ? 'badge-late' : 'badge-pending'}>
                            {p.confirmed === true && p.status === 'confirmed' ? t('confirmedStatus') : p.status === 'late' ? t('lateEntry') : t('filterPending')}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs hidden lg:table-cell">{p.recorded_by_name ?? '\u2014'}</td>
                        {canViewPayments && (
                          <td className="px-4 py-3">
                            {(p.confirmed === false || p.status === 'pending') && p.status !== 'late' && canConfirmPayments ? (
                              <button
                                onClick={() => handleConfirm(p.id)}
                                disabled={confirmingId === p.id}
                                className="px-3 py-1 rounded-lg text-xs font-semibold text-white disabled:opacity-50 transition-colors"
                                style={{ background: '#16A34A' }}
                              >
                                {t('confirm')}
                              </button>
                            ) : null}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filtered.length === 0 && <p className="p-8 text-center text-muted-foreground">{t('noPaymentsYet')}</p>}
            </div>
          )}

          {/* Student Summary */}
          {view === 'summary' && (
            <div className="space-y-3">
              <div className="flex justify-end">
                <button
                  onClick={() => setSortOrder(prev => prev === 'high' ? 'low' : 'high')}
                  className="text-xs px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:bg-muted transition-colors"
                >
                  {sortOrder === 'high' ? t('sortHighToLow') : t('sortLowToHigh')}
                </button>
              </div>
              {sortedStudents.map(s => (
                <div key={s.student_id} className="ch-card overflow-hidden">
                  <button
                    onClick={() => setExpandedStudent(expandedStudent === s.student_id ? null : s.student_id)}
                    className="w-full p-4 flex items-center justify-between text-start"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground">{s.student_name}</span>
                        {s.balance_due > 0 && (
                          <span className="text-xs font-bold font-mono px-2 py-0.5 rounded-full bg-destructive/10 text-destructive">
                            {s.balance_due.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')} {tCommon('egp')}
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-xs text-muted-foreground" dir="ltr">{s.student_number}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-end">
                        <span className="text-xs font-mono text-green-600 me-2">{s.total_paid.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')} {tCommon('egp')}</span>
                        {s.total_pending > 0 && <span className="text-xs font-mono text-amber-600 me-2">{s.total_pending.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')} {tCommon('egp')}</span>}
                        {s.total_late > 0 && <span className="badge-late">{s.total_late} {t('lateEntry')}</span>}
                      </div>
                      {expandedStudent === s.student_id ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
                    </div>
                  </button>
                  {expandedStudent === s.student_id && (
                    <div className="border-t border-border">
                      {records.filter(r => r.student_id === s.student_id).map(p => (
                        <div key={p.id} className="flex items-center justify-between px-4 py-2 text-xs border-b border-border last:border-0">
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">{p.group_name}</span>
                            <span className="text-muted-foreground">{formatMethod(p.method)}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-foreground">{p.amount} {tCommon('egp')}</span>
                            <span className={p.confirmed === true && p.status === 'confirmed' ? 'badge-confirmed' : p.status === 'late' ? 'badge-late' : 'badge-pending'}>
                              {p.confirmed === true && p.status === 'confirmed' ? t('confirmedStatus') : p.status === 'late' ? t('lateEntry') : t('filterPending')}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {sortedStudents.length === 0 && <p className="p-8 text-center text-muted-foreground">{t('noPaymentsYet')}</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
