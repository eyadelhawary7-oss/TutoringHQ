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

type TabId = 'overview' | 'kpi' | 'centers' | 'billing' | 'plan-requests' | 'pending' | 'team';

interface OverviewStats {
  totalCenters: number;
  activeCenters: number;
  suspendedCenters: number;
  totalStudents: number;
  mrr: number;
  byPlan: Record<string, number>;
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
}

interface PlanRequestRow {
  id: string;
  center_id: string;
  centerName: string;
  current_plan?: string;
  requested_plan: string;
  status: string;
  requested_at: string;
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
  pro_plus: 'Pro+',
  enterprise: 'Enterprise',
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
    return { nextDueText: '—', daysText: '—', dueColor: 'text-gray-500' };
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
  starter: 4000,
  pro: 7200,
  pro_plus: 8000,
  enterprise: 9000,
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

  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const [centers, setCenters] = useState<CenterRow[]>([]);
  const [pendingCenters, setPendingCenters] = useState<CenterRow[]>([]);
  const [planRequests, setPlanRequests] = useState<PlanRequestRow[]>([]);
  const [billingCenters, setBillingCenters] = useState<BillingCenter[]>([]);
  const [paymentHistory, setPaymentHistory] = useState<PaymentRecord[]>([]);
  const [pendingInvoices, setPendingInvoices] = useState<{ id: string; center_id: string; centerName: string; payment_amount: number; payment_reference?: string; payment_proof_url?: string; created_at: string; invoice_number?: string }[]>([]);

  const [statusFilter, setStatusFilter] = useState('all');
  const [planFilter, setPlanFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'next_payment_due' | 'students_count' | 'created_at'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [actionCenterId, setActionCenterId] = useState<string | null>(null);
  const [detailCenter, setDetailCenter] = useState<CenterRow | null>(null);
  const [changePlanCenter, setChangePlanCenter] = useState<CenterRow | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ center: CenterRow; name: string } | null>(null);
  const [markPaidCenter, setMarkPaidCenter] = useState<BillingCenter | null>(null);

  const [internalTeam, setInternalTeam] = useState<{ id: string; name: string; email: string; role: string; phone?: string; created_at: string }[]>([]);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePhone, setInvitePhone] = useState('');
  const [inviteRole, setInviteRole] = useState<'internal_admin' | 'internal_viewer'>('internal_admin');
  const [inviting, setInviting] = useState(false);
  const [internalRole, setInternalRole] = useState<string>('internal_viewer');

  const getSession = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session;
  }, []);

  useEffect(() => {
    const load = async () => {
      const session = await getSession();
      if (!session) {
        router.replace('/login');
        return;
      }
      try {
        const res = await fetch('/api/admin/overview', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (res.status === 403) {
          setIsAuthorized(false);
          router.replace('/dashboard');
          return;
        }
        if (res.ok) {
          const data = await res.json();
          setOverview(data);
          if (data.internalRole) setInternalRole(data.internalRole);
        }
        setIsAuthorized(true);
      } catch {
        setIsAuthorized(false);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [getSession, router]);

  const fetchCenters = useCallback(async () => {
    const session = await getSession();
    if (!session) return;
    const params = new URLSearchParams();
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (planFilter !== 'all') params.set('plan', planFilter);
    if (searchQuery.trim()) params.set('search', searchQuery.trim());
    const res = await fetch(`/api/admin/centers?${params}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setCenters(data.centers || []);
      setPendingCenters(data.pendingCenters || []);
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
    const res = await fetch('/api/admin/billing', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setBillingCenters(data.centers || []);
      setPaymentHistory(data.paymentHistory || []);
      setPendingInvoices(data.pendingInvoices || []);
    }
  }, [getSession]);

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

  useEffect(() => {
    if (activeTab === 'centers') fetchCenters();
  }, [activeTab, fetchCenters]);

  useEffect(() => {
    if (activeTab === 'plan-requests') fetchPlanRequests();
  }, [activeTab, fetchPlanRequests]);

  useEffect(() => {
    if (activeTab === 'billing') fetchBilling();
  }, [activeTab, fetchBilling]);

  useEffect(() => {
    if (activeTab === 'team') fetchInternalTeam();
  }, [activeTab, fetchInternalTeam]);

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
    extra?: { newPlan?: string; confirmName?: string }
  ) => {
    const session = await getSession();
    if (!session) return;
    setActionCenterId(centerId);
    try {
      const body: Record<string, unknown> = { centerId, action };
      if (extra?.newPlan) body.newPlan = extra.newPlan;
      if (extra?.confirmName) body.confirmName = extra.confirmName;
      const res = await fetch('/api/admin/centers', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        setChangePlanCenter(null);
        setDeleteConfirm(null);
        setDetailCenter(null);
        fetchCenters();
        if (activeTab === 'overview' && overview) {
          const oRes = await fetch('/api/admin/overview', { headers: { Authorization: `Bearer ${session.access_token}` } });
          if (oRes.ok) setOverview(await oRes.json());
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
    const session = await getSession();
    if (!session) return;
    setActionCenterId(requestId);
    try {
      const res = await fetch('/api/admin/plan-requests', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ requestId, action }),
      });
      if (res.ok) {
        fetchPlanRequests();
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

  const handleInvoiceAction = async (invoiceId: string, action: 'approve' | 'reject') => {
    const session = await getSession();
    if (!session) return;
    setActionCenterId(invoiceId);
    try {
      const res = await fetch('/api/admin/billing', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ invoiceId, action }),
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
    const session = await getSession();
    if (!session) return;
    const amount = center.amount ?? PLAN_PRICE[center.plan] ?? 4000;
    const bp = center.billing_period || 'monthly';
    setActionCenterId(center.id);
    try {
      const res = await fetch('/api/admin/billing', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
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
    const session = await getSession();
    if (!session) return;
    setActionCenterId(centerId);
    try {
      const res = await fetch('/api/admin/centers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
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
    const session = await getSession();
    if (!session) return;
    setActionCenterId(centerId);
    try {
      const res = await fetch('/api/admin/centers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
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
    const amount = center.amount ?? PLAN_PRICE[center.plan] ?? 4000;
    const phone = (center.phone || '').replace(/\D/g, '').replace(/^0/, '');
    const text = encodeURIComponent(
      `مرحباً، هذا تذكير بموعد سداد اشتراك CenterHQ. المبلغ المطلوب: ${amount} جنيه. شكراً لتعاونكم.`
    );
    window.open(`https://wa.me/2${phone}?text=${text}`, '_blank');
  };

  const handleInviteInternal = async () => {
    if (!inviteName.trim() || !invitePhone.trim()) return;
    const session = await getSession();
    if (!session) return;
    setInviting(true);
    try {
      const res = await fetch('/api/admin/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
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
    const session = await getSession();
    if (!session) return;
    try {
      const res = await fetch('/api/admin/team', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
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

  const handleChangeInternalRole = async (memberId: string, newRole: string) => {
    const session = await getSession();
    if (!session) return;
    try {
      const res = await fetch('/api/admin/team', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ memberId, role: newRole }),
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

  if (isLoading || !isAuthorized) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-indigo-600 border-t-transparent rounded-full" />
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
  ];
  const tabs = allTabs.filter(tab => tab.roles.includes(internalRole));

  const byPlanData = overview
    ? Object.entries(overview.byPlan || {}).map(([plan, count]) => ({ name: PLAN_LABELS[plan] || plan, count }))
    : [];

  return (
    <>
    <div className="min-h-screen" dir={isRTL ? 'rtl' : 'ltr'}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {/* Top bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('title')}</h1>
            <div className="flex items-center gap-4">
              {user?.name && <span className="text-sm text-gray-600 dark:text-gray-400">{user.name}</span>}
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
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                {t(tab.labelKey)}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {activeTab === 'overview' && overview && (
            <div className="space-y-6">
              {/* Action Required */}
              <div>
                <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">{t('actionRequired')}</h2>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <button
                    onClick={() => setActiveTab('pending')}
                    className={`p-4 rounded-xl shadow text-left transition-all border-2 ${
                      ((overview as { pendingSignupsCount?: number }).pendingSignupsCount ?? 0) > 0
                        ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/20'
                        : 'border-green-500 bg-green-50 dark:bg-green-900/20'
                    }`}
                  >
                    <span className="text-2xl">🔔</span>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{t('pendingSignupsCount')}</p>
                    <p className={`text-3xl font-bold ${((overview as { pendingSignupsCount?: number }).pendingSignupsCount ?? 0) > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-green-700 dark:text-green-400'}`}>
                      {((overview as { pendingSignupsCount?: number }).pendingSignupsCount ?? 0) > 0 ? (overview as { pendingSignupsCount?: number }).pendingSignupsCount : '✓'}
                    </p>
                    <p className="text-xs text-indigo-600 dark:text-indigo-400 mt-1">{t('view')} →</p>
                  </button>
                  <button
                    onClick={() => setActiveTab('plan-requests')}
                    className={`p-4 rounded-xl shadow text-left transition-all border-2 ${
                      ((overview as { pendingPlanRequestsCount?: number }).pendingPlanRequestsCount ?? 0) > 0
                        ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/20'
                        : 'border-green-500 bg-green-50 dark:bg-green-900/20'
                    }`}
                  >
                    <span className="text-2xl">📋</span>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{t('planRequestsCount')}</p>
                    <p className={`text-3xl font-bold ${((overview as { pendingPlanRequestsCount?: number }).pendingPlanRequestsCount ?? 0) > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-green-700 dark:text-green-400'}`}>
                      {((overview as { pendingPlanRequestsCount?: number }).pendingPlanRequestsCount ?? 0) > 0 ? (overview as { pendingPlanRequestsCount?: number }).pendingPlanRequestsCount : '✓'}
                    </p>
                    <p className="text-xs text-indigo-600 dark:text-indigo-400 mt-1">{t('view')} →</p>
                  </button>
                  <button
                    onClick={() => setActiveTab('billing')}
                    className={`p-4 rounded-xl shadow text-left transition-all border-2 ${
                      ((overview as { pendingPaymentProofsCount?: number }).pendingPaymentProofsCount ?? 0) > 0
                        ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/20'
                        : 'border-green-500 bg-green-50 dark:bg-green-900/20'
                    }`}
                  >
                    <span className="text-2xl">💳</span>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{t('paymentProofsCount')}</p>
                    <p className={`text-3xl font-bold ${((overview as { pendingPaymentProofsCount?: number }).pendingPaymentProofsCount ?? 0) > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-green-700 dark:text-green-400'}`}>
                      {((overview as { pendingPaymentProofsCount?: number }).pendingPaymentProofsCount ?? 0) > 0 ? (overview as { pendingPaymentProofsCount?: number }).pendingPaymentProofsCount : '✓'}
                    </p>
                    <p className="text-xs text-indigo-600 dark:text-indigo-400 mt-1">{t('view')} →</p>
                  </button>
                  <button
                    onClick={() => setActiveTab('billing')}
                    className={`p-4 rounded-xl shadow text-left transition-all border-2 ${
                      ((overview as { overdueCentersCount?: number }).overdueCentersCount ?? 0) > 0
                        ? 'border-red-500 bg-red-50 dark:bg-red-900/20'
                        : 'border-green-500 bg-green-50 dark:bg-green-900/20'
                    }`}
                  >
                    <span className="text-2xl">⚠️</span>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{t('overdueCentersCount')}</p>
                    <p className={`text-3xl font-bold ${((overview as { overdueCentersCount?: number }).overdueCentersCount ?? 0) > 0 ? 'text-red-700 dark:text-red-400' : 'text-green-700 dark:text-green-400'}`}>
                      {((overview as { overdueCentersCount?: number }).overdueCentersCount ?? 0) > 0 ? (overview as { overdueCentersCount?: number }).overdueCentersCount : '✓'}
                    </p>
                    <p className="text-xs text-indigo-600 dark:text-indigo-400 mt-1">{t('view')} →</p>
                  </button>
                </div>
                {/* Recent Activity */}
                <div className="mt-6 p-4 bg-white dark:bg-gray-800 rounded-xl shadow">
                  <h3 className="text-base font-semibold text-gray-800 dark:text-gray-200 mb-3">{t('recentActivity')}</h3>
                  {((overview as { recentActivity?: Array<{ action: string; details?: unknown; created_at: string }> }).recentActivity ?? []).length > 0 ? (
                    <ul className="space-y-2 text-sm">
                      {((overview as { recentActivity?: Array<{ action: string; details?: unknown; created_at: string }> }).recentActivity ?? []).slice(0, 10).map((a, i) => {
                        const timeAgo = formatTimeAgo(new Date(a.created_at));
                        const summary = formatActivitySummary(a.action, a.details);
                        return (
                          <li key={i} className="flex justify-between gap-4 text-gray-600 dark:text-gray-400">
                            <span>{timeAgo} — {summary}</span>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="text-sm text-gray-500 dark:text-gray-400">{t('noActivity')}</p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow">
                  <p className="text-sm text-gray-500 dark:text-gray-400">{t('totalCenters')}</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">{overview.totalCenters}</p>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow">
                  <p className="text-sm text-gray-500 dark:text-gray-400">{t('activeCenters')}</p>
                  <p className="text-2xl font-bold text-green-600 dark:text-green-400">{overview.activeCenters}</p>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow">
                  <p className="text-sm text-gray-500 dark:text-gray-400">{t('suspendedCenters')}</p>
                  <p className="text-2xl font-bold text-red-600 dark:text-red-400">{overview.suspendedCenters}</p>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow">
                  <p className="text-sm text-gray-500 dark:text-gray-400">{t('totalStudents')}</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">{overview.totalStudents}</p>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow">
                  <p className="text-sm text-gray-500 dark:text-gray-400">{t('mrr')}</p>
                  <p className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
                    {overview.mrr?.toLocaleString('ar-EG')} EGP
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow">
                  <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">{t('byPlan')}</h3>
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
                <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow">
                  <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">{t('signupsChart')}</h3>
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
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">{t('kpiDashboard', { defaultValue: 'CEO Dashboard — KPIs' })}</h2>

              {/* Revenue KPIs Row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow border-s-4 border-green-500">
                  <p className="text-sm text-gray-500 dark:text-gray-400">{t('totalRevenueCollected', { defaultValue: 'Total Revenue Collected' })}</p>
                  <p className="text-2xl font-bold text-green-600 dark:text-green-400">{Number((overview as unknown as Record<string, unknown>).totalRevenueCollected || 0).toLocaleString('ar-EG')} EGP</p>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow border-s-4 border-indigo-500">
                  <p className="text-sm text-gray-500 dark:text-gray-400">{t('revenueThisMonth', { defaultValue: 'Revenue This Month' })}</p>
                  <p className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">{Number((overview as unknown as Record<string, unknown>).revenueThisMonth || 0).toLocaleString('ar-EG')} EGP</p>
                  <p className={`text-xs mt-1 ${(Number((overview as unknown as Record<string, unknown>).revenueGrowth) || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {(Number((overview as unknown as Record<string, unknown>).revenueGrowth) || 0) >= 0 ? '↑' : '↓'} {Math.abs(Number((overview as unknown as Record<string, unknown>).revenueGrowth) || 0)}% vs last month
                  </p>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow border-s-4 border-amber-500">
                  <p className="text-sm text-gray-500 dark:text-gray-400">{t('pendingRevenue', { defaultValue: 'Pending Revenue' })}</p>
                  <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{Number((overview as unknown as Record<string, unknown>).pendingRevenue || 0).toLocaleString('ar-EG')} EGP</p>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow border-s-4 border-blue-500">
                  <p className="text-sm text-gray-500 dark:text-gray-400">{t('arpc', { defaultValue: 'Avg Revenue Per Center' })}</p>
                  <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{Number((overview as unknown as Record<string, unknown>).arpc || 0).toLocaleString('ar-EG')} EGP</p>
                </div>
              </div>

              {/* Growth & Health Row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow border-s-4 border-green-500">
                  <p className="text-sm text-gray-500 dark:text-gray-400">{t('activeCenters', { defaultValue: 'Active Centers' })}</p>
                  <p className="text-2xl font-bold text-green-600 dark:text-green-400">{overview.activeCenters}</p>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow border-s-4 border-red-500">
                  <p className="text-sm text-gray-500 dark:text-gray-400">{t('churnRate', { defaultValue: 'Churn Rate' })}</p>
                  <p className="text-2xl font-bold text-red-600 dark:text-red-400">{Number((overview as unknown as Record<string, unknown>).churnRate) || 0}%</p>
                  <p className="text-xs text-gray-500 mt-1">{Number((overview as unknown as Record<string, unknown>).churnedCenters) || 0} {t('centersSuspended', { defaultValue: 'centers suspended' })}</p>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow border-s-4 border-purple-500">
                  <p className="text-sm text-gray-500 dark:text-gray-400">{t('mrr', { defaultValue: 'MRR' })}</p>
                  <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">{(overview.mrr || 0).toLocaleString('ar-EG')} EGP</p>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow border-s-4 border-cyan-500">
                  <p className="text-sm text-gray-500 dark:text-gray-400">{t('totalStudents', { defaultValue: 'Total Students' })}</p>
                  <p className="text-2xl font-bold text-cyan-600 dark:text-cyan-400">{overview.totalStudents}</p>
                </div>
              </div>

              {/* Monthly Revenue Chart */}
              <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow">
                <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">{t('monthlyRevenueChart', { defaultValue: 'Monthly Revenue (Last 6 Months)' })}</h3>
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
                <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow">
                  <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">{t('byPlan', { defaultValue: 'Centers by Plan' })}</h3>
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
                <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow">
                  <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">{t('signupsChart', { defaultValue: 'Signups Over Time' })}</h3>
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
              <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow">
                <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">{t('financialSummary', { defaultValue: 'Financial Summary' })}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-sm">
                  <div>
                    <p className="text-gray-500 dark:text-gray-400 mb-1">{t('annualRunRate', { defaultValue: 'Annual Run Rate (ARR)' })}</p>
                    <p className="text-xl font-bold text-gray-900 dark:text-white">{((overview.mrr || 0) * 12).toLocaleString('ar-EG')} EGP</p>
                  </div>
                  <div>
                    <p className="text-gray-500 dark:text-gray-400 mb-1">{t('revenueLastMonth', { defaultValue: 'Revenue Last Month' })}</p>
                    <p className="text-xl font-bold text-gray-900 dark:text-white">{Number((overview as unknown as Record<string, unknown>).revenueLastMonth || 0).toLocaleString('ar-EG')} EGP</p>
                  </div>
                  <div>
                    <p className="text-gray-500 dark:text-gray-400 mb-1">{t('collectionRate', { defaultValue: 'Collection Rate' })}</p>
                    <p className="text-xl font-bold text-gray-900 dark:text-white">
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
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm"
                >
                  <option value="all">{t('filterAll')}</option>
                  <option value="active">{t('filterActive')}</option>
                  <option value="suspended">{t('filterSuspended')}</option>
                  <option value="pending">{t('filterPending')}</option>
                </select>
                <select
                  value={planFilter}
                  onChange={(e) => setPlanFilter(e.target.value)}
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm"
                >
                  <option value="all">{t('filterAll')}</option>
                  <option value="starter">Starter</option>
                  <option value="pro">Pro</option>
                  <option value="pro_plus">Pro+</option>
                  <option value="enterprise">Enterprise</option>
                  <option value="payg">PAYG</option>
                </select>
                <input
                  type="text"
                  placeholder={t('searchPlaceholder')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm min-w-[200px]"
                />
                <span className="text-sm text-gray-500 dark:text-gray-400">{t('sortBy')}:</span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm"
                >
                  <option value="name">{t('sortName')}</option>
                  <option value="next_payment_due">{t('sortDueDate')}</option>
                  <option value="students_count">{t('sortStudents')}</option>
                  <option value="created_at">{t('sortCreated')}</option>
                </select>
                <button
                  onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm"
                >
                  {sortDir === 'asc' ? '↑' : '↓'}
                </button>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">{t('centerName')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">{t('phone')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">{t('plan')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">{t('status')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">{t('studentsCount')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">{t('billingPeriod')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">{t('nextDue')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">{t('daysRemaining')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">{t('createdDate')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">{t('actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedCenters.map((c) => {
                      const due = getCenterDueDisplay(c, t);
                      return (
                      <tr key={c.id} className="border-b border-gray-100 dark:border-gray-700/50">
                        <td className="px-4 py-3 text-gray-900 dark:text-white font-medium">{c.name}</td>
                        <td className="px-4 py-3" dir="ltr">{c.phone || c.owner?.phone || '—'}</td>
                        <td className="px-4 py-3">{PLAN_LABELS[c.plan || 'starter'] || c.plan}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 italic ${c.status === 'active' ? 'text-green-600' : c.status === 'suspended' ? 'text-red-600' : 'text-amber-600'}`}>
                            {c.status === 'active' && '✅'}
                            {c.status === 'suspended' && '🔴'}
                            {c.status === 'pending' && '🟡'}
                            {c.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono italic">{c.students_count}</td>
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
                                className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-600 rounded hover:bg-gray-200 dark:hover:bg-gray-500"
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
                                  onClick={() => confirm(t('confirmSuspend')) && handleCenterAction(c.id, 'suspend')}
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
                                  onClick={() => setDeleteConfirm({ center: c, name: '' })}
                                  className="px-2 py-1 text-xs bg-red-100 dark:bg-red-900/50 rounded hover:bg-red-200 text-red-700 dark:text-red-300"
                                >
                                  {t('deleteCenters')}
                                </button>
                              )}
                            </div>
                          ) : (
                            <button
                              onClick={() => setDetailCenter(c)}
                              className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-600 rounded hover:bg-gray-200 dark:hover:bg-gray-500"
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
                  <p className="p-8 text-center text-gray-500 dark:text-gray-400">{t('noCenters')}</p>
                )}
              </div>
            </div>
          )}

          {activeTab === 'billing' && (
            <div className="space-y-8">
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-x-auto">
                <h3 className="p-4 text-lg font-semibold text-gray-800 dark:text-gray-200">{t('billing')}</h3>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">{t('centerName')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">{t('plan')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">{t('billingPeriod')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">Discount</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">Monthly Equiv</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">{t('nextDue')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">Days Until Due</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">Auto-Suspend Date</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">Referral Credits</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">{t('status')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">{t('actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {billingCenters.map((c) => {
                      const due = getBillingDueDisplay(c, t);
                      return (
                        <tr key={c.id} className="border-b border-gray-100 dark:border-gray-700/50">
                          <td className="px-4 py-3 text-gray-900 dark:text-white font-medium">{c.name}</td>
                          <td className="px-4 py-3">{PLAN_LABELS[c.plan] || c.plan}</td>
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
                                onClick={() => handleCenterAction(c.id, 'suspend')}
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
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-x-auto">
                <h3 className="p-4 text-lg font-semibold text-gray-800 dark:text-gray-200">{t('pendingInvoices', { defaultValue: 'Pending Payment Proofs' })} ({pendingInvoices.length})</h3>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">{t('centerName')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">{t('date')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">Amount</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">Reference</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">Proof</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">{t('actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingInvoices.map((inv) => (
                      <tr key={inv.id} className="border-b border-gray-100 dark:border-gray-700/50">
                        <td className="px-4 py-3 text-gray-900 dark:text-white font-medium">{inv.centerName}</td>
                        <td className="px-4 py-3">{inv.created_at ? new Date(inv.created_at).toLocaleDateString() : '—'}</td>
                        <td className="px-4 py-3 font-mono italic">{Number(inv.payment_amount ?? 0).toLocaleString('ar-EG')} EGP</td>
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
                              onClick={() => handleInvoiceAction(inv.id, 'approve')}
                              disabled={actionCenterId === inv.id}
                              className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded-lg disabled:opacity-50"
                            >
                              {t('approve')}
                            </button>
                          )}
                          <button
                            onClick={() => handleInvoiceAction(inv.id, 'reject')}
                            disabled={actionCenterId === inv.id}
                            className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-medium rounded-lg disabled:opacity-50"
                          >
                            {t('reject')}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {pendingInvoices.length === 0 && (
                  <p className="p-8 text-center text-gray-500 dark:text-gray-400">{t('noPendingInvoices', { defaultValue: 'No pending payment proofs.' })}</p>
                )}
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-x-auto">
                <h3 className="p-4 text-lg font-semibold text-gray-800 dark:text-gray-200">{t('paymentHistory')}</h3>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">{t('date')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">{t('centerName')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">Amount</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">Period</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">{t('status')}</th>
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
                  <p className="p-8 text-center text-gray-500 dark:text-gray-400">No payments recorded yet.</p>
                )}
              </div>
            </div>
          )}

          {activeTab === 'plan-requests' && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">{t('centerName')}</th>
                    <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">Current Plan</th>
                    <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">Requested Plan</th>
                    <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">{t('requestedAt')}</th>
                    <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">{t('status')}</th>
                    <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">{t('actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {planRequests.map((pr) => (
                    <tr key={pr.id} className="border-b border-gray-100 dark:border-gray-700/50">
                      <td className="px-4 py-3 text-gray-900 dark:text-white font-medium">{pr.centerName}</td>
                      <td className="px-4 py-3">{PLAN_LABELS[pr.current_plan || 'starter']}</td>
                      <td className="px-4 py-3">{PLAN_LABELS[pr.requested_plan] || pr.requested_plan}</td>
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
                <p className="p-8 text-center text-gray-500 dark:text-gray-400">No plan requests.</p>
              )}
            </div>
          )}

          {activeTab === 'pending' && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6">
              <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">
                {t('pendingSignups')} ({pendingCenters.length})
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">{t('centerName')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">{t('phone')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">{t('email')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">{t('requestedPlan')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">{t('referralCode')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">{t('referredBy')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">{t('date')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">{t('actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingCenters.map((c) => (
                      <tr key={c.id} className="border-b border-gray-100 dark:border-gray-700/50">
                        <td className="px-4 py-3 text-gray-900 dark:text-white">{c.name}</td>
                        <td className="px-4 py-3" dir="ltr">{c.phone || '—'}</td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{c.email || '—'}</td>
                        <td className="px-4 py-3">{PLAN_LABELS[c.plan || 'starter'] || c.plan}</td>
                        <td className="px-4 py-3 font-mono">{c.referral_code_used || '—'}</td>
                        <td className="px-4 py-3">{c.referring_center_name || '—'}</td>
                        <td className="px-4 py-3 text-gray-500">{new Date(c.created_at).toLocaleDateString()}</td>
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
              {pendingCenters.length === 0 && <p className="mt-4 text-gray-500 dark:text-gray-400">{t('noPending')}</p>}
            </div>
          )}

          {activeTab === 'team' && (
            <div className="space-y-6">
              {/* Invite Form */}
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6">
                <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">
                  {t('inviteTeamMember', { defaultValue: 'Invite Team Member' })}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                  <input
                    type="text"
                    placeholder={t('name', { defaultValue: 'Name' })}
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                    className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm"
                  />
                  <input
                    type="text"
                    placeholder={t('phone', { defaultValue: 'Phone (e.g. 01XXXXXXXXX)' })}
                    value={invitePhone}
                    onChange={(e) => setInvitePhone(e.target.value)}
                    className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm"
                    dir="ltr"
                  />
                  <input
                    type="email"
                    placeholder={t('email', { defaultValue: 'Email (optional)' })}
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm"
                    dir="ltr"
                  />
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as 'internal_admin' | 'internal_viewer')}
                    className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm"
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
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">{t('name', { defaultValue: 'Name' })}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">{t('phone', { defaultValue: 'Phone' })}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">{t('email', { defaultValue: 'Email' })}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">{t('role', { defaultValue: 'Role' })}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">{t('joinedDate', { defaultValue: 'Joined' })}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">{t('actions', { defaultValue: 'Actions' })}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {internalTeam.map((m) => (
                      <tr key={m.id} className="border-b border-gray-100 dark:border-gray-700/50">
                        <td className="px-4 py-3 text-gray-900 dark:text-white font-medium">{m.name}</td>
                        <td className="px-4 py-3" dir="ltr">{m.phone || '—'}</td>
                        <td className="px-4 py-3">{m.email || '—'}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 text-xs font-medium italic rounded-full ${
                            m.role === 'super_admin' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300' :
                            m.role === 'internal_admin' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300' :
                            'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
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
                                onChange={(e) => handleChangeInternalRole(m.id, e.target.value)}
                                className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white"
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
                            <span className="text-xs text-gray-500">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {internalTeam.length === 0 && (
                  <p className="p-8 text-center text-gray-500 dark:text-gray-400">{t('noTeamMembers', { defaultValue: 'No internal team members yet.' })}</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {detailCenter && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setDetailCenter(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-lg w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">{t('centerDetails')}</h3>
            <div className="space-y-2 text-sm">
              <p><span className="text-gray-500">{t('centerName')}:</span> {detailCenter.name}</p>
              <p><span className="text-gray-500">{t('phone')}:</span> <span dir="ltr">{detailCenter.phone || detailCenter.owner?.phone || '—'}</span></p>
              <p><span className="text-gray-500">{t('email')}:</span> {detailCenter.email || '—'}</p>
              <p><span className="text-gray-500">Owner:</span> {detailCenter.owner?.name || '—'} ({detailCenter.owner?.phone || '—'})</p>
              <p><span className="text-gray-500">{t('plan')}:</span> {PLAN_LABELS[detailCenter.plan || 'starter']}</p>
              <p><span className="text-gray-500">{t('studentsCount')}:</span> {detailCenter.students_count}</p>
              <p><span className="text-gray-500">{t('lastPayment')}:</span> {detailCenter.last_payment ? new Date(detailCenter.last_payment).toLocaleDateString() : '—'}</p>
              <p><span className="text-gray-500">{t('referralCode')}:</span> {detailCenter.referral_code || '—'}</p>
            </div>
            <button onClick={() => setDetailCenter(null)} className="mt-4 px-4 py-2 bg-gray-200 dark:bg-gray-600 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500">{t('viewDetails')} ✕</button>
          </div>
        </div>
      )}

      {changePlanCenter && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setChangePlanCenter(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-sm w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">{t('changePlan')}</h3>
            <div className="space-y-2">
              {(['starter', 'pro', 'pro_plus', 'enterprise', 'payg'] as const).map((plan) => (
                <button
                  key={plan}
                  onClick={() => handleCenterAction(changePlanCenter.id, 'change_plan', { newPlan: plan })}
                  disabled={actionCenterId === changePlanCenter.id}
                  className="w-full px-3 py-2 text-left bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
                >
                  {PLAN_LABELS[plan]} {plan !== 'payg' && `(EGP ${PLAN_PRICE[plan]?.toLocaleString()}/mo)`}
                </button>
              ))}
            </div>
            <button onClick={() => setChangePlanCenter(null)} className="mt-4 px-4 py-2 bg-gray-200 dark:bg-gray-600 rounded-lg">Cancel</button>
          </div>
        </div>
      )}

      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-sm w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-red-600 dark:text-red-400 mb-4">{t('confirmDelete')}</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">Type: {deleteConfirm.center.name}</p>
            <input
              type="text"
              value={deleteConfirm.name}
              onChange={(e) => setDeleteConfirm({ ...deleteConfirm, name: e.target.value })}
              placeholder={deleteConfirm.center.name}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white mb-4"
            />
            <div className="flex gap-2">
              <button
                onClick={() => handleCenterAction(deleteConfirm.center.id, 'delete', { confirmName: deleteConfirm.name })}
                disabled={deleteConfirm.name !== deleteConfirm.center.name || actionCenterId === deleteConfirm.center.id}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {t('deleteCenters')}
              </button>
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 bg-gray-200 dark:bg-gray-600 rounded-lg">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {markPaidCenter && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setMarkPaidCenter(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-sm w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">{t('markAsPaid')}</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">{markPaidCenter.name} - {(markPaidCenter.amount ?? PLAN_PRICE[markPaidCenter.plan] ?? 4000).toLocaleString('ar-EG')} EGP</p>
            <div className="flex gap-2">
              <button
                onClick={() => handleMarkPaid(markPaidCenter)}
                disabled={actionCenterId === markPaidCenter.id}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {t('markAsPaid')}
              </button>
              <button onClick={() => setMarkPaidCenter(null)} className="px-4 py-2 bg-gray-200 dark:bg-gray-600 rounded-lg">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
