'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { dbSelect, type Filter } from '@/lib/db-proxy';
import { useUser } from '@/contexts/UserContext';
import { getCsrfHeaders } from '@/lib/csrf-client';
import { Download, Search } from 'lucide-react';
import { KpiCard, SectionHeader } from '@/components/shared';
import { useRouter, useSearchParams } from 'next/navigation';
import EmptyState from '@/components/empty-states/EmptyState';
import { ReceiptModal } from '@/components/payments/ReceiptModal';
import { LoadingButton } from '@/components/ui/LoadingButton';
import { useToast } from '@/components/ui/ToastProvider';
import { LocalizedDateInput } from '@/components/forms/LocalizedDateInput';
import { formatCurrency, formatDateTime } from '@/lib/formatNumber';
import { formatStudentNumberForDisplay } from '@/lib/studentNumberDisplay';

interface PaymentRecord {
  id: string;
  student_id: string;
  center_id: string;
  amount: number;
  method: string;
  paid_at: string;
  status: string;
  confirmed?: boolean;
  recorded_by?: string | null;
  student_name?: string;
  student_number?: string;
  recorded_by_name?: string | null;
}

type ListStatusFilter = 'all' | 'pending' | 'confirmed' | 'today' | 'month';

type FilterPillKey = 'filter_all' | 'filter_pending' | 'filter_confirmed' | 'filter_today' | 'filter_month';

const STATUS_FILTER_KEYS: Record<ListStatusFilter, FilterPillKey> = {
  all: 'filter_all',
  pending: 'filter_pending',
  confirmed: 'filter_confirmed',
  today: 'filter_today',
  month: 'filter_month',
};

type MethodPillFilter = 'all' | 'cash' | 'instapay' | 'vodafone_cash' | 'orange_cash' | 'fawry' | 'bank_transfer';

const METHOD_CONFIG: Record<string, { color: string; bg: string }> = {
  cash: { color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
  instapay: { color: '#6366f1', bg: 'rgba(99,102,241,0.12)' },
  vodafone_cash: { color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
  orange_cash: { color: '#f97316', bg: 'rgba(249,115,22,0.12)' },
  fawry: { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  bank_transfer: { color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
};

function getTodayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function methodConfigKey(method: string): keyof typeof METHOD_CONFIG | null {
  const m = (method ?? '').toLowerCase();
  if (m === 'vodacash' || m === 'vodafone_cash') return 'vodafone_cash';
  if (m === 'orange' || m === 'orange_cash') return 'orange_cash';
  if (m === 'bank' || m === 'bank_transfer') return 'bank_transfer';
  if (m === 'cash' || m === 'نقدي' || m === 'كاش') return 'cash';
  if (m === 'instapay') return 'instapay';
  if (m === 'fawry') return 'fawry';
  return null;
}

type PaymentsMethodKey =
  | 'method_cash'
  | 'method_instapay'
  | 'method_vodafone_cash'
  | 'method_orange_cash'
  | 'method_fawry'
  | 'method_bank_transfer';

function methodTpKey(method: string): PaymentsMethodKey {
  const m = (method ?? '').toLowerCase();
  if (m === 'vodacash' || m === 'vodafone_cash') return 'method_vodafone_cash';
  if (m === 'orange' || m === 'orange_cash') return 'method_orange_cash';
  if (m === 'bank' || m === 'bank_transfer') return 'method_bank_transfer';
  if (m === 'instapay') return 'method_instapay';
  if (m === 'fawry') return 'method_fawry';
  return 'method_cash';
}

function paymentMatchesMethodFilter(pMethod: string, filter: MethodPillFilter): boolean {
  if (filter === 'all') return true;
  const pm = (pMethod ?? '').toLowerCase();
  if (filter === 'vodafone_cash') return pm === 'vodacash' || pm === 'vodafone_cash';
  if (filter === 'orange_cash') return pm === 'orange' || pm === 'orange_cash';
  if (filter === 'bank_transfer') return pm === 'bank' || pm === 'bank_transfer';
  return pm === filter;
}

function isPaymentConfirmed(p: PaymentRecord): boolean {
  return p.confirmed === true || p.status === 'confirmed';
}

function isPaymentPendingAction(p: PaymentRecord): boolean {
  return !isPaymentConfirmed(p) && (p.confirmed === false || p.status === 'pending');
}

const PAYMENTS_CACHE_KEY = 'chq_payments_cache';

function readPaymentsCache(): PaymentRecord[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(PAYMENTS_CACHE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as unknown;
    return Array.isArray(p) ? (p as PaymentRecord[]) : null;
  } catch {
    return null;
  }
}

export default function PaymentsPage() {
  const tp = useTranslations('payments');
  const tCommon = useTranslations('common');
  const tToast = useTranslations('toasts');
  const { toast } = useToast();
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, hasPermission } = useUser();
  const canViewPayments =
    user?.role === 'owner' || user?.role === 'admin' || user?.role === 'super_admin' || hasPermission('can_view_payments');
  const canCollectPayment =
    canViewPayments ||
    user?.can_record_payments === true ||
    hasPermission('can_record_payments');

  const [records, setRecords] = useState<PaymentRecord[] | null>(() => readPaymentsCache());
  const [paymentsFresh, setPaymentsFresh] = useState(false);
  const [methodFilter, setMethodFilter] = useState<MethodPillFilter>('all');
  const [statusFilter, setStatusFilter] = useState<ListStatusFilter>('all');
  const [dateFrom, setDateFrom] = useState(getTodayISO);
  const [dateTo, setDateTo] = useState(getTodayISO);
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [confirmModal, setConfirmModal] = useState<PaymentRecord | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [confirmedId, setConfirmedId] = useState<string | null>(null);
  const [confirmSuccessId, setConfirmSuccessId] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{
    studentName: string;
    amount: number;
    method: string;
    methodLabel: string;
    paidAt: string;
  } | null>(null);
  const [filterKey, setFilterKey] = useState(0);
  const [centerId, setCenterId] = useState<string | null>(null);
  const [centerStudents, setCenterStudents] = useState<{ id: string; name: string; student_number?: string }[]>([]);
  const [showCollectModal, setShowCollectModal] = useState(false);
  const [collectStudentId, setCollectStudentId] = useState('');
  const [collectAmount, setCollectAmount] = useState('');
  const [collectMethod, setCollectMethod] = useState<'cash' | 'instapay' | 'bank_transfer'>('cash');
  const [collectSubmitting, setCollectSubmitting] = useState(false);

  const loadData = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const meRes = await fetch('/api/me', { headers: { Authorization: `Bearer ${session.access_token}` } });
    const meData = await meRes.json();
    if (!meData?.user?.center_id) return;
    const cid = meData.user.center_id;

    setLoadFailed(false);
    setPaymentsFresh(false);

    try {
      const filters: Filter[] = [{ column: 'center_id', op: 'eq', value: cid }];
      filters.push({ column: 'paid_at', op: 'gte', value: `${dateFrom}T00:00:00.000Z` });
      filters.push({ column: 'paid_at', op: 'lte', value: `${dateTo}T23:59:59.999Z` });

      const { data: paymentsData, error: payErr } = await dbSelect({
        table: 'payments',
        select: 'id, student_id, center_id, amount, method, recorded_by, paid_at, status, confirmed, students(name, student_number)',
        filters,
        order: { column: 'paid_at', ascending: false },
      });

      if (payErr) throw payErr;

      type PaymentRow = PaymentRecord & { students?: { name?: string; student_number?: string } | null };
      const payments = (paymentsData || []) as PaymentRow[];

      const studentIds = [...new Set(payments.map((p) => p.student_id))];
      const userIds = [...new Set(payments.map((p) => p.recorded_by).filter(Boolean))] as string[];

      let studentMap: Record<string, { name: string; student_number: string }> = {};
      let userMap: Record<string, string> = {};

      const { data: allStudentsData } = await dbSelect({
        table: 'students',
        select: 'id, name, student_number, balance_due',
        filters: [{ column: 'center_id', op: 'eq', value: cid }],
      });
      const allStudents = (allStudentsData || []) as { id: string; name: string; student_number?: string; balance_due?: number }[];

      setCenterId(cid);
      setCenterStudents(
        allStudents.map((s) => ({
          id: s.id,
          name: s.name || tCommon('notAvailable'),
          student_number: s.student_number,
        })),
      );

      if (studentIds.length > 0) {
        studentMap = Object.fromEntries(
          allStudents
            .filter((s) => studentIds.includes(s.id))
            .map((s) => [
              s.id,
              {
                name: s.name || tCommon('notAvailable'),
                student_number: s.student_number || tCommon('notSet'),
              },
            ])
        );
      }

      if (userIds.length > 0) {
        const { data: usersData } = await dbSelect({
          table: 'users',
          select: 'id, name',
          filters: [{ column: 'id', op: 'in', value: userIds }],
        });
        const users = (usersData || []) as { id: string; name: string | null }[];
        userMap = Object.fromEntries(users.map((u) => [u.id, u.name || tCommon('notAvailable')]));
      }

      const mapped = payments.map((p) => ({
        ...p,
        student_name:
          p.students?.name ??
          studentMap[p.student_id]?.name ??
          allStudents.find((s) => s.id === p.student_id)?.name ??
          tCommon('notAvailable'),
        student_number:
          p.students?.student_number ??
          studentMap[p.student_id]?.student_number ??
          allStudents.find((s) => s.id === p.student_id)?.student_number ??
          tCommon('notSet'),
        recorded_by_name: p.recorded_by ? (userMap[p.recorded_by] ?? tCommon('notSet')) : null,
      }));
      setRecords(mapped);
      try {
        sessionStorage.setItem(PAYMENTS_CACHE_KEY, JSON.stringify(mapped));
      } catch {
        /* private mode / quota */
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(tToast('error'), msg);
      setLoadFailed(true);
    } finally {
      setPaymentsFresh(true);
    }
  }, [dateFrom, dateTo, toast, tToast, tCommon]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (searchParams?.get('action') === 'collect' && canCollectPayment) {
      setShowCollectModal(true);
    }
  }, [searchParams, canCollectPayment]);

  const recordsList = records ?? [];
  const paymentsStale = Boolean(records !== null && !paymentsFresh);

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  const { totalToday, totalPending, totalMonth } = useMemo(() => {
    const tt = recordsList
      .filter((p) => p.confirmed === true && (p.paid_at ?? '').startsWith(todayStr))
      .reduce((sum, p) => sum + Number(p.amount), 0);
    const tpending = recordsList.filter((p) => p.confirmed === false).reduce((sum, p) => sum + Number(p.amount), 0);
    const tm = recordsList
      .filter(
        (p) =>
          p.confirmed === true &&
          new Date(p.paid_at ?? '').getMonth() === today.getMonth() &&
          new Date(p.paid_at ?? '').getFullYear() === today.getFullYear()
      )
      .reduce((sum, p) => sum + Number(p.amount), 0);
    return { totalToday: tt, totalPending: tpending, totalMonth: tm };
  }, [recordsList, todayStr, today]);

  const filteredPayments = useMemo(() => {
    return recordsList.filter((p) => {
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const name = (p.student_name ?? '').toLowerCase();
        const num = (p.student_number ?? '').replace(/^#/, '').toLowerCase();
        const qNum = q.replace(/^#/, '').toLowerCase();
        if (!name.includes(q) && !num.includes(qNum)) return false;
      }

      const matchStatus =
        statusFilter === 'all'
          ? true
          : statusFilter === 'pending'
            ? p.confirmed === false
            : statusFilter === 'confirmed'
              ? p.confirmed === true
              : statusFilter === 'today'
                ? (p.paid_at ?? '').startsWith(todayStr)
                : statusFilter === 'month'
                  ? new Date(p.paid_at ?? '').getMonth() === today.getMonth() &&
                    new Date(p.paid_at ?? '').getFullYear() === today.getFullYear()
                  : true;

      const matchMethod = paymentMatchesMethodFilter(p.method, methodFilter);
      return matchStatus && matchMethod;
    });
  }, [recordsList, searchQuery, statusFilter, methodFilter, todayStr, today]);

  const handleConfirm = async (paymentId: string) => {
    if (!canViewPayments) return;
    const snapshot =
      confirmModal?.id === paymentId ? confirmModal : recordsList.find((r) => r.id === paymentId) ?? null;
    setConfirmingId(paymentId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const headers = await getCsrfHeaders(session.access_token);
      const res = await fetch('/api/payments/confirm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          ...headers,
        },
        body: JSON.stringify({ payment_id: paymentId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed');
      setConfirmModal(null);
      await loadData();
      if (snapshot) {
        setConfirmedId(snapshot.id);
        setReceipt({
          studentName: snapshot.student_name ?? tCommon('notAvailable'),
          amount: Number(snapshot.amount),
          method: snapshot.method,
          methodLabel: tp(methodTpKey(snapshot.method)),
          paidAt: snapshot.paid_at ?? new Date().toISOString(),
        });
        setTimeout(() => setConfirmedId(null), 2000);
        setConfirmSuccessId(snapshot.id);
        setTimeout(() => setConfirmSuccessId(null), 1500);
      }
      toast.success(tp('confirmed', { count: 1 }));
    } catch (err) {
      toast.error(
        tToast('error'),
        err instanceof Error ? err.message : tCommon('error'),
      );
    } finally {
      setConfirmingId(null);
    }
  };

  const handleCollectPayment = async () => {
    if (!centerId || !user?.id || !collectStudentId) {
      toast.error(tToast('error'), tp('collectSelectStudent'));
      return;
    }
    const amount = Number.parseFloat(collectAmount.replace(/,/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error(tToast('error'), tCommon('error'));
      return;
    }
    const isCash = collectMethod === 'cash';
    const method = collectMethod;
    setCollectSubmitting(true);
    try {
      // Route through the server-gated collect endpoint. The server re-checks the
      // caller's permission (owner / super-admin / can_record_payments) before
      // writing, forces center_id to the authenticated centre, and audits the
      // collection — so a bypass of the hidden button cannot record a payment.
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error(tToast('error'), tCommon('error'));
        return;
      }
      const headers = await getCsrfHeaders(session.access_token);
      const res = await fetch('/api/payments/collect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          ...headers,
        },
        body: JSON.stringify({
          student_id: collectStudentId,
          amount,
          method,
          group_id: null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || tCommon('error'));
      const paidAt: string = typeof data?.paidAt === 'string' ? data.paidAt : new Date().toISOString();
      const st = centerStudents.find((s) => s.id === collectStudentId);
      toast.success(tToast('saved'));
      setShowCollectModal(false);
      setCollectStudentId('');
      setCollectAmount('');
      setCollectMethod('cash');
      if (isCash) {
        setReceipt({
          studentName: st?.name ?? tCommon('notAvailable'),
          amount,
          method,
          methodLabel: tp(methodTpKey(method)),
          paidAt,
        });
      }
      await loadData();
    } catch (err) {
      toast.error(
        tToast('error'),
        err instanceof Error ? err.message : tCommon('error'),
      );
    } finally {
      setCollectSubmitting(false);
    }
  };

  const handleExportCSV = () => {
    const cols = [
      tp('csv_col_date'),
      tp('csv_col_student'),
      tp('csv_col_amount'),
      tp('csv_col_method'),
      tp('csv_col_status'),
      tp('csv_col_recorded_by'),
    ];
    const rows = filteredPayments.map((r) => [
      r.paid_at ? formatDateTime(r.paid_at, locale) : '',
      r.student_name ?? '',
      String(r.amount ?? 0),
      tp(methodTpKey(r.method)),
      isPaymentConfirmed(r) ? tp('status_confirmed') : tp('status_pending'),
      r.recorded_by_name ?? '',
    ]);
    const csvContent =
      '\uFEFF' + [cols.join(','), ...rows.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payments-${getTodayISO()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="min-h-screen w-full bg-[var(--color-surface-0)] animate-fade-in pb-[calc(56px_+_env(safe-area-inset-bottom,0px))] md:pb-0">
        <div className="px-4 pt-4 pb-3 max-w-3xl mx-auto w-full flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">{tp('title')}</h1>
            <p className="text-xs text-[var(--color-text-secondary)]">{tp('subtitle')}</p>
          </div>
          {canCollectPayment ? (
            <button
              type="button"
              onClick={() => setShowCollectModal(true)}
              className="bg-teal-600 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-teal-700 transition shrink-0 btn-press chq-focus"
            >
              {tp('collectPayment')}
            </button>
          ) : null}
        </div>

        {loadFailed ? (
          <div className="mb-3 flex justify-center px-4 max-w-3xl mx-auto w-full">
            <button
              type="button"
              onClick={() => loadData()}
              className="rounded-lg bg-[var(--color-brand-500)] px-4 py-2 text-sm font-medium text-white btn-press chq-focus"
            >
              {tp('retry')}
            </button>
          </div>
        ) : null}

        <div className="px-4 mb-3 max-w-3xl mx-auto w-full">
          <SectionHeader title={tCommon('sectionAtAGlance')} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 px-4 mb-4 max-w-3xl mx-auto w-full">
          {records === null ? (
            <>
              <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] shadow-sm p-6 flex flex-col gap-2" aria-hidden>
                <div className="h-3 w-24 rounded bg-[var(--color-surface-2)] animate-pulse" />
                <div className="h-7 w-28 rounded bg-[var(--color-surface-2)] animate-pulse" />
              </div>
              <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] shadow-sm p-6 flex flex-col gap-2" aria-hidden>
                <div className="h-3 w-28 rounded bg-[var(--color-surface-2)] animate-pulse" />
                <div className="h-7 w-28 rounded bg-[var(--color-surface-2)] animate-pulse" />
              </div>
              <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] shadow-sm p-6 flex flex-col gap-2" aria-hidden>
                <div className="h-3 w-28 rounded bg-[var(--color-surface-2)] animate-pulse" />
                <div className="h-7 w-28 rounded bg-[var(--color-surface-2)] animate-pulse" />
              </div>
            </>
          ) : (
            <div
              className={`contents transition-opacity duration-300 ${paymentsStale ? 'opacity-70' : 'opacity-100'}`}
            >
              <KpiCard
                label={tp('total_today')}
                value={formatCurrency(totalToday, locale)}
                tone="success"
              />
              <KpiCard
                label={tp('total_pending')}
                value={formatCurrency(totalPending, locale)}
                tone="warning"
              />
              <KpiCard
                label={tp('total_month')}
                value={formatCurrency(totalMonth, locale)}
                tone="muted"
              />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 px-4 pb-2 max-w-3xl mx-auto w-full">
          <span className="text-xs font-medium text-[var(--color-text-secondary)] me-1">{tCommon('status')}</span>
          {(['all', 'pending', 'confirmed', 'today', 'month'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => {
                setStatusFilter(f);
                setFilterKey((k) => k + 1);
              }}
              className={`shrink-0 px-3 py-1.5 rounded-badge text-xs font-medium transition-all duration-fast ease-out ${statusFilter === f ? 'bg-[var(--color-brand-500)] text-white' : 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]'} btn-press chq-focus`}
            >
              {tp(STATUS_FILTER_KEYS[f])}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 px-4 pb-3 max-w-3xl mx-auto w-full">
          <span className="text-xs font-medium text-[var(--color-text-secondary)] me-1">{tp('method')}</span>
          {(['all', 'cash', 'instapay', 'vodafone_cash', 'orange_cash', 'fawry', 'bank_transfer'] as const).map((m) => {
            const cfg = METHOD_CONFIG[m];
            const isActive = methodFilter === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMethodFilter(m);
                  setFilterKey((k) => k + 1);
                }}
                className="shrink-0 method-pill transition-all duration-fast ease-out btn-press chq-focus"
                style={
                  isActive
                    ? cfg
                      ? {
                          background: cfg.bg,
                          color: cfg.color,
                          outline: `1.5px solid ${cfg.color}`,
                        }
                      : {
                          background: 'var(--color-brand-500)',
                          color: '#ffffff',
                        }
                    : {
                        background: 'var(--color-surface-2)',
                        color: 'var(--color-text-secondary)',
                      }
                }
              >
                {m === 'all' ? tp('filter_all') : tp(`method_${m}` as PaymentsMethodKey)}
              </button>
            );
          })}
        </div>

        <div className="px-4 max-w-3xl mx-auto w-full space-y-3 mb-4">
          <div className="flex flex-col sm:flex-row flex-wrap gap-2 items-end">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-[var(--color-text-secondary)]">{tCommon('startDate')}</span>
              <LocalizedDateInput
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                locale={locale}
                className="px-3 py-2 rounded-lg text-sm border border-[var(--color-border-default)] bg-[var(--color-surface-1)] text-[var(--color-text-primary)]"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-[var(--color-text-secondary)]">{tCommon('endDate')}</span>
              <LocalizedDateInput
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                locale={locale}
                className="px-3 py-2 rounded-lg text-sm border border-[var(--color-border-default)] bg-[var(--color-surface-1)] text-[var(--color-text-primary)]"
              />
            </label>
            <div className="relative flex-1 min-w-[160px]">
              <Search size={15} className="absolute top-1/2 -translate-y-1/2 start-3 text-[var(--color-text-tertiary)]" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={tp('searchStudent')}
                className="w-full ps-9 pe-4 py-2 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-1)] text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)]"
              />
            </div>
            <button
              type="button"
              onClick={handleExportCSV}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-1)] text-[var(--color-text-primary)] text-sm font-semibold hover:bg-[var(--color-surface-2)] hover:border-teal-500/40 shrink-0 btn-press chq-focus self-end ms-auto"
            >
              <Download size={14} /> {tCommon('exportCsv')}
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-2 px-4 max-w-3xl mx-auto w-full pb-8" key={filterKey}>
          {records === null ? (
            <div className="flex flex-col gap-2" aria-busy="true">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="card p-4 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)]">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="h-6 w-24 rounded-full bg-[var(--color-surface-2)] animate-pulse" />
                    <div className="flex items-center gap-2 ms-auto">
                      <div className="h-6 w-16 rounded bg-[var(--color-surface-2)] animate-pulse" />
                      <div className="h-5 w-14 rounded-md bg-[var(--color-surface-2)] animate-pulse" />
                    </div>
                  </div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-col gap-1.5 min-w-0 flex-1">
                      <div className="h-4 w-40 max-w-full rounded bg-[var(--color-surface-2)] animate-pulse" />
                      <div className="h-3 w-24 rounded bg-[var(--color-surface-2)] animate-pulse" />
                    </div>
                    <div className="h-3 w-28 shrink-0 rounded bg-[var(--color-surface-2)] animate-pulse ms-auto" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredPayments.length === 0 ? (
            <div className="card p-10 flex flex-col items-center gap-3 mt-2">
              <svg
                width="40"
                height="40"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                viewBox="0 0 24 24"
                className="text-[var(--color-text-tertiary)]"
              >
                <rect x="2" y="5" width="20" height="14" rx="2" />
                <line x1="2" y1="10" x2="22" y2="10" />
              </svg>
              <p className="text-sm font-medium text-[var(--color-text-secondary)]">{tp('empty_title')}</p>
              <p className="text-xs text-[var(--color-text-tertiary)]">{tp('empty_subtitle')}</p>
            </div>
          ) : (
            <div
              className={`flex flex-col gap-2 transition-opacity duration-300 ${paymentsStale ? 'opacity-70' : 'opacity-100'}`}
            >
            {filteredPayments.map((payment, index) => {
              const cfgKey = methodConfigKey(payment.method);
              const cfg = cfgKey ? METHOD_CONFIG[cfgKey] : { color: '#64748b', bg: 'rgba(100,116,139,0.12)' };
              const isJustConfirmed = confirmedId === payment.id;

              return (
                <div
                  key={payment.id}
                  className={`card p-4 payment-row-enter ${isJustConfirmed ? 'payment-confirmed-flash' : ''}`}
                  style={{ animationDelay: `${Math.min(index * 20, 120)}ms` }}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="method-pill" style={{ background: cfg.bg, color: cfg.color }}>
                      {tp(methodTpKey(payment.method))}
                    </span>
                    <div className="flex items-center gap-2 ms-auto min-w-0 text-end tabular-nums">
                      <span className="text-base font-bold text-[var(--color-text-primary)] tabular-nums">
                        {formatCurrency(Number(payment.amount), locale)}
                      </span>
                      {isPaymentConfirmed(payment) ? (
                        <span className="badge badge-success text-xs">{tp('status_confirmed')}</span>
                      ) : (
                        <span className="badge badge-gold text-xs">{tp('status_pending')}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <p className="text-sm text-[var(--color-text-secondary)] truncate">{payment.student_name}</p>
                      {payment.student_number && payment.student_number !== tCommon('notSet') ? (
                        <p className="text-xs text-[var(--color-text-muted)] truncate" dir="ltr">
                          {formatStudentNumberForDisplay(payment.student_number)}
                        </p>
                      ) : null}
                    </div>
                    <p className="text-xs text-[var(--color-text-tertiary)] shrink-0" dir="ltr">
                      {formatDateTime(payment.paid_at ?? '', locale, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>

                  {isPaymentPendingAction(payment) && canViewPayments && (
                    <div className="mt-3 pt-3 border-t border-[var(--color-border-subtle)]">
                      <LoadingButton
                        type="button"
                        variant="primary"
                        state={
                          confirmingId === payment.id
                            ? 'loading'
                            : confirmSuccessId === payment.id
                              ? 'success'
                              : 'idle'
                        }
                        onClick={() => setConfirmModal(payment)}
                        className="btn-primary w-full py-2 text-sm"
                      >
                        {tp('confirm_action')}
                      </LoadingButton>
                    </div>
                  )}
                </div>
              );
            })}
            </div>
          )}
        </div>
      </div>

      {showCollectModal && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => !collectSubmitting && setShowCollectModal(false)}
          role="presentation"
        >
          <div
            className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-default)] shadow-sm w-full max-w-md p-6 modal-spring-in"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-labelledby="collect-payment-title"
          >
            <h3 id="collect-payment-title" className="text-lg font-bold text-[var(--color-text-primary)] mb-4">
              {tp('collectPayment')}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">{tp('student')}</label>
                <select
                  value={collectStudentId}
                  onChange={(e) => setCollectStudentId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-0)] text-sm text-[var(--color-text-primary)]"
                >
                  <option value="">{tp('collectSelectStudent')}</option>
                  {[...centerStudents]
                    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                        {s.student_number ? ` · ${formatStudentNumberForDisplay(s.student_number)}` : ''}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">{tp('amount')}</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={collectAmount}
                  onChange={(e) => setCollectAmount(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-0)] text-sm font-mono text-[var(--color-text-primary)]"
                  placeholder="0"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">{tp('paymentMethod')}</label>
                <div className="flex flex-wrap gap-2">
                  {(['cash', 'instapay', 'bank_transfer'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setCollectMethod(m)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors btn-press chq-focus ${
                        collectMethod === m
                          ? 'border-teal-600 bg-teal-600/15 text-teal-700 dark:text-teal-300'
                          : 'border-[var(--color-border-default)] text-[var(--color-text-secondary)]'
                      }`}
                    >
                      {tp(`method_${m}` as PaymentsMethodKey)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-3 justify-end mt-6">
              <button
                type="button"
                disabled={collectSubmitting}
                onClick={() => setShowCollectModal(false)}
                className="px-4 py-2 border border-[var(--color-border-default)] rounded-lg text-sm text-[var(--color-text-primary)] btn-press chq-focus disabled:opacity-50"
              >
                {tCommon('cancel')}
              </button>
              <LoadingButton
                type="button"
                variant="primary"
                state={collectSubmitting ? 'loading' : 'idle'}
                onClick={() => void handleCollectPayment()}
                className="btn-primary px-4 py-2 rounded-lg text-sm font-semibold"
                loadingText={tCommon('loading')}
              >
                {tp('recordPayment')}
              </LoadingButton>
            </div>
          </div>
        </div>
      )}

      {confirmModal && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => setConfirmModal(null)}
        >
          <div
            className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-default)] shadow-sm w-full max-w-md p-6 modal-spring-in"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-[var(--color-text-primary)] mb-4">{tp('confirmPayment')}</h3>
            <p className="text-sm text-[var(--color-text-secondary)] mb-6">
              {formatCurrency(Number(confirmModal.amount), locale)} · {tp(methodTpKey(confirmModal.method))} ·{' '}
              {confirmModal.student_name}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                className="px-4 py-2 border border-[var(--color-border-default)] rounded-lg text-sm text-[var(--color-text-primary)] btn-press chq-focus"
              >
                {tCommon('cancel')}
              </button>
              <LoadingButton
                type="button"
                variant="primary"
                state={confirmingId === confirmModal.id ? 'loading' : 'idle'}
                onClick={() => handleConfirm(confirmModal.id)}
                className="btn-primary px-4 py-2 rounded-lg text-sm font-semibold"
                loadingText={tCommon('loading')}
              >
                {tCommon('confirm')}
              </LoadingButton>
            </div>
          </div>
        </div>
      )}

      <ReceiptModal
        isOpen={receipt !== null}
        onClose={() => setReceipt(null)}
        studentName={receipt?.studentName ?? ''}
        amount={receipt?.amount ?? 0}
        method={receipt?.method ?? ''}
        methodLabel={receipt?.methodLabel ?? ''}
        paidAt={receipt?.paidAt ?? ''}
      />
    </>
  );
}
