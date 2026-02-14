'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/contexts/UserContext';
import Navbar from '@/components/Navbar';
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

type TabId = 'overview' | 'centers' | 'billing' | 'plan-requests' | 'pending';

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
}

const PLAN_LABELS: Record<string, string> = {
  starter: 'Starter',
  pro: 'Pro',
  pro_plus: 'Pro+',
  enterprise: 'Enterprise',
  payg: 'PAYG',
};
const BILLING_LABELS: Record<string, string> = {
  monthly: 'monthly',
  quarterly: 'quarterly',
  semi_annual: 'Semi-Annual',
  half_yearly: 'Semi-Annual',
  annual: 'Annual',
  yearly: 'Annual',
};
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
  const [actionCenterId, setActionCenterId] = useState<string | null>(null);
  const [detailCenter, setDetailCenter] = useState<CenterRow | null>(null);
  const [changePlanCenter, setChangePlanCenter] = useState<CenterRow | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ center: CenterRow; name: string } | null>(null);
  const [markPaidCenter, setMarkPaidCenter] = useState<BillingCenter | null>(null);

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

  useEffect(() => {
    if (activeTab === 'centers') fetchCenters();
  }, [activeTab, fetchCenters]);

  useEffect(() => {
    if (activeTab === 'plan-requests') fetchPlanRequests();
  }, [activeTab, fetchPlanRequests]);

  useEffect(() => {
    if (activeTab === 'billing') fetchBilling();
  }, [activeTab, fetchBilling]);

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

  if (isLoading || !isAuthorized) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-indigo-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  const tabs: { id: TabId; labelKey: string }[] = [
    { id: 'overview', labelKey: 'overview' },
    { id: 'centers', labelKey: 'centers' },
    { id: 'billing', labelKey: 'billing' },
    { id: 'plan-requests', labelKey: 'planRequests' },
    { id: 'pending', labelKey: 'pendingSignups' },
  ];

  const byPlanData = overview
    ? Object.entries(overview.byPlan || {}).map(([plan, count]) => ({ name: PLAN_LABELS[plan] || plan, count }))
    : [];

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900" dir={isRTL ? 'rtl' : 'ltr'}>
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

          {activeTab === 'centers' && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-4">
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
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('centerName')}</th>
                      <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('phone')}</th>
                      <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('plan')}</th>
                      <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('status')}</th>
                      <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('studentsCount')}</th>
                      <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('billingPeriod')}</th>
                      <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('nextDue')}</th>
                      <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('createdDate')}</th>
                      <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {centers.map((c) => (
                      <tr key={c.id} className="border-b border-gray-100 dark:border-gray-700/50">
                        <td className="px-4 py-3 text-gray-900 dark:text-white font-medium">{c.name}</td>
                        <td className="px-4 py-3" dir="ltr">{c.phone || c.owner?.phone || '—'}</td>
                        <td className="px-4 py-3">{PLAN_LABELS[c.plan || 'starter'] || c.plan}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 ${c.status === 'active' ? 'text-green-600' : c.status === 'suspended' ? 'text-red-600' : 'text-amber-600'}`}>
                            {c.status === 'active' && '✅'}
                            {c.status === 'suspended' && '🔴'}
                            {c.status === 'pending' && '🟡'}
                            {c.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">{c.students_count}</td>
                        <td className="px-4 py-3">
                          {BILLING_LABELS[c.billing_period || 'monthly'] || c.billing_period}
                        </td>
                        <td className="px-4 py-3">{c.next_due ? new Date(c.next_due).toLocaleDateString() : '—'}</td>
                        <td className="px-4 py-3">{new Date(c.created_at).toLocaleDateString()}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            <button
                              onClick={() => setDetailCenter(c)}
                              className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-600 rounded hover:bg-gray-200 dark:hover:bg-gray-500"
                            >
                              {t('viewDetails')}
                            </button>
                            <button
                              onClick={() => setChangePlanCenter(c)}
                              className="px-2 py-1 text-xs bg-indigo-100 dark:bg-indigo-900/50 rounded hover:bg-indigo-200 dark:hover:bg-indigo-800"
                            >
                              {t('changePlan')}
                            </button>
                            {c.status === 'active' && (
                              <button
                                onClick={() => confirm(t('confirmSuspend')) && handleCenterAction(c.id, 'suspend')}
                                disabled={actionCenterId === c.id}
                                className="px-2 py-1 text-xs bg-amber-100 dark:bg-amber-900/50 rounded hover:bg-amber-200"
                              >
                                {t('suspend')}
                              </button>
                            )}
                            {c.status === 'suspended' && (
                              <button
                                onClick={() => handleCenterAction(c.id, 'reactivate')}
                                disabled={actionCenterId === c.id}
                                className="px-2 py-1 text-xs bg-green-100 dark:bg-green-900/50 rounded hover:bg-green-200"
                              >
                                {t('reactivate')}
                              </button>
                            )}
                            <button
                              onClick={() => setDeleteConfirm({ center: c, name: '' })}
                              className="px-2 py-1 text-xs bg-red-100 dark:bg-red-900/50 rounded hover:bg-red-200 text-red-700 dark:text-red-300"
                            >
                              {t('deleteCenters')}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
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
                      <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('centerName')}</th>
                      <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('plan')}</th>
                      <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('billingPeriod')}</th>
                      <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">Discount</th>
                      <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">Monthly Equiv</th>
                      <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('nextDue')}</th>
                      <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">Days Until Due</th>
                      <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">Auto-Suspend Date</th>
                      <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">Referral Credits</th>
                      <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('status')}</th>
                      <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {billingCenters.map((c) => {
                      const nextDue = c.nextDue || c.next_payment_due || c.next_billing_date;
                      const dueDate = nextDue ? new Date(nextDue) : null;
                      const now = new Date();
                      const status = !dueDate ? '—' : dueDate < now ? 'overdue' : dueDate.getTime() - now.getTime() < 7 * 24 * 60 * 60 * 1000 ? 'due_soon' : 'paid';
                      return (
                        <tr key={c.id} className="border-b border-gray-100 dark:border-gray-700/50">
                          <td className="px-4 py-3 text-gray-900 dark:text-white font-medium">{c.name}</td>
                          <td className="px-4 py-3">{PLAN_LABELS[c.plan] || c.plan}</td>
                          <td className="px-4 py-3">{BILLING_LABELS[c.billing_period || 'monthly']}</td>
                          <td className="px-4 py-3">{c.discount ?? 0}%</td>
                          <td className="px-4 py-3">{c.monthlyEquivalent?.toLocaleString('ar-EG') ?? '—'}</td>
                          <td className="px-4 py-3">{nextDue ? new Date(nextDue).toLocaleDateString() : '—'}</td>
                          <td className="px-4 py-3">
                            {(() => {
                              const d = (c as { daysUntilDue?: number }).daysUntilDue;
                              if (d === undefined) return '—';
                              if (d > 5) return <span className="text-green-600 dark:text-green-400">{d}</span>;
                              if (d >= 1) return <span className="text-amber-600 dark:text-amber-400">{d}</span>;
                              return <span className="text-red-600 dark:text-red-400">{d}</span>;
                            })()}
                          </td>
                          <td className="px-4 py-3 text-xs">{(() => { const a = (c as { autoSuspendAt?: string }).autoSuspendAt; return a ? new Date(a).toLocaleString() : '—'; })()}</td>
                          <td className="px-4 py-3 text-green-600 dark:text-green-400">
                            {((c as { referralCredits?: number }).referralCredits ?? 0) > 0
                              ? `${((c as { referralCredits?: number }).referralCredits ?? 0).toLocaleString('ar-EG')} EGP`
                              : '—'}
                          </td>
                          <td className="px-4 py-3">
                            {status === 'overdue' && '🔴'}
                            {status === 'due_soon' && '🟡'}
                            {status === 'paid' && '✅'}
                            {status}
                          </td>
                          <td className="px-4 py-3 flex gap-2">
                            <button
                              onClick={() => setMarkPaidCenter(c)}
                              disabled={actionCenterId === c.id}
                              className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                            >
                              {t('markAsPaid')}
                            </button>
                            <button
                              onClick={() => openWhatsAppReminder(c)}
                              className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                            >
                              {t('sendReminder')}
                            </button>
                            <button
                              onClick={() => handleCenterAction(c.id, 'suspend')}
                              disabled={actionCenterId === c.id}
                              className="px-2 py-1 text-xs bg-amber-600 text-white rounded hover:bg-amber-700"
                            >
                              {t('suspend')}
                            </button>
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
                      <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('centerName')}</th>
                      <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('date')}</th>
                      <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">Amount</th>
                      <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">Reference</th>
                      <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">Proof</th>
                      <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingInvoices.map((inv) => (
                      <tr key={inv.id} className="border-b border-gray-100 dark:border-gray-700/50">
                        <td className="px-4 py-3 text-gray-900 dark:text-white font-medium">{inv.centerName}</td>
                        <td className="px-4 py-3">{inv.created_at ? new Date(inv.created_at).toLocaleDateString() : '—'}</td>
                        <td className="px-4 py-3">{Number(inv.payment_amount ?? 0).toLocaleString('ar-EG')} EGP</td>
                        <td className="px-4 py-3 font-mono">{inv.payment_reference || '—'}</td>
                        <td className="px-4 py-3">
                          {inv.payment_proof_url ? (
                            <a href={inv.payment_proof_url} target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-indigo-400 hover:underline">
                              {t('viewProof', { defaultValue: 'View' })}
                            </a>
                          ) : '—'}
                        </td>
                        <td className="px-4 py-3 flex gap-2">
                          <button
                            onClick={() => handleInvoiceAction(inv.id, 'approve')}
                            disabled={actionCenterId === inv.id}
                            className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded-lg disabled:opacity-50"
                          >
                            {t('approve')}
                          </button>
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
                      <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('date')}</th>
                      <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('centerName')}</th>
                      <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">Amount</th>
                      <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">Period</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paymentHistory.map((p) => (
                      <tr key={p.id} className="border-b border-gray-100 dark:border-gray-700/50">
                        <td className="px-4 py-3">{p.paid_at ? new Date(p.paid_at).toLocaleDateString() : '—'}</td>
                        <td className="px-4 py-3">{p.centerName}</td>
                        <td className="px-4 py-3">{Number(p.amount).toLocaleString('ar-EG')} EGP</td>
                        <td className="px-4 py-3">{p.billing_period}</td>
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
                    <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('centerName')}</th>
                    <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">Current Plan</th>
                    <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">Requested Plan</th>
                    <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('requestedAt')}</th>
                    <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('status')}</th>
                    <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {planRequests.map((pr) => (
                    <tr key={pr.id} className="border-b border-gray-100 dark:border-gray-700/50">
                      <td className="px-4 py-3 text-gray-900 dark:text-white font-medium">{pr.centerName}</td>
                      <td className="px-4 py-3">{PLAN_LABELS[pr.current_plan || 'starter']}</td>
                      <td className="px-4 py-3">{PLAN_LABELS[pr.requested_plan] || pr.requested_plan}</td>
                      <td className="px-4 py-3">{new Date(pr.requested_at).toLocaleDateString()}</td>
                      <td className="px-4 py-3">{pr.status}</td>
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
                      <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('centerName')}</th>
                      <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('phone')}</th>
                      <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('email')}</th>
                      <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('requestedPlan')}</th>
                      <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('referralCode')}</th>
                      <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('referredBy')}</th>
                      <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('date')}</th>
                      <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('actions')}</th>
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
