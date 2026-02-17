'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/contexts/UserContext';
import { Link } from '@/i18n/routing';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
} from 'recharts';
import PasswordConfirmModal from '@/components/PasswordConfirmModal';

const SENSITIVE_PAYMENT_THRESHOLD = 50_000;

type TabId = 'overview' | 'kpi' | 'centers' | 'billing' | 'plan-requests' | 'pending' | 'team' | 'security';

interface OverviewStats {
  totalCenters: number;
  activeCenters: number;
  suspendedCenters: number;
  totalStudents: number;
  mrr: number;
  byPlan: Record<string, number>;
  mrrByPlan?: Record<string, number>;
  arpuByPlan?: Record<string, number>;
  upgradeOpportunities?: { id: string; name: string; plan: string; students: number; limit: number; pct: number }[];
  signupsChart: { date: string; count: number }[];
}

interface CenterRow {
  id: string;
  name: string;
  phone?: string;
  email?: string | null;
  plan?: string;
  status?: string;
  created_at: string;
  students_count: number;
  owner?: { name?: string; phone?: string } | null;
  last_payment?: string | null;
  next_due?: string | null;
  billing_period?: string;
  billing_status?: string;
  referral_code?: string | null;
  referred_by?: string | null;
  referral_code_used?: string | null;
  referring_center_name?: string | null;
  is_early_adopter?: boolean;
  weekly_unique_students?: number;
  max_students?: number;
  limit_status?: string;
}

interface PlanRequestRow {
  id: string;
  center_id: string;
  centerName: string;
  current_plan?: string;
  requested_plan: string;
  status: string;
  requested_at: string;
  priceDiffFormatted?: string;
  priceDiff?: number;
}

interface BillingCenter {
  id: string;
  name: string;
  plan: string;
  phone?: string;
  billing_period?: string;
  next_payment_due?: string;
  next_billing_date?: string;
  amount?: number;
  monthlyEquivalent?: number;
  discount?: number;
  nextDue?: string;
  billing_status?: string;
  status?: string;
}

interface PaymentRecord {
  id: string;
  center_id: string;
  centerName: string;
  amount: number;
  billing_period: string;
  period_start?: string;
  period_end?: string;
  paid_at: string;
  recorded_by?: string;
  source?: 'admin_payment' | 'invoice';
  invoiceStatus?: string;
}

const PLAN_LABELS: Record<string, string> = {
  starter: 'Starter',
  pro: 'Pro',
  business: 'Business',
  enterprise: 'Enterprise',
  top_centers: 'Top Centers',
  payg: 'PAYG',
};
function formatTimeAgo(d: Date): string {
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return 'Just now';
  if (sec < 3600) return `${Math.floor(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} hour ago`;
  if (sec < 604800) return `${Math.floor(sec / 86400)} days ago`;
  return d.toLocaleDateString();
}

function formatActivitySummary(action: string, details?: unknown): string {
  const d = details as Record<string, unknown> | undefined;
  if (action === 'center_create') return 'New signup';
  if (action === 'admin_invoice_approved') return 'Payment proof approved';
  if (action === 'admin_invoice_rejected') return 'Payment proof rejected';
  if (action === 'payment_on_scan' && d?.method) return `Payment (${d.method})`;
  if (action === 'admin_payment_recorded') return 'Admin payment recorded';
  return action?.replace(/_/g, ' ') ?? '';
}

const BILLING_LABELS: Record<string, string> = {
  monthly: 'monthly',
  quarterly: 'quarterly',
  semi_annual: 'Semi-Annual',
  half_yearly: 'Semi-Annual',
  annual: 'Annual',
  yearly: 'Annual',
};

function getCenterDueDisplay(
  center: CenterRow,
  t: (key: string) => string
): { nextDueText: string; daysText: string; dueColor: string } {
  if (center.status === 'pending') {
    return { nextDueText: '—', daysText: '—', dueColor: 'text-text-secondary' };
  }
  if (center.status === 'suspended') {
    return { nextDueText: t('suspended'), daysText: t('suspended'), dueColor: 'text-red-500 dark:text-red-400 font-bold' };
  }
  const hasPaid = center.billing_status === 'paid' || !!center.last_payment;
  const nextDue = center.next_due;
  if (!nextDue || !hasPaid) {
    return { nextDueText: t('awaitingPayment'), daysText: t('awaitingPayment'), dueColor: 'text-amber-600 dark:text-amber-400' };
  }
  const days = Math.ceil((new Date(nextDue).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  const dateStr = new Date(nextDue).toLocaleDateString();
  if (days <= 0) {
    return { nextDueText: dateStr, daysText: `${Math.abs(days)} ${t('overdue')}`, dueColor: 'text-red-600 dark:text-red-400 font-bold' };
  }
  if (days <= 5) {
    return { nextDueText: dateStr, daysText: String(days), dueColor: 'text-red-600 dark:text-red-400' };
  }
  if (days <= 14) {
    return { nextDueText: dateStr, daysText: String(days), dueColor: 'text-amber-600 dark:text-amber-400' };
  }
  return { nextDueText: dateStr, daysText: String(days), dueColor: 'text-green-600 dark:text-green-400' };
}

function getBillingDueDisplay(
  center: BillingCenter,
  t: (key: string) => string
): { nextDueText: string; daysText: string; dueColor: string; statusDisplay: 'overdue' | 'due_soon' | 'paid' | 'suspended' | 'awaiting' } {
  if (center.status === 'suspended') {
    return { nextDueText: t('suspended'), daysText: t('suspended'), dueColor: 'text-red-500 dark:text-red-400 font-bold', statusDisplay: 'suspended' };
  }
  const nextDue = center.nextDue || center.next_payment_due || center.next_billing_date;
  const hasPaid = center.billing_status === 'paid';
  if (!nextDue || !hasPaid) {
    return { nextDueText: t('awaitingPayment'), daysText: t('awaitingPayment'), dueColor: 'text-amber-600 dark:text-amber-400', statusDisplay: 'awaiting' };
  }
  const days = Math.ceil((new Date(nextDue).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  const dateStr = new Date(nextDue).toLocaleDateString();
  if (days <= 0) {
    return { nextDueText: dateStr, daysText: `${Math.abs(days)} ${t('overdue')}`, dueColor: 'text-red-600 dark:text-red-400 font-bold', statusDisplay: 'overdue' };
  }
  if (days <= 5) {
    return { nextDueText: dateStr, daysText: String(days), dueColor: 'text-red-600 dark:text-red-400', statusDisplay: 'due_soon' };
  }
  return { nextDueText: dateStr, daysText: String(days), dueColor: days <= 14 ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400', statusDisplay: 'paid' };
}

const PLAN_PRICE: Record<string, number> = {
  starter: 2000,
  pro: 4500,
  business: 6500,
  enterprise: 9000,
  top_centers: 0,
  payg: 0,
};

export default function AdminPage() {
  const t = useTranslations('admin');
  const locale = useLocale();
  const isRTL = locale === 'ar';
  const router = useRouter();
  const { user } = useUser();
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const [centers, setCenters] = useState<CenterRow[]>([]);
  const [pendingCenters, setPendingCenters] = useState<CenterRow[]>([]);
  const [planRequests, setPlanRequests] = useState<PlanRequestRow[]>([]);
  const [billingCenters, setBillingCenters] = useState<BillingCenter[]>([]);
  const [paymentHistory, setPaymentHistory] = useState<PaymentRecord[]>([]);
  const [pendingInvoices, setPendingInvoices] = useState<{ id: string; center_id: string; centerName: string; payment_amount: number; payment_reference?: string; payment_proof_url?: string; payment_method?: string; centerStatus?: string; centerPlan?: string; centerBillingPeriod?: string; created_at: string; invoice_number?: string }[]>([]);
  const [billingStats, setBillingStats] = useState<{ mrrByPlan: Record<string, number>; totalMRR: number; fixedMRR: number; paygMRR: number; revenueProjection: number } | null>(null);

  const [statusFilter, setStatusFilter] = useState('all');
  const [planFilter, setPlanFilter] = useState('all');
  const [billingPlanFilter, setBillingPlanFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'next_payment_due' | 'students_count' | 'created_at'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [actionCenterId, setActionCenterId] = useState<string | null>(null);
  const [detailCenter, setDetailCenter] = useState<CenterRow | null>(null);
  const [changePlanCenter, setChangePlanCenter] = useState<CenterRow | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ center: CenterRow; name: string; password: string } | null>(null);
  const [markPaidCenter, setMarkPaidCenter] = useState<BillingCenter | null>(null);

  const [selectedCenterIds, setSelectedCenterIds] = useState<Set<string>>(new Set());
  const [bulkUpgrading, setBulkUpgrading] = useState(false);
  const [internalTeam, setInternalTeam] = useState<{ id: string; name: string; email: string; role: string; phone?: string; created_at: string }[]>([]);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePhone, setInvitePhone] = useState('');
  const [inviteRole, setInviteRole] = useState<'internal_admin' | 'internal_viewer'>('internal_admin');
  const [inviting, setInviting] = useState(false);
  const [internalRole, setInternalRole] = useState<string>('internal_viewer');

  const [passwordConfirm, setPasswordConfirm] = useState<
    | { type: 'suspend'; center: { id: string; name: string } }
    | { type: 'approve_invoice'; inv: { id: string; centerName: string; payment_amount: number } }
    | { type: 'change_role'; memberId: string; newRole: string; prevRole: string }
    | null
  >(null);
  const [passwordError, setPasswordError] = useState('');
  const [passwordConfirmLoading, setPasswordConfirmLoading] = useState(false);

  const [securityData, setSecurityData] = useState<{
    recentLogs: Array<{
      id: string;
      action: string;
      details: Record<string, unknown>;
      created_at: string;
      user?: { name?: string | null; phone?: string } | null;
      center?: { name?: string } | null;
    }>;
    actionStats: Record<string, number>;
    centerStats: Record<string, number>;
  }>({
    recentLogs: [],
    actionStats: {},
    centerStats: {},
  });

  const getSession = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session;
  }, []);

  const getAuthHeaders = useCallback(async (includeCsrf = true) => {
    const session = await getSession();
    if (!session) return null;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    };
    if (includeCsrf) {
      const { getCsrfHeaders } = await import('@/lib/csrf-client');
      Object.assign(headers, await getCsrfHeaders(session.access_token));
    }
    return headers;
  }, [getSession]);

  const loadOverview = useCallback(async () => {
    console.log('🔍 Admin Overview: Fetching...');
    const session = await getSession();
    if (!session) {
      console.log('❌ Admin Overview: No session, redirecting to login');
      router.replace('/login');
      return;
    }
    setIsLoading(true);
    setLoadError(null);
    try {
      console.log('📡 Admin Overview: Fetching /api/admin/overview...');
      const res = await fetch('/api/admin/overview', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      console.log('📡 Admin Overview: Response status', res.status, res.statusText);
      if (res.status === 403) {
        console.log('❌ Admin Overview: Forbidden (403)');
        setIsAuthorized(false);
        setLoadError('Access denied');
        router.replace('/dashboard');
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        console.log('✅ Admin Overview: Data received:', {
          totalCenters: data.totalCenters,
          activeCenters: data.activeCenters,
          mrr: data.mrr,
          internalRole: data.internalRole,
        });
        setOverview(data);
        if (data.internalRole) setInternalRole(data.internalRole);
        setIsAuthorized(true);
      } else {
        console.error('❌ Admin Overview: Error response:', data);
        setLoadError(data.error || `Request failed (${res.status})`);
        setIsAuthorized(false);
      }
    } catch (err) {
      console.error('❌ Admin Overview: Fetch error:', err);
      setLoadError(err instanceof Error ? err.message : 'Network error');
      setIsAuthorized(false);
    } finally {
      setIsLoading(false);
    }
  }, [getSession, router]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const fetchCenters = useCallback(async () => {
    console.log('🔍 [Centers Tab] Loading centers...');
    const session = await getSession();
    if (!session) {
      console.warn('⚠️ [Centers Tab] No session - cannot fetch centers');
      return;
    }
    const params = new URLSearchParams();
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (planFilter !== 'all') params.set('plan', planFilter);
    if (searchQuery.trim()) params.set('search', searchQuery.trim());
    const url = `/api/admin/centers?${params}`;
    console.log('📡 [Centers Tab] Fetching:', url);
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      console.log('📡 [Centers Tab] Response status:', res.status);

      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        console.log('✅ [Centers Tab] Data received:', data);
        if (data.centers && Array.isArray(data.centers)) {
          console.log(`📊 [Centers Tab] Loaded ${data.centers.length} centers`);
          setCenters(data.centers);
          setPendingCenters(data.pendingCenters || []);
        } else {
          console.warn('⚠️ [Centers Tab] No centers array in response:', data);
          setCenters([]);
          setPendingCenters([]);
        }
      } else {
        console.error('❌ [Centers Tab] Error response:', res.status, data);
        setCenters([]);
        setPendingCenters([]);
      }
    } catch (error) {
      console.error('❌ [Centers Tab] Load error:', error);
      setCenters([]);
      setPendingCenters([]);
    }
  }, [getSession, statusFilter, planFilter, searchQuery]);

  const fetchPlanRequests = useCallback(async () => {
    const session = await getSession();
    if (!session) return;
    const res = await fetch('/api/admin/plan-requests', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setPlanRequests(data.requests || []);
    }
  }, [getSession]);

  const fetchBilling = useCallback(async () => {
    const session = await getSession();
    if (!session) return;
    const params = new URLSearchParams();
    if (billingPlanFilter !== 'all') params.set('plan', billingPlanFilter);
    const res = await fetch(`/api/admin/billing?${params}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setBillingCenters(data.centers || []);
      setPaymentHistory(data.paymentHistory || []);
      setPendingInvoices(data.pendingInvoices || []);
      setBillingStats(data.totalMRR != null ? {
        mrrByPlan: data.mrrByPlan || {},
        totalMRR: data.totalMRR ?? 0,
        fixedMRR: data.fixedMRR ?? 0,
        paygMRR: data.paygMRR ?? 0,
        revenueProjection: data.revenueProjection ?? 0,
      } : null);
    }
  }, [getSession, billingPlanFilter]);

  const fetchInternalTeam = useCallback(async () => {
    const session = await getSession();
    if (!session) return;
    const res = await fetch('/api/admin/team', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setInternalTeam(data.team || []);
    }
  }, [getSession]);

  const fetchPendingSignups = useCallback(async () => {
    console.log('🔍 [Pending Signups] Loading...');
    const session = await getSession();
    if (!session) {
      console.log('⚠️ [Pending Signups] No session');
      return;
    }
    try {
      const res = await fetch('/api/admin/pending-signups', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      console.log('📡 [Pending Signups] Response status:', res.status);
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.signups)) {
        setPendingCenters(data.signups);
        console.log('📊 [Pending Signups] Loaded', data.signups.length, 'pending centers');
      } else {
        console.warn('⚠️ [Pending Signups] No signups array in response:', data);
        setPendingCenters([]);
      }
    } catch (error) {
      console.error('❌ [Pending Signups] Error:', error);
      setPendingCenters([]);
    }
  }, [getSession]);

  useEffect(() => {
    if (activeTab === 'centers') fetchCenters();
  }, [activeTab, fetchCenters]);

  useEffect(() => {
    if (activeTab === 'pending') fetchPendingSignups();
  }, [activeTab, fetchPendingSignups]);

  useEffect(() => {
    if (activeTab === 'plan-requests') fetchPlanRequests();
  }, [activeTab, fetchPlanRequests]);

  useEffect(() => {
    if (activeTab === 'billing') fetchBilling();
  }, [activeTab, fetchBilling]);

  useEffect(() => {
    if (activeTab === 'team') fetchInternalTeam();
  }, [activeTab, fetchInternalTeam]);

  const fetchSecurityData = useCallback(async () => {
    const session = await getSession();
    if (!session) return;
    try {
      const res = await fetch('/api/admin/security', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setSecurityData({
          recentLogs: data.recentLogs || [],
          actionStats: data.actionStats || {},
          centerStats: data.centerStats || {},
        });
      }
    } catch {
      setSecurityData({ recentLogs: [], actionStats: {}, centerStats: {} });
    }
  }, [getSession]);

  useEffect(() => {
    if (activeTab === 'security') fetchSecurityData();
  }, [activeTab, fetchSecurityData]);

  const exportAuditLog = async () => {
    const session = await getSession();
    if (!session) return;
    try {
      const res = await fetch('/api/admin/security?export=csv', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Export failed');
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      alert('Export failed');
    }
  };

  const sortedCenters = useMemo(() => {
    const arr = [...centers];
    return arr.sort((a, b) => {
      if (sortBy === 'next_payment_due') {
        const dateA = a.next_due ? new Date(a.next_due).getTime() : Number.MAX_SAFE_INTEGER;
        const dateB = b.next_due ? new Date(b.next_due).getTime() : Number.MAX_SAFE_INTEGER;
        return sortDir === 'asc' ? dateA - dateB : dateB - dateA;
      }
      if (sortBy === 'students_count') {
        return sortDir === 'asc' ? (a.students_count - b.students_count) : (b.students_count - a.students_count);
      }
      if (sortBy === 'created_at') {
        const tA = new Date(a.created_at).getTime();
        const tB = new Date(b.created_at).getTime();
        return sortDir === 'asc' ? tA - tB : tB - tA;
      }
      // name
      const nameA = (a.name || '').toLowerCase();
      const nameB = (b.name || '').toLowerCase();
      return sortDir === 'asc' ? nameA.localeCompare(nameB) : nameB.localeCompare(nameA);
    });
  }, [centers, sortBy, sortDir]);

  const handleCenterAction = async (
    centerId: string,
    action: string,
    extra?: { newPlan?: string; confirmName?: string; password?: string }
  ) => {
    const headers = await getAuthHeaders();
    if (!headers) return;
    setActionCenterId(centerId);
    try {
      const body: Record<string, unknown> = { centerId, action };
      if (extra?.newPlan) body.newPlan = extra.newPlan;
      if (extra?.confirmName) body.confirmName = extra.confirmName;
      if (extra?.password) body.password = extra.password;
      const res = await fetch('/api/admin/centers', {
        method: 'PUT',
        headers,
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        setChangePlanCenter(null);
        setDeleteConfirm(null);
        setDetailCenter(null);
        fetchCenters();
        if (activeTab === 'overview' && overview) {
          const oHeaders = await getAuthHeaders(false);
          if (oHeaders) {
            const oRes = await fetch('/api/admin/overview', { headers: oHeaders });
            if (oRes.ok) setOverview(await oRes.json());
          }
        }
      } else {
        alert(data.error || 'Failed');
      }
    } catch {
      alert('Network error');
    } finally {
      setActionCenterId(null);
    }
  };

  const handlePlanRequestAction = async (requestId: string, action: 'approve' | 'reject') => {
    const headers = await getAuthHeaders();
    if (!headers) return;
    setActionCenterId(requestId);
    try {
      const res = await fetch('/api/admin/plan-requests', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ requestId, action }),
      });
      const data = await res.json();
      if (res.ok) {
        fetchPlanRequests();
        if (action === 'approve' && data.whatsappLink) {
          window.open(data.whatsappLink, '_blank', 'noopener');
        }
      } else {
        alert(data.error || 'Failed');
      }
    } catch {
      alert('Network error');
    } finally {
      setActionCenterId(null);
    }
  };

  const handleInvoiceAction = async (invoiceId: string, action: 'approve' | 'reject', password?: string) => {
    const headers = await getAuthHeaders();
    if (!headers) return;
    setActionCenterId(invoiceId);
    try {
      const body: Record<string, unknown> = { invoiceId, action };
      if (password) body.password = password;
      const res = await fetch('/api/admin/billing', {
        method: 'PUT',
        headers,
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setPendingInvoices((prev) => prev.filter((i) => i.id !== invoiceId));
        fetchBilling();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed');
      }
    } catch {
      alert('Network error');
    } finally {
      setActionCenterId(null);
    }
  };

  const handleMarkPaid = async (center: BillingCenter) => {
    const headers = await getAuthHeaders();
    if (!headers) return;
    const amount = center.amount ?? PLAN_PRICE[center.plan] ?? 2000;
    const bp = center.billing_period || 'monthly';
    setActionCenterId(center.id);
    try {
      const res = await fetch('/api/admin/billing', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          center_id: center.id,
          amount,
          billing_period: bp === 'half_yearly' ? 'semi_annual' : bp === 'yearly' ? 'annual' : bp,
        }),
      });
      if (res.ok) {
        setMarkPaidCenter(null);
        fetchBilling();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed');
      }
    } catch {
      alert('Network error');
    } finally {
      setActionCenterId(null);
    }
  };

  const handleApprove = async (centerId: string) => {
    const headers = await getAuthHeaders();
    if (!headers) return;
    setActionCenterId(centerId);
    try {
      const res = await fetch('/api/admin/centers', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ centerId, action: 'approve' }),
      });
      const data = await res.json();
      if (res.ok) {
        setPendingCenters((prev) => prev.filter((c) => c.id !== centerId));
        fetchCenters();
        if (data.referralMessage) alert(data.referralMessage);
      } else {
        alert(data.error || 'Failed');
      }
    } catch {
      alert('Network error');
    } finally {
      setActionCenterId(null);
    }
  };

  const handleReject = async (centerId: string) => {
    if (!confirm(t('confirmReject'))) return;
    const headers = await getAuthHeaders();
    if (!headers) return;
    setActionCenterId(centerId);
    try {
      const res = await fetch('/api/admin/centers', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ centerId, action: 'reject' }),
      });
      if (res.ok) {
        setPendingCenters((prev) => prev.filter((c) => c.id !== centerId));
      } else {
        const data = await res.json();
        alert(data.error || 'Failed');
      }
    } catch {
      alert('Network error');
    } finally {
      setActionCenterId(null);
    }
  };

  const openWhatsAppReminder = (center: BillingCenter) => {
    const amount = center.amount ?? PLAN_PRICE[center.plan] ?? 2000;
    const phone = (center.phone || '').replace(/\D/g, '').replace(/^0/, '');
    const text = encodeURIComponent(
      `مرحباً، هذا تذكير بموعد سداد اشتراك CenterHQ. المبلغ المطلوب: ${amount} جنيه. شكراً لتعاونكم.`
    );
    window.open(`https://wa.me/2${phone}?text=${text}`, '_blank');
  };

  const handleInviteInternal = async () => {
    if (!inviteName.trim() || !invitePhone.trim()) return;
    const headers = await getAuthHeaders();
    if (!headers) return;
    setInviting(true);
    try {
      const res = await fetch('/api/admin/team', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: inviteName.trim(), email: inviteEmail.trim(), phone: invitePhone.trim(), role: inviteRole }),
      });
      if (res.ok) {
        setInviteName('');
        setInviteEmail('');
        setInvitePhone('');
        fetchInternalTeam();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to invite');
      }
    } catch {
      alert('Network error');
    } finally {
      setInviting(false);
    }
  };

  const handleRemoveInternal = async (memberId: string) => {
    if (!confirm(t('confirmRemoveTeamMember', { defaultValue: 'Remove this team member?' }))) return;
    const headers = await getAuthHeaders();
    if (!headers) return;
    try {
      const res = await fetch('/api/admin/team', {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ memberId }),
      });
      if (res.ok) fetchInternalTeam();
      else {
        const data = await res.json();
        alert(data.error || 'Failed');
      }
    } catch {
      alert('Network error');
    }
  };

  const handleChangeInternalRole = async (memberId: string, newRole: string, password?: string) => {
    const headers = await getAuthHeaders();
    if (!headers) return;
    try {
      const body: Record<string, unknown> = { memberId, role: newRole };
      if (password) body.password = password;
      const res = await fetch('/api/admin/team', {
        method: 'PUT',
        headers,
        body: JSON.stringify(body),
      });
      if (res.ok) fetchInternalTeam();
      else {
        const data = await res.json();
        alert(data.error || 'Failed');
      }
    } catch {
      alert('Network error');
    }
  };

  if (isLoading && isAuthorized === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-indigo-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (loadError && !isAuthorized) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <p className="text-red-600 dark:text-red-400 font-medium mb-2">
            {t('loadError', { defaultValue: 'Failed to load admin data' })}
          </p>
          <p className="text-sm text-[var(--text-secondary)] mb-4">{loadError}</p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => loadOverview()}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
            >
              {t('retry', { defaultValue: 'Retry' })}
            </button>
            <Link
              href="/dashboard"
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-bg-secondary"
            >
              {t('backToMyCenter')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const allTabs: { id: TabId; labelKey: string; roles: string[] }[] = [
    { id: 'overview', labelKey: 'overview', roles: ['super_admin', 'internal_admin', 'internal_viewer'] },
    { id: 'kpi', labelKey: 'kpiDashboard', roles: ['super_admin'] },
    { id: 'centers', labelKey: 'centers', roles: ['super_admin', 'internal_admin', 'internal_viewer'] },
    { id: 'billing', labelKey: 'billing', roles: ['super_admin', 'internal_admin'] },
    { id: 'plan-requests', labelKey: 'planRequests', roles: ['super_admin', 'internal_admin'] },
    { id: 'pending', labelKey: 'pendingSignups', roles: ['super_admin', 'internal_admin'] },
    { id: 'team', labelKey: 'internalTeam', roles: ['super_admin'] },
    { id: 'security', labelKey: 'security', roles: ['super_admin', 'internal_admin'] },
  ];
  const tabs = allTabs.filter(tab => tab.roles.includes(internalRole));

  const pendingPaymentProofs = useMemo(
    () => pendingInvoices.filter((inv) => inv.centerStatus === 'suspended' && inv.payment_proof_url),
    [pendingInvoices]
  );

  const byPlanData = overview
    ? Object.entries(overview.byPlan || {}).map(([plan, count]) => ({ name: PLAN_LABELS[plan] || plan, count }))
    : [];
  const mrrByPlanData = overview?.mrrByPlan
    ? Object.entries(overview.mrrByPlan)
        .filter(([, amt]) => amt > 0)
        .map(([plan, amount]) => ({ name: PLAN_LABELS[plan] || plan, amount }))
    : [];

  return (
    <>
    <div className="min-h-screen" dir={isRTL ? 'rtl' : 'ltr'}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {/* Top bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
            <h1 className="text-2xl font-bold text-[var(--text-primary)]">{t('title')}</h1>
            <div className="flex items-center gap-4">
              {user?.name && <span className="text-sm text-[var(--text-secondary)]">{user.name}</span>}
              {user?.center_id && (
                <Link
                  href="/dashboard"
                  className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  {t('backToMyCenter')}
                </Link>
              )}
            </div>
          </div>

          {/* Tabs */}
          <div className="flex overflow-x-auto gap-1 pb-4 border-b border-gray-200 dark:border-gray-700 mb-6">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-shrink-0 px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                  activeTab === tab.id
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white/5 text-[var(--text-primary)] hover:bg-white/10'
                }`}
              >
                {t(tab.labelKey)}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {activeTab === 'overview' && !overview && (
            <div className="py-8 text-center text-[var(--text-secondary)]">
              <p>{t('loadingOverview', { defaultValue: 'Loading overview data...' })}</p>
              <button
                onClick={() => loadOverview()}
                className="mt-2 text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                {t('retry', { defaultValue: 'Retry' })}
              </button>
            </div>
          )}
          {activeTab === 'overview' && overview && (
            <div className="space-y-6">
              {/* Action Required */}
              <div>
                <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">{t('actionRequired')}</h2>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <button
                    onClick={() => setActiveTab('pending')}
                    className={`p-4 rounded-xl shadow text-left transition-all border-2 ${
                      ((overview as { pendingSignupsCount?: number }).pendingSignupsCount ?? 0) > 0
                        ? 'border-amber-500 bg-amber-500/10'
                        : 'border-green-500 bg-green-500/10'
                    }`}
                  >
                    <span className="text-2xl">🔔</span>
                    <p className="text-sm text-[var(--text-secondary)] mt-1">{t('pendingSignupsCount')}</p>
                    <p className={`text-3xl font-bold ${((overview as { pendingSignupsCount?: number }).pendingSignupsCount ?? 0) > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-green-700 dark:text-green-400'}`}>
                      {((overview as { pendingSignupsCount?: number }).pendingSignupsCount ?? 0) > 0 ? (overview as { pendingSignupsCount?: number }).pendingSignupsCount : '✓'}
                    </p>
                    <p className="text-xs text-indigo-600 dark:text-indigo-400 mt-1">{t('view')} →</p>
                  </button>
                  <button
                    onClick={() => setActiveTab('plan-requests')}
                    className={`p-4 rounded-xl shadow text-left transition-all border-2 ${
                      ((overview as { pendingPlanRequestsCount?: number }).pendingPlanRequestsCount ?? 0) > 0
                        ? 'border-amber-500 bg-amber-500/10'
                        : 'border-green-500 bg-green-500/10'
                    }`}
                  >
                    <span className="text-2xl">📋</span>
                    <p className="text-sm text-[var(--text-secondary)] mt-1">{t('planRequestsCount')}</p>
                    <p className={`text-3xl font-bold ${((overview as { pendingPlanRequestsCount?: number }).pendingPlanRequestsCount ?? 0) > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-green-700 dark:text-green-400'}`}>
                      {((overview as { pendingPlanRequestsCount?: number }).pendingPlanRequestsCount ?? 0) > 0 ? (overview as { pendingPlanRequestsCount?: number }).pendingPlanRequestsCount : '✓'}
                    </p>
                    <p className="text-xs text-indigo-600 dark:text-indigo-400 mt-1">{t('view')} →</p>
                  </button>
                  <button
                    onClick={() => setActiveTab('billing')}
                    className={`p-4 rounded-xl shadow text-left transition-all border-2 ${
                      ((overview as { pendingPaymentProofsCount?: number }).pendingPaymentProofsCount ?? 0) > 0
                        ? 'border-amber-500 bg-amber-500/10'
                        : 'border-green-500 bg-green-500/10'
                    }`}
                  >
                    <span className="text-2xl">💳</span>
                    <p className="text-sm text-[var(--text-secondary)] mt-1">{t('paymentProofsCount')}</p>
                    <p className={`text-3xl font-bold ${((overview as { pendingPaymentProofsCount?: number }).pendingPaymentProofsCount ?? 0) > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-green-700 dark:text-green-400'}`}>
                      {((overview as { pendingPaymentProofsCount?: number }).pendingPaymentProofsCount ?? 0) > 0 ? (overview as { pendingPaymentProofsCount?: number }).pendingPaymentProofsCount : '✓'}
                    </p>
                    <p className="text-xs text-indigo-600 dark:text-indigo-400 mt-1">{t('view')} →</p>
                  </button>
                  <button
                    onClick={() => setActiveTab('billing')}
                    className={`p-4 rounded-xl shadow text-left transition-all border-2 ${
                      ((overview as { overdueCentersCount?: number }).overdueCentersCount ?? 0) > 0
                        ? 'border-red-500 bg-red-500/10'
                        : 'border-green-500 bg-green-500/10'
                    }`}
                  >
                    <span className="text-2xl">⚠️</span>
                    <p className="text-sm text-[var(--text-secondary)] mt-1">{t('overdueCentersCount')}</p>
                    <p className={`text-3xl font-bold ${((overview as { overdueCentersCount?: number }).overdueCentersCount ?? 0) > 0 ? 'text-red-700 dark:text-red-400' : 'text-green-700 dark:text-green-400'}`}>
                      {((overview as { overdueCentersCount?: number }).overdueCentersCount ?? 0) > 0 ? (overview as { overdueCentersCount?: number }).overdueCentersCount : '✓'}
                    </p>
                    <p className="text-xs text-indigo-600 dark:text-indigo-400 mt-1">{t('view')} →</p>
                  </button>
                </div>
                {/* Recent Activity */}
                <div className="mt-6 p-4 glass rounded-xl shadow">
                  <h3 className="text-base font-semibold text-[var(--text-primary)] mb-3">{t('recentActivity')}</h3>
                  {((overview as { recentActivity?: Array<{ action: string; details?: unknown; created_at: string }> }).recentActivity ?? []).length > 0 ? (
                    <ul className="space-y-2 text-sm">
                      {((overview as { recentActivity?: Array<{ action: string; details?: unknown; created_at: string }> }).recentActivity ?? []).slice(0, 10).map((a, i) => {
                        const timeAgo = formatTimeAgo(new Date(a.created_at));
                        const summary = formatActivitySummary(a.action, a.details);
                        return (
                          <li key={i} className="flex justify-between gap-4 text-[var(--text-secondary)]">
                            <span>{timeAgo} — {summary}</span>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="text-sm text-[var(--text-secondary)]">{t('noActivity')}</p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                <div className="glass rounded-xl p-4 shadow">
                  <p className="text-sm text-[var(--text-secondary)]">{t('totalCenters')}</p>
                  <p className="text-2xl font-bold text-[var(--text-primary)]">{overview.totalCenters}</p>
                </div>
                <div className="glass rounded-xl p-4 shadow">
                  <p className="text-sm text-[var(--text-secondary)]">{t('activeCenters')}</p>
                  <p className="text-2xl font-bold text-green-600 dark:text-green-400">{overview.activeCenters}</p>
                </div>
                <div className="glass rounded-xl p-4 shadow">
                  <p className="text-sm text-[var(--text-secondary)]">{t('suspendedCenters')}</p>
                  <p className="text-2xl font-bold text-red-600 dark:text-red-400">{overview.suspendedCenters}</p>
                </div>
                <div className="glass rounded-xl p-4 shadow">
                  <p className="text-sm text-[var(--text-secondary)]">{t('totalStudents')}</p>
                  <p className="text-2xl font-bold text-[var(--text-primary)]">{overview.totalStudents}</p>
                </div>
                <div className="glass rounded-xl p-4 shadow">
                  <p className="text-sm text-[var(--text-secondary)]">{t('mrr')}</p>
                  <p className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
                    {overview.mrr?.toLocaleString('ar-EG')} EGP
                  </p>
                </div>
              </div>
              {/* Upgrade Opportunities & ARPU by Plan */}
              {(overview.upgradeOpportunities?.length ?? 0) > 0 && (
                <div className="glass rounded-xl p-6 shadow">
                  <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-3">{t('upgradeOpportunities', { defaultValue: 'Upgrade Opportunities' })}</h3>
                  <p className="text-sm text-[var(--text-secondary)] mb-3">{t('centersNearCapacity', { defaultValue: 'Centers approaching plan limits (80%+ capacity)' })}</p>
                  <ul className="space-y-2">
                    {(overview.upgradeOpportunities ?? []).slice(0, 5).map((u) => (
                      <li key={u.id} className="flex justify-between items-center text-sm">
                        <span className="text-[var(--text-primary)]">{u.name}</span>
                        <span className="text-amber-600 dark:text-amber-400 font-medium">{u.students}/{u.limit} ({u.pct}%)</span>
                        <button onClick={() => { setActiveTab('centers'); setPlanFilter(u.plan); }} className="text-indigo-600 dark:text-indigo-400 hover:underline text-xs">
                          {t('view')} →
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button onClick={() => setActiveTab('centers')} className="mt-3 text-sm text-indigo-600 dark:text-indigo-400 hover:underline">
                    {t('viewAllCenters')} →
                  </button>
                </div>
              )}
              {overview?.arpuByPlan && Object.keys(overview.arpuByPlan).some((k) => (overview.arpuByPlan![k] ?? 0) > 0) && (
                <div className="glass rounded-xl p-6 shadow">
                  <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-3">{t('arpuByPlan', { defaultValue: 'ARPU by Plan' })}</h3>
                  <p className="text-sm text-[var(--text-secondary)] mb-3">{t('avgRevenuePerUser', { defaultValue: 'Average revenue per user (center) by plan tier' })}</p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(overview.arpuByPlan)
                      .filter(([, amt]) => amt > 0)
                      .map(([plan, amt]) => (
                        <span key={plan} className="px-3 py-1.5 text-sm font-medium rounded-lg bg-indigo-100 dark:bg-indigo-900/50 text-indigo-800 dark:text-indigo-300">
                          {PLAN_LABELS[plan] || plan}: {amt.toLocaleString('ar-EG')} EGP
                        </span>
                      ))}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="glass rounded-xl p-6 shadow">
                  <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">{t('byPlan')}</h3>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={byPlanData}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-600" />
                        <XAxis dataKey="name" className="text-xs" />
                        <YAxis className="text-xs" />
                        <Tooltip />
                        <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="glass rounded-xl p-6 shadow">
                  <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">{t('mrrByPlan', { defaultValue: 'MRR by Plan' })}</h3>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={mrrByPlanData}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-600" />
                        <XAxis dataKey="name" className="text-xs" />
                        <YAxis className="text-xs" tickFormatter={(v) => `${(Number(v) / 1000).toFixed(0)}K`} />
                        <Tooltip formatter={(value: number | undefined) => [`${Number(value ?? 0).toLocaleString('ar-EG')} EGP`, 'MRR']} />
                        <Bar dataKey="amount" fill="#10b981" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="glass rounded-xl p-6 shadow">
                  <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">{t('signupsChart')}</h3>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={overview.signupsChart || []}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-600" />
                        <XAxis dataKey="date" className="text-xs" tickFormatter={(v) => v.slice(5)} />
                        <YAxis className="text-xs" />
                        <Tooltip />
                        <Line type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'kpi' && overview && (
            <div className="space-y-6">
              <h2 className="text-xl font-bold text-[var(--text-primary)]">{t('kpiDashboard', { defaultValue: 'CEO Dashboard — KPIs' })}</h2>

              {/* Revenue KPIs Row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="glass rounded-xl p-5 shadow border-s-4 border-green-500">
                  <p className="text-sm text-[var(--text-secondary)]">{t('totalRevenueCollected', { defaultValue: 'Total Revenue Collected' })}</p>
                  <p className="text-2xl font-bold text-green-600 dark:text-green-400">{Number((overview as unknown as Record<string, unknown>).totalRevenueCollected || 0).toLocaleString('ar-EG')} EGP</p>
                </div>
                <div className="glass rounded-xl p-5 shadow border-s-4 border-indigo-500">
                  <p className="text-sm text-[var(--text-secondary)]">{t('revenueThisMonth', { defaultValue: 'Revenue This Month' })}</p>
                  <p className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">{Number((overview as unknown as Record<string, unknown>).revenueThisMonth || 0).toLocaleString('ar-EG')} EGP</p>
                  <p className={`text-xs mt-1 ${(Number((overview as unknown as Record<string, unknown>).revenueGrowth) || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {(Number((overview as unknown as Record<string, unknown>).revenueGrowth) || 0) >= 0 ? '↑' : '↓'} {Math.abs(Number((overview as unknown as Record<string, unknown>).revenueGrowth) || 0)}% vs last month
                  </p>
                </div>
                <div className="glass rounded-xl p-5 shadow border-s-4 border-amber-500">
                  <p className="text-sm text-[var(--text-secondary)]">{t('pendingRevenue', { defaultValue: 'Pending Revenue' })}</p>
                  <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{Number((overview as unknown as Record<string, unknown>).pendingRevenue || 0).toLocaleString('ar-EG')} EGP</p>
                </div>
                <div className="glass rounded-xl p-5 shadow border-s-4 border-blue-500">
                  <p className="text-sm text-[var(--text-secondary)]">{t('arpc', { defaultValue: 'Avg Revenue Per Center' })}</p>
                  <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{Number((overview as unknown as Record<string, unknown>).arpc || 0).toLocaleString('ar-EG')} EGP</p>
                </div>
              </div>

              {/* Growth & Health Row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="glass rounded-xl p-5 shadow border-s-4 border-green-500">
                  <p className="text-sm text-[var(--text-secondary)]">{t('activeCenters', { defaultValue: 'Active Centers' })}</p>
                  <p className="text-2xl font-bold text-green-600 dark:text-green-400">{overview.activeCenters}</p>
                </div>
                <div className="glass rounded-xl p-5 shadow border-s-4 border-red-500">
                  <p className="text-sm text-[var(--text-secondary)]">{t('churnRate', { defaultValue: 'Churn Rate' })}</p>
                  <p className="text-2xl font-bold text-red-600 dark:text-red-400">{Number((overview as unknown as Record<string, unknown>).churnRate) || 0}%</p>
                  <p className="text-xs text-text-secondary mt-1">{Number((overview as unknown as Record<string, unknown>).churnedCenters) || 0} {t('centersSuspended', { defaultValue: 'centers suspended' })}</p>
                </div>
                <div className="glass rounded-xl p-5 shadow border-s-4 border-purple-500">
                  <p className="text-sm text-[var(--text-secondary)]">{t('mrr', { defaultValue: 'MRR' })}</p>
                  <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">{(overview.mrr || 0).toLocaleString('ar-EG')} EGP</p>
                </div>
                <div className="glass rounded-xl p-5 shadow border-s-4 border-cyan-500">
                  <p className="text-sm text-[var(--text-secondary)]">{t('totalStudents', { defaultValue: 'Total Students' })}</p>
                  <p className="text-2xl font-bold text-cyan-600 dark:text-cyan-400">{overview.totalStudents}</p>
                </div>
              </div>

              {/* Monthly Revenue Chart */}
              <div className="glass rounded-xl p-6 shadow">
                <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">{t('monthlyRevenueChart', { defaultValue: 'Monthly Revenue (Last 6 Months)' })}</h3>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={(overview as unknown as Record<string, unknown>).monthlyRevenue as { month: string; revenue: number; centers: number }[] || []}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-600" />
                      <XAxis dataKey="month" className="text-xs" />
                      <YAxis className="text-xs" tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} />
                      <Tooltip formatter={(value: number | undefined) => [`${Number(value ?? 0).toLocaleString('ar-EG')} EGP`, 'Revenue']} />
                      <Bar dataKey="revenue" fill="#6366f1" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Revenue vs Plan Distribution */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="glass rounded-xl p-6 shadow">
                  <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">{t('byPlan', { defaultValue: 'Centers by Plan' })}</h3>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={byPlanData}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-600" />
                        <XAxis dataKey="name" className="text-xs" />
                        <YAxis className="text-xs" />
                        <Tooltip />
                        <Bar dataKey="count" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="glass rounded-xl p-6 shadow">
                  <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">{t('signupsChart', { defaultValue: 'Signups Over Time' })}</h3>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={overview.signupsChart || []}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-600" />
                        <XAxis dataKey="date" className="text-xs" tickFormatter={(v) => v.slice(5)} />
                        <YAxis className="text-xs" />
                        <Tooltip />
                        <Line type="monotone" dataKey="count" stroke="#10b981" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* Quick Financial Summary */}
              <div className="glass rounded-xl p-6 shadow">
                <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">{t('financialSummary', { defaultValue: 'Financial Summary' })}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-sm">
                  <div>
                    <p className="text-[var(--text-secondary)] mb-1">{t('annualRunRate', { defaultValue: 'Annual Run Rate (ARR)' })}</p>
                    <p className="text-xl font-bold text-[var(--text-primary)]">{((overview.mrr || 0) * 12).toLocaleString('ar-EG')} EGP</p>
                  </div>
                  <div>
                    <p className="text-[var(--text-secondary)] mb-1">{t('revenueLastMonth', { defaultValue: 'Revenue Last Month' })}</p>
                    <p className="text-xl font-bold text-[var(--text-primary)]">{Number((overview as unknown as Record<string, unknown>).revenueLastMonth || 0).toLocaleString('ar-EG')} EGP</p>
                  </div>
                  <div>
                    <p className="text-[var(--text-secondary)] mb-1">{t('collectionRate', { defaultValue: 'Collection Rate' })}</p>
                    <p className="text-xl font-bold text-[var(--text-primary)]">
                      {(() => {
                        const collected = Number((overview as unknown as Record<string, unknown>).totalRevenueCollected) || 0;
                        const pending = Number((overview as unknown as Record<string, unknown>).pendingRevenue) || 0;
                        const total = collected + pending;
                        return total > 0 ? `${Math.round((collected / total) * 100)}%` : '—';
                      })()}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'centers' && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-4 items-center">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-bg-tertiary text-text-primary text-sm"
                >
                  <option value="all">{t('filterAll')}</option>
                  <option value="active">{t('filterActive')}</option>
                  <option value="suspended">{t('filterSuspended')}</option>
                  <option value="pending">{t('filterPending')}</option>
                </select>
                <select
                  value={planFilter}
                  onChange={(e) => setPlanFilter(e.target.value)}
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-bg-tertiary text-text-primary text-sm"
                >
                  <option value="all">{t('filterAll')}</option>
                  <option value="starter">Starter</option>
                  <option value="pro">Pro</option>
                  <option value="business">Business</option>
                  <option value="enterprise">Enterprise</option>
                  <option value="top_centers">Top Centers</option>
                  <option value="payg">PAYG</option>
                </select>
                <input
                  type="text"
                  placeholder={t('searchPlaceholder')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-bg-tertiary text-text-primary text-sm min-w-[200px]"
                />
                <span className="text-sm text-[var(--text-secondary)]">{t('sortBy')}:</span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-bg-tertiary text-text-primary text-sm"
                >
                  <option value="name">{t('sortName')}</option>
                  <option value="next_payment_due">{t('sortDueDate')}</option>
                  <option value="students_count">{t('sortStudents')}</option>
                  <option value="created_at">{t('sortCreated')}</option>
                </select>
                <button
                  onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-bg-tertiary text-text-primary text-sm"
                >
                  {sortDir === 'asc' ? '↑' : '↓'}
                </button>
                {internalRole === 'super_admin' && (
                  <>
                    <button
                      onClick={() => setSelectedCenterIds(new Set(sortedCenters.filter(c => c.status === 'active').map(c => c.id)))}
                      className="px-3 py-2 text-xs border border-gray-300 dark:border-gray-600 rounded-lg bg-bg-tertiary text-text-primary"
                    >
                      {t('selectAllActive', { defaultValue: 'Select all active' })}
                    </button>
                    <button
                      onClick={() => setSelectedCenterIds(new Set())}
                      className="px-3 py-2 text-xs border border-gray-300 dark:border-gray-600 rounded-lg bg-bg-tertiary text-text-primary"
                    >
                      {t('clearSelection', { defaultValue: 'Clear' })}
                    </button>
                    {selectedCenterIds.size > 0 && (
                      <span className="text-sm text-[var(--text-secondary)]">
                        {selectedCenterIds.size} {t('selected', { defaultValue: 'selected' })}
                        <span className="ml-2 text-indigo-600 dark:text-indigo-400">{t('upgradeTo', { defaultValue: 'Upgrade to' })}:</span>
                        {(['pro', 'business', 'enterprise'] as const).map((plan) => (
                          <button
                            key={plan}
                            onClick={async () => {
                              if (!confirm(t('confirmBulkUpgrade', { defaultValue: `Upgrade ${selectedCenterIds.size} center(s) to ${PLAN_LABELS[plan]}?` }))) return;
                              setBulkUpgrading(true);
                              let done = 0;
                              const headers = await getAuthHeaders();
                              if (!headers) { setBulkUpgrading(false); return; }
                              for (const cid of selectedCenterIds) {
                                try {
                                  const res = await fetch('/api/admin/centers', {
                                    method: 'PUT',
                                    headers,
                                    body: JSON.stringify({ centerId: cid, action: 'change_plan', newPlan: plan }),
                                  });
                                  if (res.ok) done++;
                                } catch {
                                  /* skip */
                                }
                              }
                              setBulkUpgrading(false);
                              setSelectedCenterIds(new Set());
                              fetchCenters();
                              alert(t('bulkUpgradeDone', { defaultValue: `Upgraded ${done} center(s).` }));
                            }}
                            disabled={bulkUpgrading}
                            className="ml-1 px-2 py-1 text-xs bg-indigo-100 dark:bg-indigo-900/50 rounded hover:bg-indigo-200 dark:hover:bg-indigo-800 disabled:opacity-50"
                          >
                            {PLAN_LABELS[plan]}
                          </button>
                        ))}
                      </span>
                    )}
                  </>
                )}
              </div>
              <div className="glass rounded-xl shadow overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      {internalRole === 'super_admin' && (
                        <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)] w-10">
                          <input
                            type="checkbox"
                            checked={sortedCenters.filter(c => c.status === 'active').length > 0 && sortedCenters.filter(c => c.status === 'active').every(c => selectedCenterIds.has(c.id))}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedCenterIds(new Set(sortedCenters.filter(c => c.status === 'active').map(c => c.id)));
                              } else {
                                setSelectedCenterIds(new Set());
                              }
                            }}
                            className="rounded"
                          />
                        </th>
                      )}
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">{t('centerName')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">{t('phone')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">{t('plan')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">{t('status')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">{t('studentsCount')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">{t('billingPeriod')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">{t('nextDue')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">{t('daysRemaining')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">{t('createdDate')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">{t('actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedCenters.map((c) => {
                      const due = getCenterDueDisplay(c, t);
                      return (
                      <tr key={c.id} className="border-b border-gray-100 dark:border-gray-700/50">
                        {internalRole === 'super_admin' && (
                          <td className="px-4 py-3">
                            {c.status === 'active' ? (
                              <input
                                type="checkbox"
                                checked={selectedCenterIds.has(c.id)}
                                onChange={(e) => {
                                  const next = new Set(selectedCenterIds);
                                  if (e.target.checked) next.add(c.id);
                                  else next.delete(c.id);
                                  setSelectedCenterIds(next);
                                }}
                                className="rounded"
                              />
                            ) : (
                              <span className="w-4 block" />
                            )}
                          </td>
                        )}
                        <td className="px-4 py-3 text-[var(--text-primary)] font-medium">{c.name}</td>
                        <td className="px-4 py-3" dir="ltr">{c.phone || c.owner?.phone || '—'}</td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1 flex-wrap">
                            {PLAN_LABELS[c.plan || 'starter'] || c.plan}
                            {c.is_early_adopter && (
                              <span className="px-1.5 py-0.5 text-xs font-medium rounded bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300" title="Early Adopter - Price Locked">🔒 EA</span>
                            )}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 italic ${c.status === 'active' ? 'text-green-600' : c.status === 'suspended' ? 'text-red-600' : 'text-amber-600'}`}>
                            {c.status === 'active' && '✅'}
                            {c.status === 'suspended' && '🔴'}
                            {c.status === 'pending' && '🟡'}
                            {c.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`font-mono italic ${
                            (c as { limit_status?: string }).limit_status === 'over' ? 'text-red-600 dark:text-red-400 font-bold' :
                            (c as { limit_status?: string }).limit_status === 'approaching' ? 'text-amber-600 dark:text-amber-400' : ''
                          }`}>
                            {(c as { weekly_unique_students?: number }).weekly_unique_students != null && (c as { max_students?: number }).max_students != null && (c as { max_students: number }).max_students < 999999
                              ? `${(c as { weekly_unique_students: number }).weekly_unique_students}/${(c as { max_students: number }).max_students}`
                              : c.students_count}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {BILLING_LABELS[c.billing_period || 'monthly'] || c.billing_period}
                        </td>
                        <td className={`px-4 py-3 ${due.dueColor}`}>
                          {due.nextDueText}
                        </td>
                        <td className={`px-4 py-3 font-medium ${due.dueColor}`}>
                          {due.daysText}
                        </td>
                        <td className="px-4 py-3">{new Date(c.created_at).toLocaleDateString()}</td>
                        <td className="px-4 py-3">
                          {internalRole !== 'internal_viewer' ? (
                            <div className="flex flex-wrap gap-1">
                              <button
                                onClick={() => setDetailCenter(c)}
                                className="px-2 py-1 text-xs glass rounded hover:bg-white/10"
                              >
                                {t('viewDetails')}
                              </button>
                              {internalRole === 'super_admin' && (
                                <button
                                  onClick={() => setChangePlanCenter(c)}
                                  className="px-2 py-1 text-xs bg-indigo-100 dark:bg-indigo-900/50 rounded hover:bg-indigo-200 dark:hover:bg-indigo-800"
                                >
                                  {t('changePlan')}
                                </button>
                              )}
                              {internalRole === 'super_admin' && c.status === 'active' && (
                                <button
                                  onClick={() => setPasswordConfirm({ type: 'suspend', center: c })}
                                  disabled={actionCenterId === c.id}
                                  className="px-2 py-1 text-xs bg-amber-100 dark:bg-amber-900/50 rounded hover:bg-amber-200"
                                >
                                  {t('suspend')}
                                </button>
                              )}
                              {internalRole === 'super_admin' && c.status === 'suspended' && (
                                <button
                                  onClick={() => handleCenterAction(c.id, 'reactivate')}
                                  disabled={actionCenterId === c.id}
                                  className="px-2 py-1 text-xs bg-green-100 dark:bg-green-900/50 rounded hover:bg-green-200"
                                >
                                  {t('reactivate')}
                                </button>
                              )}
                              {internalRole === 'super_admin' && (
                                <button
                                  onClick={() => setDeleteConfirm({ center: c, name: '', password: '' })}
                                  className="px-2 py-1 text-xs bg-red-100 dark:bg-red-900/50 rounded hover:bg-red-200 text-red-700 dark:text-red-300"
                                >
                                  {t('deleteCenters')}
                                </button>
                              )}
                            </div>
                          ) : (
                            <button
                              onClick={() => setDetailCenter(c)}
                              className="px-2 py-1 text-xs glass rounded hover:bg-white/10"
                            >
                              {t('viewDetails')}
                            </button>
                          )}
                        </td>
                      </tr>
                    ); })}
                  </tbody>
                </table>
                {centers.length === 0 && (
                  <p className="p-8 text-center text-[var(--text-secondary)]">{t('noCenters')}</p>
                )}
              </div>
            </div>
          )}

          {activeTab === 'billing' && (
            <div className="space-y-8">
              {/* Plan filter & MRR widgets */}
              <div className="flex flex-wrap items-center gap-4 mb-4">
                <select
                  value={billingPlanFilter}
                  onChange={(e) => setBillingPlanFilter(e.target.value)}
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-bg-tertiary text-text-primary text-sm"
                >
                  <option value="all">{t('allPlans', { defaultValue: 'All Plans' })}</option>
                  <option value="starter">Starter</option>
                  <option value="pro">Pro</option>
                  <option value="business">Business</option>
                  <option value="enterprise">Enterprise</option>
                  <option value="top_centers">Top Centers</option>
                  <option value="payg">PAYG</option>
                </select>
              </div>
              {billingStats && (
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
                  <div className="glass rounded-xl p-4 shadow">
                    <p className="text-xs text-[var(--text-secondary)]">{t('totalMRR', { defaultValue: 'Total MRR' })}</p>
                    <p className="text-lg font-bold text-indigo-600 dark:text-indigo-400">{billingStats.totalMRR.toLocaleString('ar-EG')} EGP</p>
                  </div>
                  <div className="glass rounded-xl p-4 shadow">
                    <p className="text-xs text-[var(--text-secondary)]">{t('fixedMRR', { defaultValue: 'Fixed MRR' })}</p>
                    <p className="text-lg font-bold text-[var(--text-primary)]">{billingStats.fixedMRR.toLocaleString('ar-EG')} EGP</p>
                  </div>
                  <div className="glass rounded-xl p-4 shadow">
                    <p className="text-xs text-[var(--text-secondary)]">{t('paygMRR', { defaultValue: 'PAYG MRR' })}</p>
                    <p className="text-lg font-bold text-[var(--text-primary)]">{billingStats.paygMRR.toLocaleString('ar-EG')} EGP</p>
                  </div>
                  <div className="glass rounded-xl p-4 shadow">
                    <p className="text-xs text-[var(--text-secondary)]">{t('revenueProjection', { defaultValue: 'Annual Projection' })}</p>
                    <p className="text-lg font-bold text-green-600 dark:text-green-400">{billingStats.revenueProjection.toLocaleString('ar-EG')} EGP</p>
                  </div>
                  {Object.entries(billingStats.mrrByPlan).filter(([, amt]) => amt > 0).length > 0 && (
                    <div className="glass rounded-xl p-4 shadow col-span-2">
                      <p className="text-xs text-[var(--text-secondary)] mb-2">{t('mrrByPlan', { defaultValue: 'MRR by Plan' })}</p>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(billingStats.mrrByPlan)
                          .filter(([, amt]) => amt > 0)
                          .map(([plan, amt]) => (
                            <span key={plan} className="px-2 py-1 text-xs font-medium rounded-full bg-indigo-100 dark:bg-indigo-900/50 text-indigo-800 dark:text-indigo-300">
                              {PLAN_LABELS[plan] || plan}: {amt.toLocaleString('ar-EG')} EGP
                            </span>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div className="glass rounded-xl shadow overflow-x-auto">
                <h3 className="p-4 text-lg font-semibold text-[var(--text-primary)]">{t('billing')}</h3>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">{t('centerName')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">{t('plan')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">{t('billingPeriod')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">Discount</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">Monthly Equiv</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">{t('nextDue')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">Days Until Due</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">Auto-Suspend Date</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">Referral Credits</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">{t('status')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">{t('actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {billingCenters.map((c) => {
                      const due = getBillingDueDisplay(c, t);
                      return (
                        <tr key={c.id} className="border-b border-gray-100 dark:border-gray-700/50">
                          <td className="px-4 py-3 text-[var(--text-primary)] font-medium">{c.name}</td>
                          <td className="px-4 py-3">
                            <span className="flex items-center gap-1 flex-wrap">
                              {(c as { billing_type?: string }).billing_type === 'payg'
                                ? <span>PAYG</span>
                                : <span>{PLAN_LABELS[c.plan] || c.plan}</span>}
                              {(c as { is_early_adopter?: boolean }).is_early_adopter && (
                                <span className="px-1.5 py-0.5 text-xs font-medium rounded bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300" title="Early Adopter - Price Locked">
                                  🔒 EA
                                </span>
                              )}
                            </span>
                          </td>
                          <td className="px-4 py-3">{BILLING_LABELS[c.billing_period || 'monthly']}</td>
                          <td className="px-4 py-3 font-mono italic">{c.discount ?? 0}%</td>
                          <td className="px-4 py-3 font-mono italic">{c.monthlyEquivalent?.toLocaleString('ar-EG') ?? '—'}</td>
                          <td className={`px-4 py-3 ${due.dueColor}`}>{due.nextDueText}</td>
                          <td className={`px-4 py-3 font-medium ${due.dueColor}`}>{due.daysText}</td>
                          <td className="px-4 py-3 text-xs">{(() => { const a = (c as { autoSuspendAt?: string }).autoSuspendAt; return a ? new Date(a).toLocaleString() : '—'; })()}</td>
                          <td className="px-4 py-3 font-mono italic text-green-600 dark:text-green-400">
                            {((c as { referralCredits?: number }).referralCredits ?? 0) > 0
                              ? `${((c as { referralCredits?: number }).referralCredits ?? 0).toLocaleString('ar-EG')} EGP`
                              : '—'}
                          </td>
                          <td className="px-4 py-3 italic">
                            {due.statusDisplay === 'overdue' && '🔴 overdue'}
                            {due.statusDisplay === 'due_soon' && '🟡 due_soon'}
                            {due.statusDisplay === 'paid' && '✅ paid'}
                            {due.statusDisplay === 'suspended' && '🔴 ' + t('suspended')}
                            {due.statusDisplay === 'awaiting' && '🟡 ' + t('awaitingPayment')}
                          </td>
                          <td className="px-4 py-3 flex gap-2">
                            {internalRole === 'super_admin' && (
                              <button
                                onClick={() => setMarkPaidCenter(c)}
                                disabled={actionCenterId === c.id}
                                className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                              >
                                {t('markAsPaid')}
                              </button>
                            )}
                            <button
                              onClick={() => openWhatsAppReminder(c)}
                              className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                            >
                              {t('sendReminder')}
                            </button>
                            {internalRole === 'super_admin' && (
                              <button
                                onClick={() => setPasswordConfirm({ type: 'suspend', center: c })}
                                disabled={actionCenterId === c.id}
                                className="px-2 py-1 text-xs bg-amber-600 text-white rounded hover:bg-amber-700"
                              >
                                {t('suspend')}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="glass rounded-xl shadow overflow-x-auto">
                <h3 className="p-4 text-lg font-semibold text-[var(--text-primary)]">{t('pendingPaymentProofs', { defaultValue: 'Pending Payment Proofs' })} ({pendingPaymentProofs.length})</h3>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">{t('centerName')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">{t('plan')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">Amount</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">{t('paymentMethod', { defaultValue: 'Payment Method' })}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">Reference</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">Proof</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">{t('actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingPaymentProofs.map((inv) => (
                      <tr key={inv.id} className="border-b border-gray-100 dark:border-gray-700/50">
                        <td className="px-4 py-3 text-[var(--text-primary)] font-medium">{inv.centerName}</td>
                        <td className="px-4 py-3">{PLAN_LABELS[inv.centerPlan || ''] || inv.centerPlan || '—'}</td>
                        <td className="px-4 py-3 font-mono italic">{Number(inv.payment_amount ?? 0).toLocaleString('ar-EG')} EGP</td>
                        <td className="px-4 py-3">{inv.payment_method || '—'}</td>
                        <td className="px-4 py-3 font-mono italic">{inv.payment_reference || '—'}</td>
                        <td className="px-4 py-3">
                          {inv.payment_proof_url ? (
                            <a href={inv.payment_proof_url} target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-indigo-400 hover:underline">
                              {t('viewProof', { defaultValue: 'View' })}
                            </a>
                          ) : '—'}
                        </td>
                        <td className="px-4 py-3 flex gap-2">
                          {internalRole === 'super_admin' && (
                            <button
                              onClick={() =>
                                Number(inv.payment_amount ?? 0) > SENSITIVE_PAYMENT_THRESHOLD
                                  ? setPasswordConfirm({
                                      type: 'approve_invoice',
                                      inv: {
                                        id: inv.id,
                                        centerName: inv.centerName,
                                        payment_amount: inv.payment_amount ?? 0,
                                      },
                                    })
                                  : handleInvoiceAction(inv.id, 'approve')
                              }
                              disabled={actionCenterId === inv.id}
                              className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded-lg disabled:opacity-50"
                            >
                              {t('approvePay', { defaultValue: 'Approve Payment' })}
                            </button>
                          )}
                          <button
                            onClick={() => handleInvoiceAction(inv.id, 'reject')}
                            disabled={actionCenterId === inv.id}
                            className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-medium rounded-lg disabled:opacity-50"
                          >
                            {t('rejectPayment', { defaultValue: 'Reject Payment' })}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {pendingPaymentProofs.length === 0 && (
                  <p className="p-8 text-center text-[var(--text-secondary)]">{t('noPendingInvoices', { defaultValue: 'No pending payment proofs.' })}</p>
                )}
              </div>
              <div className="glass rounded-xl shadow overflow-x-auto">
                <h3 className="p-4 text-lg font-semibold text-[var(--text-primary)]">{t('paymentHistory')}</h3>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">{t('date')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">{t('centerName')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">Amount</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">Period</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">{t('status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paymentHistory.map((p) => (
                      <tr key={p.source === 'invoice' ? `inv-${p.id}` : p.id} className="border-b border-gray-100 dark:border-gray-700/50">
                        <td className="px-4 py-3">{p.paid_at ? new Date(p.paid_at).toLocaleDateString() : '—'}</td>
                        <td className="px-4 py-3">{p.centerName}</td>
                        <td className="px-4 py-3 font-mono italic">{Number(p.amount).toLocaleString('ar-EG')} EGP</td>
                        <td className="px-4 py-3">{p.billing_period === 'payment_proof' ? 'Payment Proof' : p.billing_period}</td>
                        <td className="px-4 py-3">
                          {p.invoiceStatus === 'approved' && <span className="px-2 py-0.5 text-xs font-medium italic rounded-full bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300">{t('approved')}</span>}
                          {p.invoiceStatus === 'rejected' && <span className="px-2 py-0.5 text-xs font-medium italic rounded-full bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300">{t('rejected')}</span>}
                          {!p.invoiceStatus && '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {paymentHistory.length === 0 && (
                  <p className="p-8 text-center text-[var(--text-secondary)]">No payments recorded yet.</p>
                )}
              </div>
            </div>
          )}

          {activeTab === 'plan-requests' && (
            <div className="glass rounded-xl shadow overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">{t('centerName')}</th>
                    <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">Current Plan</th>
                    <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">Requested Plan</th>
                    <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">Price Change</th>
                    <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">{t('requestedAt')}</th>
                    <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">{t('status')}</th>
                    <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">{t('actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {planRequests.map((pr) => (
                    <tr key={pr.id} className="border-b border-gray-100 dark:border-gray-700/50">
                      <td className="px-4 py-3 text-[var(--text-primary)] font-medium">{pr.centerName}</td>
                      <td className="px-4 py-3">{PLAN_LABELS[pr.current_plan || 'starter']}</td>
                      <td className="px-4 py-3">{PLAN_LABELS[pr.requested_plan] || pr.requested_plan}</td>
                      <td className={`px-4 py-3 font-mono ${(pr.priceDiff ?? 0) > 0 ? 'text-green-600 dark:text-green-400' : (pr.priceDiff ?? 0) < 0 ? 'text-red-600 dark:text-red-400' : ''}`}>
                        {pr.priceDiffFormatted || '—'}
                      </td>
                      <td className="px-4 py-3">{new Date(pr.requested_at).toLocaleDateString()}</td>
                      <td className="px-4 py-3 italic">{pr.status}</td>
                      <td className="px-4 py-3 flex gap-2">
                        {pr.status === 'pending' && (
                          <>
                            <button
                              onClick={() => handlePlanRequestAction(pr.id, 'approve')}
                              disabled={actionCenterId === pr.id}
                              className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded-lg disabled:opacity-50"
                            >
                              {t('approve')}
                            </button>
                            <button
                              onClick={() => handlePlanRequestAction(pr.id, 'reject')}
                              disabled={actionCenterId === pr.id}
                              className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-medium rounded-lg disabled:opacity-50"
                            >
                              {t('reject')}
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {planRequests.length === 0 && (
                <p className="p-8 text-center text-[var(--text-secondary)]">No plan requests.</p>
              )}
            </div>
          )}

          {activeTab === 'pending' && (
            <div className="glass rounded-xl shadow p-6">
              <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">
                {t('pendingSignups')} ({pendingCenters.length})
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">{t('centerName')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">{t('phone')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">{t('email')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">{t('requestedPlan')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">{t('referralCode')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">{t('referredBy')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">{t('date')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">{t('actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingCenters.map((c) => (
                      <tr key={c.id} className="border-b border-gray-100 dark:border-gray-700/50">
                        <td className="px-4 py-3 text-[var(--text-primary)]">{c.name}</td>
                        <td className="px-4 py-3" dir="ltr">{c.phone || '—'}</td>
                        <td className="px-4 py-3 text-[var(--text-secondary)]">{c.email || '—'}</td>
                        <td className="px-4 py-3">{PLAN_LABELS[c.plan || 'starter'] || c.plan}</td>
                        <td className="px-4 py-3 font-mono">{c.referral_code_used || '—'}</td>
                        <td className="px-4 py-3">{c.referring_center_name || '—'}</td>
                        <td className="px-4 py-3 text-text-secondary">{new Date(c.created_at).toLocaleDateString()}</td>
                        <td className="px-4 py-3 flex gap-2">
                          <button
                            onClick={() => handleApprove(c.id)}
                            disabled={actionCenterId === c.id}
                            className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded-lg disabled:opacity-50"
                          >
                            {actionCenterId === c.id ? '...' : t('approve')}
                          </button>
                          <button
                            onClick={() => handleReject(c.id)}
                            disabled={actionCenterId === c.id}
                            className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-medium rounded-lg disabled:opacity-50"
                          >
                            {t('reject')}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {pendingCenters.length === 0 && <p className="mt-4 text-[var(--text-secondary)]">{t('noPending')}</p>}
            </div>
          )}

          {activeTab === 'team' && (
            <div className="space-y-6">
              {/* Invite Form */}
              <div className="glass rounded-xl shadow p-6">
                <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">
                  {t('inviteTeamMember', { defaultValue: 'Invite Team Member' })}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                  <input
                    type="text"
                    placeholder={t('name', { defaultValue: 'Name' })}
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                    className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-bg-tertiary text-text-primary text-sm"
                  />
                  <input
                    type="text"
                    placeholder={t('phone', { defaultValue: 'Phone (e.g. 01XXXXXXXXX)' })}
                    value={invitePhone}
                    onChange={(e) => setInvitePhone(e.target.value)}
                    className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-bg-tertiary text-text-primary text-sm"
                    dir="ltr"
                  />
                  <input
                    type="email"
                    placeholder={t('email', { defaultValue: 'Email (optional)' })}
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-bg-tertiary text-text-primary text-sm"
                    dir="ltr"
                  />
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as 'internal_admin' | 'internal_viewer')}
                    className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-bg-tertiary text-text-primary text-sm"
                  >
                    <option value="internal_admin">{t('internalAdmin', { defaultValue: 'Admin (Full Access)' })}</option>
                    <option value="internal_viewer">{t('internalViewer', { defaultValue: 'Viewer (Read Only)' })}</option>
                  </select>
                  <button
                    onClick={handleInviteInternal}
                    disabled={inviting || !inviteName.trim() || !invitePhone.trim()}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg disabled:opacity-50"
                  >
                    {inviting ? '...' : t('invite', { defaultValue: 'Invite' })}
                  </button>
                </div>
              </div>

              {/* Team Table */}
              <div className="glass rounded-xl shadow overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">{t('name', { defaultValue: 'Name' })}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">{t('phone', { defaultValue: 'Phone' })}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">{t('email', { defaultValue: 'Email' })}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">{t('role', { defaultValue: 'Role' })}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">{t('joinedDate', { defaultValue: 'Joined' })}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-[var(--text-secondary)]">{t('actions', { defaultValue: 'Actions' })}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {internalTeam.map((m) => (
                      <tr key={m.id} className="border-b border-gray-100 dark:border-gray-700/50">
                        <td className="px-4 py-3 text-[var(--text-primary)] font-medium">{m.name}</td>
                        <td className="px-4 py-3" dir="ltr">{m.phone || '—'}</td>
                        <td className="px-4 py-3">{m.email || '—'}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 text-xs font-medium italic rounded-full ${
                            m.role === 'super_admin' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300' :
                            m.role === 'internal_admin' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300' :
                            'glass text-[var(--text-primary)]'
                          }`}>
                            {m.role === 'super_admin' ? t('superAdmin', { defaultValue: 'CEO' }) :
                             m.role === 'internal_admin' ? t('internalAdmin', { defaultValue: 'Admin' }) :
                             m.role === 'admin' ? t('superAdmin', { defaultValue: 'CEO' }) :
                             t('internalViewer', { defaultValue: 'Viewer' })}
                          </span>
                        </td>
                        <td className="px-4 py-3">{new Date(m.created_at).toLocaleDateString()}</td>
                        <td className="px-4 py-3">
                          {m.role !== 'super_admin' && m.role !== 'admin' && (
                            <div className="flex gap-2">
                              <select
                                value={m.role}
                                onChange={(e) =>
                                  setPasswordConfirm({
                                    type: 'change_role',
                                    memberId: m.id,
                                    newRole: e.target.value,
                                    prevRole: m.role,
                                  })
                                }
                                className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-bg-tertiary text-text-primary"
                              >
                                <option value="internal_admin">{t('internalAdmin', { defaultValue: 'Admin' })}</option>
                                <option value="internal_viewer">{t('internalViewer', { defaultValue: 'Viewer' })}</option>
                              </select>
                              <button
                                onClick={() => handleRemoveInternal(m.id)}
                                className="px-2 py-1 text-xs bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300 rounded hover:bg-red-200"
                              >
                                {t('remove', { defaultValue: 'Remove' })}
                              </button>
                            </div>
                          )}
                          {(m.role === 'super_admin' || m.role === 'admin') && (
                            <span className="text-xs text-text-secondary">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {internalTeam.length === 0 && (
                  <p className="p-8 text-center text-[var(--text-secondary)]">{t('noTeamMembers', { defaultValue: 'No internal team members yet.' })}</p>
                )}
              </div>
            </div>
          )}

          {activeTab === 'security' && (
            <div className="space-y-6">
              {/* Recent Admin Actions */}
              <div className="glass rounded-xl p-6 shadow">
                <h3 className="text-xl font-semibold text-[var(--text-primary)] mb-4">
                  {t('recentAdminActions', { defaultValue: 'Recent Admin Actions' })}
                </h3>
                <div className="space-y-2">
                  {securityData.recentLogs.slice(0, 20).map((log) => (
                    <div
                      key={log.id}
                      className="flex items-center justify-between p-3 bg-bg-tertiary rounded-lg"
                    >
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-[var(--text-primary)]">
                          {log.action.replace(/_/g, ' ').toUpperCase()}
                        </span>
                        <span className="text-[var(--text-secondary)] text-sm ml-2">
                          {t('by', { defaultValue: 'by' })} {log.user?.name || t('unknown', { defaultValue: 'Unknown' })}
                        </span>
                        {log.center?.name && (
                          <span className="text-[var(--text-tertiary)] text-sm ml-2">
                            → {log.center.name}
                          </span>
                        )}
                      </div>
                      <span className="text-[var(--text-tertiary)] text-sm flex-shrink-0 ml-2">
                        {new Date(log.created_at).toLocaleString()}
                      </span>
                    </div>
                  ))}
                  {securityData.recentLogs.length === 0 && (
                    <p className="text-sm text-[var(--text-secondary)] py-4">{t('noAuditLogs', { defaultValue: 'No audit logs yet.' })}</p>
                  )}
                </div>
              </div>

              {/* Action Statistics & Center Stats */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="glass rounded-xl p-6 shadow">
                  <h4 className="text-lg font-semibold text-[var(--text-primary)] mb-4">
                    {t('actionsLast30Days', { defaultValue: 'Actions (Last 30 Days)' })}
                  </h4>
                  <div className="space-y-2">
                    {Object.entries(securityData.actionStats).length > 0 ? (
                      Object.entries(securityData.actionStats).map(([action, count]) => (
                        <div key={action} className="flex justify-between text-sm">
                          <span className="text-[var(--text-secondary)]">{action.replace(/_/g, ' ')}</span>
                          <span className="font-semibold text-[var(--text-primary)]">{count}</span>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-[var(--text-secondary)]">{t('noActivity')}</p>
                    )}
                  </div>
                </div>
                <div className="glass rounded-xl p-6 shadow">
                  <h4 className="text-lg font-semibold text-[var(--text-primary)] mb-4">
                    {t('centersByStatus', { defaultValue: 'Centers by Status' })}
                  </h4>
                  <div className="space-y-2">
                    {Object.entries(securityData.centerStats).map(([status, count]) => (
                      <div key={status} className="flex justify-between text-sm">
                        <span className="text-[var(--text-secondary)] capitalize">{status}</span>
                        <span className="font-semibold text-[var(--text-primary)]">{count}</span>
                      </div>
                    ))}
                    {Object.keys(securityData.centerStats).length === 0 && (
                      <p className="text-sm text-[var(--text-secondary)]">{t('noData')}</p>
                    )}
                  </div>
                </div>
                <div className="glass rounded-xl p-6 shadow">
                  <h4 className="text-lg font-semibold text-[var(--text-primary)] mb-4">
                    {t('securityHealth', { defaultValue: 'Security Health' })}
                  </h4>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-[var(--text-secondary)]">{t('auditLogging', { defaultValue: 'Audit Logging' })}</span>
                      <span className="text-green-500 font-semibold">✓ {t('active', { defaultValue: 'Active' })}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-[var(--text-secondary)]">{t('rlsEnabled', { defaultValue: 'RLS Enabled' })}</span>
                      <span className="text-green-500 font-semibold">✓ {t('active', { defaultValue: 'Active' })}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-[var(--text-secondary)]">{t('inputValidation', { defaultValue: 'Input Validation' })}</span>
                      <span className="text-green-500 font-semibold">✓ {t('active', { defaultValue: 'Active' })}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Export Audit Log */}
              <div className="glass rounded-xl p-6 shadow">
                <button
                  onClick={exportAuditLog}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium"
                >
                  {t('exportAuditLog', { defaultValue: 'Export Audit Log (CSV)' })}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {detailCenter && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setDetailCenter(null)}>
          <div className="glass rounded-xl shadow-xl max-w-lg w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">{t('centerDetails')}</h3>
            <div className="space-y-2 text-sm">
              <p><span className="text-text-secondary">{t('centerName')}:</span> {detailCenter.name}</p>
              <p><span className="text-text-secondary">{t('phone')}:</span> <span dir="ltr">{detailCenter.phone || detailCenter.owner?.phone || '—'}</span></p>
              <p><span className="text-text-secondary">{t('email')}:</span> {detailCenter.email || '—'}</p>
              <p><span className="text-text-secondary">Owner:</span> {detailCenter.owner?.name || '—'} ({detailCenter.owner?.phone || '—'})</p>
              <p><span className="text-text-secondary">{t('plan')}:</span> {PLAN_LABELS[detailCenter.plan || 'starter']}</p>
              <p><span className="text-text-secondary">{t('studentsCount')}:</span> {detailCenter.students_count}</p>
              <p><span className="text-text-secondary">{t('lastPayment')}:</span> {detailCenter.last_payment ? new Date(detailCenter.last_payment).toLocaleDateString() : '—'}</p>
              <p><span className="text-text-secondary">{t('referralCode')}:</span> {detailCenter.referral_code || '—'}</p>
            </div>
            <button onClick={() => setDetailCenter(null)} className="mt-4 px-4 py-2 glass rounded-lg hover:bg-white/10">{t('viewDetails')} ✕</button>
          </div>
        </div>
      )}

      {changePlanCenter && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setChangePlanCenter(null)}>
          <div className="glass rounded-xl shadow-xl max-w-sm w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">{t('changePlan')}</h3>
            <div className="space-y-2">
              {(['starter', 'pro', 'business', 'enterprise', 'top_centers', 'payg'] as const).map((plan) => (
                <button
                  key={plan}
                  onClick={() => handleCenterAction(changePlanCenter.id, 'change_plan', { newPlan: plan })}
                  disabled={actionCenterId === changePlanCenter.id}
                  className="w-full px-3 py-2 text-left glass rounded-lg hover:bg-bg-secondary disabled:opacity-50"
                >
                  {PLAN_LABELS[plan]} {plan !== 'payg' && plan !== 'top_centers' && `(EGP ${PLAN_PRICE[plan]?.toLocaleString()}/mo)`}
                  {plan === 'top_centers' && ' (Custom)'}
                </button>
              ))}
            </div>
            <button onClick={() => setChangePlanCenter(null)} className="mt-4 px-4 py-2 glass rounded-lg">Cancel</button>
          </div>
        </div>
      )}

      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setDeleteConfirm(null)}>
          <div className="glass rounded-xl shadow-xl max-w-sm w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-red-600 dark:text-red-400 mb-4">{t('confirmDelete')}</h3>
            <p className="text-sm text-[var(--text-secondary)] mb-2">Type: {deleteConfirm.center.name}</p>
            <input
              type="text"
              value={deleteConfirm.name}
              onChange={(e) => setDeleteConfirm({ ...deleteConfirm, name: e.target.value })}
              placeholder={deleteConfirm.center.name}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-bg-tertiary text-text-primary mb-3"
            />
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1 mt-2">
              {t('passwordConfirm', { defaultValue: 'Confirm your password' })}
            </label>
            <input
              type="password"
              value={deleteConfirm.password}
              onChange={(e) => setDeleteConfirm({ ...deleteConfirm, password: e.target.value })}
              placeholder={t('passwordPlaceholder', { defaultValue: 'Enter your password' })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-bg-tertiary text-text-primary mb-4"
            />
            <div className="flex gap-2">
              <button
                onClick={() =>
                  handleCenterAction(deleteConfirm.center.id, 'delete', {
                    confirmName: deleteConfirm.name,
                    password: deleteConfirm.password,
                  })
                }
                disabled={
                  deleteConfirm.name !== deleteConfirm.center.name ||
                  !deleteConfirm.password.trim() ||
                  actionCenterId === deleteConfirm.center.id
                }
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {t('deleteCenters')}
              </button>
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 glass rounded-lg">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {markPaidCenter && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setMarkPaidCenter(null)}>
          <div className="glass rounded-xl shadow-xl max-w-sm w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">{t('markAsPaid')}</h3>
            <p className="text-sm text-[var(--text-secondary)] mb-4">{markPaidCenter.name} - {(markPaidCenter.amount ?? PLAN_PRICE[markPaidCenter.plan] ?? 2000).toLocaleString('ar-EG')} EGP</p>
            <div className="flex gap-2">
              <button
                onClick={() => handleMarkPaid(markPaidCenter)}
                disabled={actionCenterId === markPaidCenter.id}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {t('markAsPaid')}
              </button>
              <button onClick={() => setMarkPaidCenter(null)} className="px-4 py-2 glass rounded-lg">Cancel</button>
            </div>
          </div>
        </div>
      )}

      <PasswordConfirmModal
        isOpen={!!passwordConfirm}
        onClose={() => {
          setPasswordConfirm(null);
          setPasswordError('');
        }}
        title={
          passwordConfirm?.type === 'suspend'
            ? t('confirmSuspend', { defaultValue: 'Confirm Suspend Center' })
            : passwordConfirm?.type === 'approve_invoice'
              ? t('confirmApprovePayment', { defaultValue: 'Confirm Approve Payment' })
              : t('confirmRoleChange', { defaultValue: 'Confirm Role Change' })
        }
        message={
          passwordConfirm?.type === 'suspend'
            ? `${t('suspend', { defaultValue: 'Suspend' })}: ${passwordConfirm.center.name}`
            : passwordConfirm?.type === 'approve_invoice'
              ? `${passwordConfirm.inv.centerName} - ${passwordConfirm.inv.payment_amount.toLocaleString('ar-EG')} EGP`
              : undefined
        }
        loading={passwordConfirmLoading || !!actionCenterId}
        error={passwordError}
        onConfirm={async (password) => {
          setPasswordError('');
          setPasswordConfirmLoading(true);
          try {
            if (passwordConfirm?.type === 'suspend') {
              await handleCenterAction(passwordConfirm.center.id, 'suspend', { password });
              setPasswordConfirm(null);
            } else if (passwordConfirm?.type === 'approve_invoice') {
              await handleInvoiceAction(passwordConfirm.inv.id, 'approve', password);
              setPasswordConfirm(null);
            } else if (passwordConfirm?.type === 'change_role') {
              const headers = await getAuthHeaders();
              if (!headers) {
                setPasswordError('Not authenticated');
                return;
              }
              const r = await fetch('/api/admin/team', {
                method: 'PUT',
                headers,
                body: JSON.stringify({
                  memberId: passwordConfirm.memberId,
                  role: passwordConfirm.newRole,
                  password,
                }),
              });
              const data = await r.json();
              if (r.ok) {
                fetchInternalTeam();
                setPasswordConfirm(null);
              } else {
                setPasswordError(data.error || 'Failed');
              }
            }
          } finally {
            setPasswordConfirmLoading(false);
          }
        }}
      />
    </>
  );
}
