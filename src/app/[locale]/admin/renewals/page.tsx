'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { AdminSidebar } from '@/components/AdminSidebar';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { useSidebar } from '@/contexts/SidebarContext';
import { useLayout } from '@/contexts/LayoutContext';
import { getCsrfHeaders } from '@/lib/csrf-client';
import {
  RefreshCw,
  CreditCard,
  Calendar,
  AlertTriangle,
  TrendingDown,
  X,
  ArrowLeft,
} from 'lucide-react';
import { formatDate, formatNumber } from '@/lib/formatNumber';

interface RenewalRow {
  id: string;
  name: string;
  phone?: string | null;
  subscription_renewal_date: string | null;
  subscription_monthly_fee: number | null;
  subscription_billing_period: string | null;
  subscription_status: string | null;
  daysUntil: number;
  renewalDate: string | null;
}

interface Summary {
  renewalsThisWeek: number;
  overdueCount: number;
  mrrAtRisk: number;
}

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  overdue: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  suspended: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  cancelled: 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)] dark:bg-gray-800 dark:text-[var(--color-text-tertiary)]',
};

function formatRenewalDate(dateStr: string | null, loc: string): string {
  if (!dateStr) return '\u2014';
  return formatDate(`${dateStr}T12:00:00`, loc, { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatAmount(amount: number | null, loc: string): string {
  if (amount == null || isNaN(amount)) return formatNumber(0, loc, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return formatNumber(Number(amount), loc, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function subscriptionStatusLabel(
  raw: string | null | undefined,
  tStatus: (key: string) => string,
): string {
  const s = (raw || 'active').toLowerCase().replace(/-/g, '_');
  const known = new Set([
    'active',
    'suspended',
    'pending',
    'cancelled',
    'overdue',
    'paid',
    'rejected',
    'pending_payment',
  ]);
  if (known.has(s)) return tStatus(s);
  return tStatus('active');
}

export default function AdminRenewalsPage() {
  const t = useTranslations('admin');
  const tCommon = useTranslations('common');
  const tStatus = useTranslations('status');
  const locale = useLocale();
  const router = useRouter();
  const { closeMainSidebar } = useSidebar() ?? {};
  const { setHideShell } = useLayout();

  const [centers, setCenters] = useState<RenewalRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [filter, setFilter] = useState<'all' | 'this_week' | 'this_month' | 'overdue'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recordModal, setRecordModal] = useState<RenewalRow | null>(null);
  const [recordAmount, setRecordAmount] = useState('');
  const [recordMethod, setRecordMethod] = useState('bank_transfer');
  const [recordNotes, setRecordNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const getSession = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session;
  }, []);

  const getAuthHeaders = useCallback(async () => {
    const session = await getSession();
    if (!session) return null;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    };
    const csrf = await getCsrfHeaders(session.access_token);
    Object.assign(headers, csrf);
    return headers;
  }, [getSession]);

  const loadData = useCallback(async () => {
    const session = await getSession();
    if (!session) {
      router.replace('/login');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/renewals?filter=${filter}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.status === 403) {
        router.replace('/dashboard');
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err?.error || 'Failed to load');
        return;
      }
      const data = await res.json();
      setCenters(data.centers || []);
      setSummary(data.summary || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, [getSession, router, filter]);

  useEffect(() => {
    setHideShell(true);
    return () => setHideShell(false);
  }, [setHideShell]);

  useEffect(() => {
    closeMainSidebar?.();
  }, [closeMainSidebar]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRecordPayment = async () => {
    if (!recordModal) return;
    const amount = parseFloat(recordAmount);
    if (isNaN(amount) || amount <= 0) return;
    const headers = await getAuthHeaders();
    if (!headers) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/renewals', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          center_id: recordModal.id,
          amount,
          payment_method: recordMethod,
          notes: recordNotes,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || 'Failed to record');
      }
      setRecordModal(null);
      setRecordAmount('');
      setRecordNotes('');
      loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 min-h-screen w-full bg-[var(--color-surface-0)]">
      <AdminHeader />
      <div className="flex flex-1">
        <AdminSidebar activeRoute="/admin/renewals" />
        <main className="flex-1 flex flex-col min-w-0 p-4 md:p-6 overflow-auto lg:ms-56">
        <div className="flex items-center gap-2 mb-4">
          <button
            onClick={() => router.push('/admin')}
            className="p-1.5 rounded-lg hover:bg-muted"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-bold">{t('renewals')}</h1>
        </div>
        <div className="flex-1">
          {/* Summary cards */}
          {summary && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              <div className="rounded-xl border border-border bg-[var(--color-surface-1)] p-4">
                <div className="flex items-center gap-2 text-[var(--color-text-secondary)] text-sm mb-1">
                  <Calendar size={16} />
                  {t('renewalsThisWeek')}
                </div>
                <div className="text-2xl font-bold text-[var(--color-text-primary)]">{formatNumber(summary.renewalsThisWeek, locale)}</div>
              </div>
              <div className="rounded-xl border border-border bg-[var(--color-surface-1)] p-4">
                <div className="flex items-center gap-2 text-[var(--color-text-secondary)] text-sm mb-1">
                  <AlertTriangle size={16} />
                  {t('overdueCentersCount')}
                </div>
                <div className="text-2xl font-bold text-red-600 dark:text-red-400">{formatNumber(summary.overdueCount, locale)}</div>
              </div>
              <div className="rounded-xl border border-border bg-[var(--color-surface-1)] p-4">
                <div className="flex items-center gap-2 text-[var(--color-text-secondary)] text-sm mb-1">
                  <TrendingDown size={16} />
                  {t('mrrAtRisk')}
                </div>
                <div className="text-2xl font-bold text-[var(--color-text-primary)]">{formatAmount(summary.mrrAtRisk, locale)} {tCommon('egp')}</div>
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="flex flex-wrap gap-2 mb-4">
            {(['all', 'this_week', 'this_month', 'overdue'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-badge text-xs font-medium transition-all duration-fast ease-out ${
                  filter === f
                    ? 'bg-[var(--color-brand-500)] text-white'
                    : 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)] border border-[var(--color-border-default)]'
                }`}
              >
                {f === 'all' ? t('filterAll') : f === 'this_week' ? t('filterThisWeek') : f === 'this_month' ? t('filterThisMonth') : t('filterOverdue')}
              </button>
            ))}
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="animate-spin text-[var(--color-text-secondary)]" size={24} />
            </div>
          ) : centers.length === 0 ? (
            <div className="text-center py-16 text-[var(--color-text-muted)]">{t('noRenewals')}</div>
          ) : (
            <div className="rounded-xl border border-border bg-[var(--color-surface-1)] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="text-start p-3 font-medium">{t('name')}</th>
                      <th className="text-start p-3 font-medium">{t('renewalDate')}</th>
                      <th className="text-start p-3 font-medium">{t('daysRemaining')}</th>
                      <th className="text-start p-3 font-medium">{t('monthlyFee')}</th>
                      <th className="text-start p-3 font-medium">{t('status')}</th>
                      <th className="text-end p-3 font-medium">{t('actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {centers.map((row) => (
                      <tr key={row.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                        <td className="p-3 font-medium">{row.name}</td>
                        <td className="p-3">{formatRenewalDate(row.renewalDate, locale)}</td>
                        <td className="p-3">
                          {row.daysUntil >= 0 ? (
                            <span className="text-green-600 dark:text-green-400">{formatNumber(row.daysUntil, locale)} {t('daysRemaining')}</span>
                          ) : (
                            <span className="text-red-600 dark:text-red-400">{formatNumber(Math.abs(row.daysUntil), locale)} {t('daysOverdue')}</span>
                          )}
                        </td>
                        <td className="p-3">{formatAmount(row.subscription_monthly_fee, locale)} {tCommon('egp')}</td>
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[row.subscription_status ?? 'active'] ?? STATUS_STYLES.active}`}>
                            {subscriptionStatusLabel(row.subscription_status, tStatus)}
                          </span>
                        </td>
                        <td className="p-3 text-end">
                          <button
                            onClick={() => {
                              setRecordModal(row);
                              setRecordAmount(String(row.subscription_monthly_fee ?? ''));
                            }}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 text-sm font-medium"
                          >
                            <CreditCard size={14} />
                            {t('recordPayment')}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <button
            onClick={loadData}
            className="mt-4 flex items-center gap-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            {t('refresh')}
          </button>
        </div>
      </main>
      </div>

      {/* Record Payment Modal */}
      {recordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-[var(--color-surface-1)] rounded-xl shadow-xl max-w-md w-full p-6 border border-border">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-lg">{t('recordPayment')} - {recordModal.name}</h3>
              <button onClick={() => setRecordModal(null)} className="p-1 rounded hover:bg-muted">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">{tCommon('amount')} ({tCommon('egp')})</label>
                <input
                  type="number"
                  value={recordAmount}
                  onChange={(e) => setRecordAmount(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-input bg-[var(--color-surface-0)]"
                  placeholder="0"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t('paymentMethod')}</label>
                <select
                  value={recordMethod}
                  onChange={(e) => setRecordMethod(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-input bg-[var(--color-surface-0)]"
                >
                  <option value="bank_transfer">تحويل بنكي</option>
                  <option value="cash">نقدي</option>
                  <option value="instapay">Instapay</option>
                  <option value="other">أخرى</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t('notes')}</label>
                <input
                  type="text"
                  value={recordNotes}
                  onChange={(e) => setRecordNotes(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-input bg-[var(--color-surface-0)]"
                  placeholder=""
                />
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button
                onClick={() => setRecordModal(null)}
                className="flex-1 px-4 py-2 rounded-lg border border-border hover:bg-muted"
              >
                {tCommon('cancel')}
              </button>
              <button
                onClick={handleRecordPayment}
                disabled={submitting || !recordAmount || parseFloat(recordAmount) <= 0}
                className="flex-1 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {submitting ? tCommon('loading') : tCommon('save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
