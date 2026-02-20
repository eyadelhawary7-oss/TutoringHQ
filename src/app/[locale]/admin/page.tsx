'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useLayout } from '@/contexts/LayoutContext';
import { Link } from '@/i18n/routing';
import {
  LayoutDashboard,
  Building2,
  CreditCard,
  FileText,
  Clock,
  Users,
  Search,
  X,
  Check,
  AlertTriangle,
  ExternalLink,
  Trash2,
  MoreVertical,
  ChevronDown,
} from 'lucide-react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import PasswordConfirmModal from '@/components/PasswordConfirmModal';
import { getCsrfHeaders } from '@/lib/csrf-client';

const PLAN_LABELS: Record<string, string> = {
  starter: 'Starter',
  pro: 'Pro',
  business: 'Business',
  enterprise: 'Enterprise',
  top_centers: 'Top Centers',
  payg: 'PAYG',
};

const PLAN_COLORS: Record<string, string> = {
  starter: 'border-gray-400 bg-gray-50 text-gray-700',
  pro: 'border-blue-400 bg-blue-50 text-blue-700',
  business: 'border-teal-400 bg-teal-50 text-teal-700',
  enterprise: 'border-purple-400 bg-purple-50 text-purple-700',
  top_centers: 'border-amber-400 bg-amber-50 text-amber-700',
  payg: 'border-indigo-400 bg-indigo-50 text-indigo-700',
};

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  suspended: 'bg-red-100 text-red-700',
  pending: 'bg-amber-100 text-amber-700',
  trial: 'bg-blue-100 text-blue-700',
  rejected: 'bg-red-100 text-red-700',
};

type AdminTab = 'overview' | 'centers' | 'billing' | 'planRequests' | 'pendingSignups' | 'internalTeam';

const ADMIN_NAV: { key: AdminTab; icon: typeof LayoutDashboard }[] = [
  { key: 'overview', icon: LayoutDashboard },
  { key: 'centers', icon: Building2 },
  { key: 'billing', icon: CreditCard },
  { key: 'planRequests', icon: FileText },
  { key: 'pendingSignups', icon: Clock },
  { key: 'internalTeam', icon: Users },
];

interface OverviewData {
  totalCenters: number;
  activeCenters: number;
  pendingSignups: number;
  totalStudents: number;
  totalMRR?: number;
  mrr?: number;
  signupsChart?: { date: string; count: number }[];
  monthlyRevenue?: { month: string; revenue: number }[];
  recentActivity?: Array<{ id?: string; action?: string; details?: unknown; created_at?: string }>;
}

interface CenterRow {
  id: string;
  name: string;
  phone?: string;
  email?: string | null;
  plan?: string;
  status?: string;
  created_at: string;
  students_count?: number;
  owner?: { name?: string; phone?: string } | null;
  last_payment?: string | null;
  next_due?: string | null;
  billing_period?: string;
  billing_status?: string;
  owner_name?: string | null;
  referral_code?: string | null;
  referral_code_used?: string | null;
  referring_center_name?: string | null;
}

interface BillingRow {
  id: string;
  name: string;
  plan?: string;
  amount?: number;
  billing_period?: string;
  nextDue?: string;
  next_payment_due?: string;
  billing_status?: string;
  status?: string;
}

interface PendingSignup {
  id: string;
  name: string;
  phone?: string;
  email?: string | null;
  plan?: string;
  owner_name?: string | null;
  created_at?: string;
  referral_code_used?: string | null;
  referring_center_name?: string | null;
}

interface PlanRequest {
  id: string;
  center_id: string;
  centerName: string;
  current_plan?: string;
  requested_plan: string;
  status: string;
  requested_at?: string;
  priceDiffFormatted?: string;
}

interface TeamMember {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  role: string;
  created_at?: string;
}

function formatActivitySummary(action: string, details?: unknown): string {
  const d = details as Record<string, unknown> | undefined;
  if (action === 'center_create') return 'New signup';
  if (action === 'admin_invoice_approved') return 'Payment proof approved';
  if (action === 'admin_invoice_rejected') return 'Payment proof rejected';
  if (action === 'payment_on_scan' && d?.method) return `Payment (${d.method})`;
  if (action === 'admin_payment_recorded') return 'Admin payment recorded';
  if (action === 'approve_signup') return 'Signup approved';
  if (action === 'reject_signup') return 'Signup rejected';
  if (action === 'suspend_center') return 'Center suspended';
  if (action === 'reactivate_center') return 'Center reactivated';
  return action?.replace(/_/g, ' ') ?? '';
}

export default function AdminPage() {
  const tAdmin = useTranslations('admin');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const isRTL = locale === 'ar';
  const router = useRouter();
  const { setHideShell } = useLayout();

  const [tab, setTab] = useState<AdminTab>('overview');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [centerSearch, setCenterSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [centers, setCenters] = useState<CenterRow[]>([]);
  const [billingData, setBillingData] = useState<BillingRow[]>([]);
  const [paymentHistory, setPaymentHistory] = useState<Array<{ centerName: string; amount: number; paid_at?: string; billing_period?: string; recorded_by?: string }>>([]);
  const [pendingInvoices, setPendingInvoices] = useState<Array<{ id: string; centerName: string; payment_amount?: number; center_id: string; payment_proof_url?: string }>>([]);
  const [pendingSignups, setPendingSignups] = useState<PendingSignup[]>([]);
  const [planRequests, setPlanRequests] = useState<PlanRequest[]>([]);
  const [internalTeam, setInternalTeam] = useState<TeamMember[]>([]);

  const [detailCenter, setDetailCenter] = useState<CenterRow | null>(null);
  const [showSuspendConfirm, setShowSuspendConfirm] = useState<CenterRow | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<CenterRow | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [showAddAdmin, setShowAddAdmin] = useState(false);
  const [showRejectReason, setShowRejectReason] = useState<PendingSignup | null>(null);
  const [openActionsId, setOpenActionsId] = useState<string | null>(null);
  const [passwordConfirm, setPasswordConfirm] = useState<
    | { type: 'suspend'; center: CenterRow }
    | { type: 'approve_invoice'; inv: { id: string; centerName: string; payment_amount: number } }
    | { type: 'delete'; center: CenterRow; confirmName: string }
    | null
  >(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [addAdminForm, setAddAdminForm] = useState({ name: '', phone: '', email: '' });

  useEffect(() => {
    setHideShell(true);
    return () => setHideShell(false);
  }, [setHideShell]);

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
      const csrf = await getCsrfHeaders(session.access_token);
      Object.assign(headers, csrf);
    }
    return headers;
  }, [getSession]);

  const loadOverview = useCallback(async () => {
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
        router.replace('/dashboard');
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setLoadError(err?.error || 'Failed to load');
        return;
      }
      const data = await res.json();
      setOverview(data);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Network error');
    }
  }, [getSession, router]);

  const loadCenters = useCallback(async () => {
    const session = await getSession();
    if (!session) return;
    const params = new URLSearchParams();
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (centerSearch.trim()) params.set('search', centerSearch.trim());
    try {
      const res = await fetch(`/api/admin/centers?${params}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setCenters(data.centers || data);
    } catch {
      // ignore
    }
  }, [getSession, statusFilter, centerSearch]);

  const loadBilling = useCallback(async () => {
    const session = await getSession();
    if (!session) return;
    try {
      const res = await fetch('/api/admin/billing', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setBillingData(data.centers || []);
      setPaymentHistory(data.paymentHistory || []);
      setPendingInvoices(data.pendingInvoices || []);
    } catch {
      // ignore
    }
  }, [getSession]);

  const loadPendingSignups = useCallback(async () => {
    const session = await getSession();
    if (!session) return;
    try {
      const res = await fetch('/api/admin/pending-signups', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setPendingSignups(data.signups || []);
    } catch {
      // ignore
    }
  }, [getSession]);

  const loadPlanRequests = useCallback(async () => {
    const session = await getSession();
    if (!session) return;
    try {
      const res = await fetch('/api/admin/plan-requests', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setPlanRequests(data.requests || []);
    } catch {
      // ignore
    }
  }, [getSession]);

  const loadInternalTeam = useCallback(async () => {
    const session = await getSession();
    if (!session) return;
    try {
      const res = await fetch('/api/admin/team', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setInternalTeam(data.team || []);
    } catch {
      // ignore
    }
  }, [getSession]);

  useEffect(() => {
    setIsLoading(true);
    loadOverview()
      .then(() => setIsLoading(false))
      .catch(() => setIsLoading(false));
  }, [loadOverview]);

  useEffect(() => {
    if (tab === 'centers') loadCenters();
  }, [tab, loadCenters]);
  useEffect(() => {
    if (tab === 'billing') loadBilling();
  }, [tab, loadBilling]);
  useEffect(() => {
    if (tab === 'pendingSignups') loadPendingSignups();
  }, [tab, loadPendingSignups]);
  useEffect(() => {
    if (tab === 'planRequests') loadPlanRequests();
  }, [tab, loadPlanRequests]);
  useEffect(() => {
    if (tab === 'internalTeam') loadInternalTeam();
  }, [tab, loadInternalTeam]);

  const filteredCenters = centers.filter((c) => {
    const matchSearch = !centerSearch.trim() ||
      c.name?.toLowerCase().includes(centerSearch.toLowerCase()) ||
      c.phone?.includes(centerSearch) ||
      (c.owner?.name ?? c.owner_name ?? '').toLowerCase().includes(centerSearch.toLowerCase());
    const matchStatus = statusFilter === 'all' || (c.status ?? 'active') === statusFilter;
    return matchSearch && matchStatus;
  });

  // Aggregate signupsChart (daily) to weekly for "New Centers per Week"
  const signupsWeekly = useMemo(() => {
    const chart = overview?.signupsChart ?? [];
    if (chart.length === 0) return [];
    const byWeek: Record<number, number> = {};
    for (const { date, count } of chart) {
      if (!date) continue;
      const d = new Date(date);
      const weekStart = new Date(d);
      weekStart.setHours(0, 0, 0, 0);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      const ts = weekStart.getTime();
      byWeek[ts] = (byWeek[ts] ?? 0) + count;
    }
    return Object.entries(byWeek)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([, count], i) => ({ date: `W${i + 1}`, count }));
  }, [overview?.signupsChart]);

  const handleCenterAction = async (
    centerId: string,
    action: 'suspend' | 'reactivate' | 'change_plan' | 'delete' | 'approve' | 'reject',
    extra?: { newPlan?: string; confirmName?: string; password?: string }
  ) => {
    const headers = await getAuthHeaders();
    if (!headers) return;
    setActionLoading(true);
    try {
      const body: Record<string, unknown> = { centerId, action, ...extra };
      const res = await fetch('/api/admin/centers', {
        method: 'PUT',
        headers,
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed');
      if (action === 'approve' && data.credentialsMessage) {
        const waUrl = data.whatsappUrl;
        if (waUrl) window.open(waUrl, '_blank');
      }
      setShowSuspendConfirm(null);
      setShowDeleteConfirm(null);
      setShowRejectReason(null);
      setDetailCenter(null);
      loadCenters();
      if (tab === 'pendingSignups') loadPendingSignups();
      loadOverview();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handlePlanRequestAction = async (requestId: string, action: 'approve' | 'reject') => {
    const headers = await getAuthHeaders();
    if (!headers) return;
    setActionLoading(true);
    try {
      const res = await fetch('/api/admin/plan-requests', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ requestId, action }),
      });
      if (!res.ok) throw new Error((await res.json())?.error || 'Failed');
      loadPlanRequests();
      loadOverview();
      loadCenters();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleMarkPaid = async (centerId: string, amount: number, billingPeriod: string) => {
    const headers = await getAuthHeaders();
    if (!headers) return;
    setActionLoading(true);
    try {
      const res = await fetch('/api/admin/billing', {
        method: 'POST',
        headers,
        body: JSON.stringify({ center_id: centerId, amount, billing_period: billingPeriod }),
      });
      if (!res.ok) throw new Error((await res.json())?.error || 'Failed');
      loadBilling();
      loadOverview();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleInvoiceAction = async (invoiceId: string, action: 'approve' | 'reject', password?: string) => {
    const headers = await getAuthHeaders();
    if (!headers) return;
    setActionLoading(true);
    try {
      const res = await fetch('/api/admin/billing', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ invoiceId, action, password }),
      });
      if (!res.ok) throw new Error((await res.json())?.error || 'Failed');
      setPasswordConfirm(null);
      loadBilling();
      loadOverview();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleAddAdmin = async () => {
    const headers = await getAuthHeaders();
    if (!headers || !addAdminForm.name.trim() || !addAdminForm.phone.trim()) return;
    setActionLoading(true);
    try {
      const res = await fetch('/api/admin/team', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: addAdminForm.name.trim(),
          phone: addAdminForm.phone.replace(/\D/g, ''),
          email: addAdminForm.email.trim() || undefined,
          role: 'internal_admin',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed');
      setShowAddAdmin(false);
      setAddAdminForm({ name: '', phone: '', email: '' });
      loadInternalTeam();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRemoveTeamMember = async (memberId: string) => {
    const headers = await getAuthHeaders();
    if (!headers || !confirm(tAdmin('confirmRemoveTeamMember'))) return;
    setActionLoading(true);
    try {
      const res = await fetch('/api/admin/team', {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ memberId }),
      });
      if (!res.ok) throw new Error((await res.json())?.error || 'Failed');
      loadInternalTeam();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed');
    } finally {
      setActionLoading(false);
    }
  };

  const PlanBadge = ({ plan }: { plan?: string }) => (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${PLAN_COLORS[plan || 'starter'] || PLAN_COLORS.starter}`}>
      {PLAN_LABELS[plan || 'starter'] || plan}
    </span>
  );

  if (isLoading && !overview && !loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (loadError && !overview) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-background">
        <div className="text-center">
          <p className="text-red-600 font-medium mb-2">{loadError}</p>
          <div className="flex gap-3 justify-center">
            <button onClick={loadOverview} className="px-4 py-2 bg-primary text-white rounded-lg">
              {tAdmin('retry')}
            </button>
            <Link href="/dashboard" className="px-4 py-2 border rounded-lg">
              {tAdmin('backToMyCenter')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background animate-fade-in" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Admin Sidebar */}
      <aside className="hidden md:flex flex-col w-56 shrink-0 border-e border-border bg-card">
        <div className="p-4 border-b border-border">
          <h2 className="font-bold text-foreground">{tAdmin('title')}</h2>
          <Link href="/dashboard" className="text-xs text-primary hover:underline mt-1 block">{tAdmin('backToMyCenter')}</Link>
        </div>
        <nav className="flex-1 p-2 space-y-0.5">
          {ADMIN_NAV.map(({ key, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-start ${
                tab === key ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              <Icon size={18} />
              <span>{tAdmin(key)}</span>
            </button>
          ))}
        </nav>
      </aside>

      {/* Mobile tab bar */}
      <div className="md:hidden fixed top-0 start-0 end-0 z-20 border-b border-border overflow-x-auto scrollbar-hide bg-card">
        <div className="flex px-2 py-1.5 gap-1">
          {ADMIN_NAV.map(({ key, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap ${
                tab === key ? 'bg-primary/20 text-primary' : 'text-muted-foreground'
              }`}
            >
              <Icon size={14} />
              <span>{tAdmin(key)}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 p-4 md:p-6 overflow-auto pt-14 md:pt-6">
        {/* Overview */}
        {tab === 'overview' && overview && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
              {[
                { label: tAdmin('totalCenters'), value: String(overview.totalCenters ?? 0), color: '#3B82F6' },
                { label: tAdmin('activeCenters'), value: String(overview.activeCenters ?? 0), color: '#16A34A' },
                { label: tAdmin('pendingSignups'), value: String(overview.pendingSignups ?? 0), color: '#F59E0B' },
                { label: tAdmin('totalMRREgp', { defaultValue: 'Total MRR in EGP' }), value: `${(overview.totalMRR ?? overview.mrr ?? 0).toLocaleString('ar-EG')} ${tCommon('egp')}`, color: '#0D9488' },
                { label: tAdmin('totalStudents'), value: String(overview.totalStudents ?? 0), color: '#7C3AED' },
              ].map(({ label, value, color }) => (
                <div key={label} className="glass p-4 rounded-xl">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-2" style={{ background: `${color}20`, color }}>
                    <LayoutDashboard size={16} />
                  </div>
                  <div className="text-xl font-black font-mono text-foreground">{value}</div>
                  <div className="text-xs text-muted-foreground">{label}</div>
                </div>
              ))}
            </div>

            <div className="grid md:grid-cols-2 gap-4 mb-6">
              {(signupsWeekly.length > 0 || (overview.signupsChart?.length ?? 0) > 0) && (
                <div className="glass p-5 rounded-xl">
                  <h3 className="font-bold text-foreground mb-4">{tAdmin('newCentersPerWeek', { defaultValue: 'New Centers per Week' })}</h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={signupsWeekly.length > 0 ? signupsWeekly : overview.signupsChart!}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Line type="monotone" dataKey="count" stroke="#0D9488" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
              {(overview.monthlyRevenue?.length ?? 0) > 0 && (
                <div className="glass p-5 rounded-xl">
                  <h3 className="font-bold text-foreground mb-4">{tAdmin('monthlyRevenueChart', { defaultValue: 'Monthly Revenue' })}</h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={overview.monthlyRevenue}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="revenue" fill="#0D9488" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {(overview.recentActivity?.length ?? 0) > 0 && (
              <div className="glass p-5 rounded-xl">
                <h3 className="font-bold text-foreground mb-3">{tAdmin('recentActivity')}</h3>
                <div className="space-y-3">
                  {overview.recentActivity!.slice(0, 5).map((a, i) => (
                    <div key={a.id || i} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                      <span className="text-sm text-foreground">
                        {formatActivitySummary(a.action || '', a.details)}
                        {a.details && typeof (a.details as { center_name?: string }).center_name === 'string' ? (
                          <> — {(a.details as { center_name: string }).center_name}</>
                        ) : null}
                      </span>
                      <span className="text-xs text-muted-foreground whitespace-nowrap ms-3">
                        {a.created_at ? new Date(a.created_at).toLocaleDateString() : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Centers */}
        {tab === 'centers' && (
          <>
            <div className="flex flex-wrap gap-3 items-center mb-4">
              <div className="relative flex-1 min-w-[200px]">
                <Search size={15} className="absolute top-1/2 -translate-y-1/2 start-3 text-muted-foreground" />
                <input
                  value={centerSearch}
                  onChange={(e) => setCenterSearch(e.target.value)}
                  placeholder={tAdmin('search', { defaultValue: 'Search centers...' })}
                  className="w-full ps-9 pe-4 py-2.5 rounded-xl border border-border bg-muted text-foreground text-sm"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2.5 rounded-xl border border-border bg-muted text-foreground text-sm"
              >
                <option value="all">{tCommon('all')}</option>
                <option value="active">{tCommon('active')}</option>
                <option value="suspended">{tAdmin('suspended')}</option>
                <option value="pending">{tAdmin('pending')}</option>
              </select>
            </div>

            <div className="glass overflow-hidden rounded-xl">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="text-start px-4 py-3 font-medium text-muted-foreground">{tCommon('name')}</th>
                      <th className="text-start px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Owner</th>
                      <th className="text-start px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">{tCommon('phone')}</th>
                      <th className="text-start px-4 py-3 font-medium text-muted-foreground">Plan</th>
                      <th className="text-start px-4 py-3 font-medium text-muted-foreground">{tCommon('status')}</th>
                      <th className="text-start px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">{tAdmin('studentsCount')}</th>
                      <th className="text-start px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">{tAdmin('createdAt')}</th>
                      <th className="text-start px-4 py-3 font-medium text-muted-foreground">{tCommon('actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCenters.map((c) => (
                      <tr key={c.id} className="border-t border-border hover:bg-muted/30">
                        <td className="px-4 py-3 font-medium text-foreground">{c.name}</td>
                        <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">{c.owner?.name ?? c.owner_name ?? '—'}</td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground hidden lg:table-cell" dir="ltr">{c.phone ?? '—'}</td>
                        <td className="px-4 py-3"><PlanBadge plan={c.plan} /></td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[c.status || 'active'] || STATUS_STYLES.active}`}>
                            {c.status || 'active'}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-muted-foreground hidden md:table-cell">{c.students_count ?? 0}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground hidden lg:table-cell">{c.created_at ? new Date(c.created_at).toLocaleDateString() : '—'}</td>
                        <td className="px-4 py-3">
                          <div className="relative">
                            <button
                              onClick={() => setOpenActionsId(openActionsId === c.id ? null : c.id)}
                              className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"
                              title={tCommon('actions')}
                            >
                              <MoreVertical size={16} />
                            </button>
                            {openActionsId === c.id && (
                              <>
                                <div className="fixed inset-0 z-40" onClick={() => setOpenActionsId(null)} aria-hidden="true" />
                                <div className="absolute top-full end-0 mt-1 z-50 min-w-[180px] py-1 rounded-lg border border-border shadow-lg bg-card">
                                  <button onClick={() => { setDetailCenter(c); setOpenActionsId(null); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted text-start">
                                    <ExternalLink size={14} />{tAdmin('viewDetails')}
                                  </button>
                                  {c.status === 'active' && (
                                    <button onClick={() => { setShowSuspendConfirm(c); setOpenActionsId(null); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted text-start">
                                      <AlertTriangle size={14} />{tAdmin('suspend')}
                                    </button>
                                  )}
                                  {c.status === 'suspended' && (
                                    <button onClick={() => { handleCenterAction(c.id, 'reactivate'); setOpenActionsId(null); }} disabled={actionLoading} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted text-start disabled:opacity-50">
                                      <Check size={14} />{tAdmin('reactivate')}
                                    </button>
                                  )}
                                  <button onClick={() => { /* TODO: Change Plan modal */ setOpenActionsId(null); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted text-start">
                                    <CreditCard size={14} />{tAdmin('changePlan')}
                                  </button>
                                  <button onClick={() => { setShowDeleteConfirm(c); setDeleteConfirmName(''); setOpenActionsId(null); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600  hover:bg-red-50 text-start">
                                    <Trash2 size={14} />{tCommon('delete')}
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* Billing */}
        {tab === 'billing' && (
          <>
            <h2 className="text-lg font-bold text-foreground mb-4">{tAdmin('billing')}</h2>
            <div className="glass overflow-hidden rounded-xl mb-6">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="text-start px-4 py-3 font-medium text-muted-foreground">{tCommon('name')}</th>
                      <th className="text-start px-4 py-3 font-medium text-muted-foreground">Plan</th>
                      <th className="text-start px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">{tAdmin('billingPeriod')}</th>
                      <th className="text-start px-4 py-3 font-medium text-muted-foreground">{tCommon('amount')}</th>
                      <th className="text-start px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">{tAdmin('nextDue')}</th>
                      <th className="text-start px-4 py-3 font-medium text-muted-foreground">{tCommon('status')}</th>
                      <th className="text-start px-4 py-3 font-medium text-muted-foreground">{tCommon('actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {billingData.map((b) => {
                      const isPaid = b.billing_status === 'paid';
                      const nextDueStr = b.nextDue ?? b.next_payment_due;
                      const nextDueDate = nextDueStr ? new Date(nextDueStr) : null;
                      const today = new Date();
                      today.setHours(0, 0, 0, 0);
                      let statusKey: 'paid' | 'overdue' | 'dueSoon' | 'due' = 'due';
                      if (isPaid) statusKey = 'paid';
                      else if (nextDueDate && nextDueDate < today) statusKey = 'overdue';
                      else if (nextDueDate) {
                        const daysUntil = Math.ceil((nextDueDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
                        statusKey = daysUntil <= 7 ? 'dueSoon' : 'due';
                      }
                      const statusConfig = {
                        paid: { label: '✅ Paid', className: STATUS_STYLES.active },
                        overdue: { label: '🔴 Overdue', className: 'bg-red-100 text-red-700' },
                        dueSoon: { label: '🟡 Due Soon', className: 'bg-amber-100 text-amber-700' },
                        due: { label: 'Due', className: 'bg-gray-100 text-gray-700' },
                      };
                      const sc = statusConfig[statusKey];
                      return (
                        <tr key={b.id} className="border-t border-border hover:bg-muted/30">
                          <td className="px-4 py-3 font-medium text-foreground">{b.name}</td>
                          <td className="px-4 py-3"><PlanBadge plan={b.plan} /></td>
                          <td className="px-4 py-3 text-muted-foreground text-xs hidden md:table-cell">{b.billing_period ?? '—'}</td>
                          <td className="px-4 py-3 font-mono font-bold text-foreground">{(b.amount ?? 0).toLocaleString('ar-EG')} {tCommon('egp')}</td>
                          <td className="px-4 py-3 text-xs text-muted-foreground hidden md:table-cell">{nextDueStr ?? '—'}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${sc.className}`}>
                              {sc.label}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex gap-1 flex-wrap">
                              {!isPaid && (
                                <>
                                  <button
                                    onClick={() => handleMarkPaid(b.id, b.amount ?? 0, b.billing_period ?? 'monthly')}
                                    disabled={actionLoading}
                                    className="px-2 py-1 rounded text-xs font-semibold text-white bg-green-600 hover:bg-green-700 disabled:opacity-50"
                                  >
                                    {tAdmin('markAsPaid')}
                                  </button>
                                  <button
                                    onClick={() => { /* TODO: wire /api/admin/billing send-reminder */ }}
                                    disabled={actionLoading}
                                    className="px-2 py-1 rounded text-xs font-semibold border border-border hover:bg-muted disabled:opacity-50"
                                  >
                                    {tAdmin('sendReminder')}
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {pendingInvoices.length > 0 && (
              <>
                <h3 className="font-bold text-foreground mt-6 mb-3">{tAdmin('pendingInvoices')}</h3>
                <div className="glass overflow-hidden rounded-xl mb-6">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted">
                        <tr>
                          <th className="text-start px-4 py-3 font-medium text-muted-foreground">{tCommon('name')}</th>
                          <th className="text-start px-4 py-3 font-medium text-muted-foreground">{tCommon('amount')}</th>
                          <th className="text-start px-4 py-3 font-medium text-muted-foreground">{tCommon('actions')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pendingInvoices.map((inv) => (
                          <tr key={inv.id} className="border-t border-border">
                            <td className="px-4 py-3 font-medium text-foreground">{inv.centerName}</td>
                            <td className="px-4 py-3 font-mono font-bold">{(inv.payment_amount ?? 0).toLocaleString('ar-EG')} {tCommon('egp')}</td>
                            <td className="px-4 py-3 flex gap-1">
                              <button
                                onClick={() => {
                                  if ((inv.payment_amount ?? 0) > 50000) {
                                    setPasswordConfirm({ type: 'approve_invoice', inv: { id: inv.id, centerName: inv.centerName, payment_amount: inv.payment_amount ?? 0 } });
                                  } else {
                                    handleInvoiceAction(inv.id, 'approve');
                                  }
                                }}
                                disabled={actionLoading}
                                className="px-2 py-1 rounded text-xs font-semibold text-white bg-green-600 hover:bg-green-700"
                              >
                                {tAdmin('approvePay')}
                              </button>
                              <button onClick={() => handleInvoiceAction(inv.id, 'reject')} disabled={actionLoading} className="px-2 py-1 rounded text-xs font-semibold text-white bg-red-600 hover:bg-red-700">
                                {tAdmin('rejectPayment')}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}

            <h3 className="font-bold text-foreground mt-6 mb-3">{tAdmin('paymentHistory')}</h3>
            <div className="glass overflow-hidden rounded-xl">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="text-start px-4 py-3 font-medium text-muted-foreground">{tAdmin('createdAt')}</th>
                      <th className="text-start px-4 py-3 font-medium text-muted-foreground">{tCommon('name')}</th>
                      <th className="text-start px-4 py-3 font-medium text-muted-foreground">{tCommon('amount')}</th>
                      <th className="text-start px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">{tAdmin('billingPeriod')}</th>
                      <th className="text-start px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">{tAdmin('recordedBy')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paymentHistory.map((p, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="px-4 py-3 text-xs text-muted-foreground">{p.paid_at ? new Date(p.paid_at).toLocaleDateString() : '—'}</td>
                        <td className="px-4 py-3 font-medium text-foreground">{p.centerName}</td>
                        <td className="px-4 py-3 font-mono font-bold">{p.amount.toLocaleString('ar-EG')} {tCommon('egp')}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground hidden md:table-cell">{p.billing_period ?? '—'}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground hidden lg:table-cell">{p.recorded_by ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* Plan Requests */}
        {tab === 'planRequests' && (
          <>
            <h2 className="text-lg font-bold text-foreground mb-4">{tAdmin('planRequests')}</h2>
            <div className="glass overflow-hidden rounded-xl">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="text-start px-4 py-3 font-medium text-muted-foreground">{tCommon('name')}</th>
                      <th className="text-start px-4 py-3 font-medium text-muted-foreground">Current → Requested</th>
                      <th className="text-start px-4 py-3 font-medium text-muted-foreground">{tAdmin('createdAt')}</th>
                      <th className="text-start px-4 py-3 font-medium text-muted-foreground">{tCommon('status')}</th>
                      <th className="text-start px-4 py-3 font-medium text-muted-foreground">{tCommon('actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {planRequests.map((pr) => (
                      <tr key={pr.id} className="border-t border-border">
                        <td className="px-4 py-3 font-medium text-foreground">{pr.centerName}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <PlanBadge plan={pr.current_plan} />
                            <span className="text-muted-foreground">→</span>
                            <PlanBadge plan={pr.requested_plan} />
                            {pr.priceDiffFormatted && <span className="text-xs text-muted-foreground">{pr.priceDiffFormatted}</span>}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{pr.requested_at ? new Date(pr.requested_at).toLocaleDateString() : '—'}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${pr.status === 'pending' ? STATUS_STYLES.pending : pr.status === 'approved' ? STATUS_STYLES.active : STATUS_STYLES.rejected}`}>
                            {pr.status === 'pending' ? tAdmin('pending') : pr.status === 'approved' ? tAdmin('approved') : tAdmin('rejected')}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {pr.status === 'pending' && (
                            <div className="flex gap-1">
                              <button onClick={() => handlePlanRequestAction(pr.id, 'approve')} disabled={actionLoading} className="px-2 py-1 rounded text-xs font-semibold text-white bg-green-600 hover:bg-green-700">
                                {tAdmin('approve')}
                              </button>
                              <button onClick={() => handlePlanRequestAction(pr.id, 'reject')} disabled={actionLoading} className="px-2 py-1 rounded text-xs font-semibold text-white bg-red-600 hover:bg-red-700">
                                {tAdmin('reject')}
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* Pending Signups */}
        {tab === 'pendingSignups' && (
          <>
            <h2 className="text-lg font-bold text-foreground mb-4">{tAdmin('pendingSignups')}</h2>
            <div className="glass overflow-hidden rounded-xl">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="text-start px-4 py-3 font-medium text-muted-foreground">Center</th>
                      <th className="text-start px-4 py-3 font-medium text-muted-foreground">Owner</th>
                      <th className="text-start px-4 py-3 font-medium text-muted-foreground">{tCommon('phone')}</th>
                      <th className="text-start px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">{tCommon('email')}</th>
                      <th className="text-start px-4 py-3 font-medium text-muted-foreground">Plan</th>
                      <th className="text-start px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">{tAdmin('referredBy')}</th>
                      <th className="text-start px-4 py-3 font-medium text-muted-foreground">{tAdmin('createdAt')}</th>
                      <th className="text-start px-4 py-3 font-medium text-muted-foreground">{tCommon('actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingSignups.map((ps) => (
                      <tr key={ps.id} className="border-t border-border">
                        <td className="px-4 py-3 font-medium text-foreground">{ps.name}</td>
                        <td className="px-4 py-3 text-muted-foreground">{ps.owner_name ?? '—'}</td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground" dir="ltr">{ps.phone ?? '—'}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground hidden md:table-cell">{ps.email ?? '—'}</td>
                        <td className="px-4 py-3"><PlanBadge plan={ps.plan} /></td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground hidden md:table-cell">{ps.referral_code_used ?? ps.referring_center_name ?? '—'}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{ps.created_at ? new Date(ps.created_at).toLocaleDateString() : '—'}</td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1">
                            <button onClick={() => handleCenterAction(ps.id, 'approve')} disabled={actionLoading} className="px-2 py-1 rounded text-xs font-semibold text-white bg-green-600 hover:bg-green-700">
                              {tAdmin('approve')}
                            </button>
                            <button onClick={() => setShowRejectReason(ps)} className="px-2 py-1 rounded text-xs font-semibold text-white bg-red-600 hover:bg-red-700">
                              {tAdmin('reject')}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {pendingSignups.length === 0 && (
                      <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">{tAdmin('noPending')}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* Internal Team */}
        {tab === 'internalTeam' && (
          <>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-foreground">{tAdmin('internalTeam')}</h2>
              <button onClick={() => setShowAddAdmin(true)} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-primary hover:bg-primary/90">
                + {tAdmin('addAdmin', { defaultValue: 'Add Admin' })}
              </button>
            </div>
            <div className="glass overflow-hidden rounded-xl">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="text-start px-4 py-3 font-medium text-muted-foreground">{tCommon('name')}</th>
                    <th className="text-start px-4 py-3 font-medium text-muted-foreground">{tCommon('phone')}</th>
                    <th className="text-start px-4 py-3 font-medium text-muted-foreground">Role</th>
                    <th className="text-start px-4 py-3 font-medium text-muted-foreground">{tAdmin('joinedDate')}</th>
                    <th className="text-start px-4 py-3 font-medium text-muted-foreground">{tCommon('actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {internalTeam.map((m) => (
                    <tr key={m.id} className="border-t border-border">
                      <td className="px-4 py-3 font-medium text-foreground">{m.name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground" dir="ltr">{m.phone ?? m.email ?? '—'}</td>
                      <td className="px-4 py-3"><span className="px-2 py-0.5 rounded-full text-xs font-semibold border border-purple-400 bg-purple-50  text-purple-700 ">{m.role}</span></td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{m.created_at ? new Date(m.created_at).toLocaleDateString() : '—'}</td>
                      <td className="px-4 py-3">
                        {m.role !== 'super_admin' && m.role !== 'admin' && (
                          <button onClick={() => handleRemoveTeamMember(m.id)} disabled={actionLoading} className="px-2 py-1 rounded text-xs font-semibold border border-red-300 text-red-600  hover:bg-red-50">
                            {tAdmin('remove')}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Center Detail Slide-over */}
      {detailCenter && (
        <div className="fixed inset-0 z-50" onClick={() => setDetailCenter(null)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="absolute top-0 end-0 bottom-0 w-full max-w-md overflow-y-auto rounded-s-2xl border-s border-border bg-card" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-border flex items-center justify-between">
              <h2 className="font-bold text-foreground text-lg">{detailCenter.name}</h2>
              <button onClick={() => setDetailCenter(null)} className="p-1.5 rounded-lg hover:bg-muted"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              {[
                { label: 'Owner', value: detailCenter.owner?.name ?? detailCenter.owner_name ?? '—' },
                { label: tCommon('phone'), value: detailCenter.phone ?? '—' },
                { label: tCommon('email'), value: detailCenter.email ?? '—' },
                { label: 'Plan', value: PLAN_LABELS[detailCenter.plan ?? 'starter'] ?? detailCenter.plan },
                { label: tAdmin('billingPeriod'), value: detailCenter.billing_period ?? '—' },
                { label: tAdmin('studentsCount'), value: String(detailCenter.students_count ?? 0) },
                { label: tCommon('status'), value: detailCenter.status ?? '—' },
                { label: tAdmin('nextDue'), value: detailCenter.next_due ?? '—' },
                { label: tAdmin('referralCode'), value: detailCenter.referral_code ?? '—' },
                { label: tAdmin('createdAt'), value: detailCenter.created_at ? new Date(detailCenter.created_at).toLocaleDateString() : '—' },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
                  <p className="font-medium text-foreground">{value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Suspend Confirm */}
      {showSuspendConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowSuspendConfirm(null)}>
          <div className="rounded-2xl border border-border p-6 max-w-sm mx-4 w-full bg-card" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-foreground mb-2">{tAdmin('confirmSuspend')}</h3>
            <p className="text-sm text-muted-foreground mb-4">Are you sure you want to suspend {showSuspendConfirm.name}?</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowSuspendConfirm(null)} className="px-4 py-2 rounded-lg text-sm border border-border">{tCommon('cancel')}</button>
              <button
                onClick={() => setPasswordConfirm({ type: 'suspend', center: showSuspendConfirm })}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-red-600 hover:bg-red-700"
              >
                {tCommon('confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowDeleteConfirm(null)}>
          <div className="rounded-2xl border border-border p-6 max-w-sm mx-4 w-full bg-card" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-foreground mb-2">{tAdmin('deleteCenters')}</h3>
            <p className="text-sm text-muted-foreground mb-3">{tAdmin('confirmDelete')}</p>
            <p className="text-sm mb-2"><strong className="text-foreground">{showDeleteConfirm.name}</strong></p>
            <input
              value={deleteConfirmName}
              onChange={(e) => setDeleteConfirmName(e.target.value)}
              placeholder={showDeleteConfirm.name}
              className="w-full px-3 py-2 rounded-lg border border-border bg-muted text-foreground text-sm mb-3"
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowDeleteConfirm(null)} className="px-4 py-2 rounded-lg text-sm border border-border">{tCommon('cancel')}</button>
              <button
                disabled={deleteConfirmName !== showDeleteConfirm.name}
                onClick={() => {
                  if (deleteConfirmName === showDeleteConfirm.name) {
                    setPasswordConfirm({ type: 'delete', center: showDeleteConfirm, confirmName: deleteConfirmName });
                    setShowDeleteConfirm(null);
                  }
                }}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50"
              >
                {tCommon('delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Admin Modal */}
      {showAddAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowAddAdmin(false)}>
          <div className="rounded-2xl border border-border p-6 max-w-sm mx-4 w-full bg-card" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-foreground mb-4">{tAdmin('inviteTeamMember', { defaultValue: 'Add Admin' })}</h3>
            <p className="text-xs text-muted-foreground mb-3">{tAdmin('noTeamMembers', { defaultValue: 'User must have signed up at CenterHQ first.' })}</p>
            <div className="space-y-3">
              <input
                value={addAdminForm.name}
                onChange={(e) => setAddAdminForm((f) => ({ ...f, name: e.target.value }))}
                placeholder={tCommon('name')}
                className="w-full px-3 py-2.5 rounded-lg border border-border bg-muted text-foreground text-sm"
              />
              <input
                value={addAdminForm.phone}
                onChange={(e) => setAddAdminForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder={tCommon('phone')}
                type="tel"
                dir="ltr"
                className="w-full px-3 py-2.5 rounded-lg border border-border bg-muted text-foreground text-sm"
              />
              <input
                value={addAdminForm.email}
                onChange={(e) => setAddAdminForm((f) => ({ ...f, email: e.target.value }))}
                placeholder={tCommon('email')}
                type="email"
                className="w-full px-3 py-2.5 rounded-lg border border-border bg-muted text-foreground text-sm"
              />
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setShowAddAdmin(false)} className="px-4 py-2 rounded-lg text-sm border border-border">{tCommon('cancel')}</button>
              <button onClick={handleAddAdmin} disabled={actionLoading || !addAdminForm.name.trim() || !addAdminForm.phone.trim()} className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-primary hover:bg-primary/90 disabled:opacity-50">
                {tAdmin('invite')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject Reason Modal */}
      {showRejectReason && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowRejectReason(null)}>
          <div className="rounded-2xl border border-border p-6 max-w-sm mx-4 w-full bg-card" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-foreground mb-3">Rejection Reason</h3>
            <textarea placeholder="Optional reason..." className="w-full px-3 py-2.5 rounded-lg border border-border bg-muted text-foreground text-sm h-24 resize-none mb-4" />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowRejectReason(null)} className="px-4 py-2 rounded-lg text-sm border border-border">{tCommon('cancel')}</button>
              <button
                onClick={() => { handleCenterAction(showRejectReason.id, 'reject'); setShowRejectReason(null); }}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-red-600 hover:bg-red-700"
              >
                {tAdmin('reject')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Password Confirm Modal */}
      {passwordConfirm && (
        <PasswordConfirmModal
          isOpen={!!passwordConfirm}
          onClose={() => setPasswordConfirm(null)}
          title={
            passwordConfirm.type === 'suspend'
              ? tAdmin('confirmSuspend')
              : passwordConfirm.type === 'delete'
                ? tAdmin('deleteCenters')
                : tAdmin('confirmApprovePayment')
          }
          onConfirm={async (password) => {
            if (passwordConfirm.type === 'suspend') {
              await handleCenterAction(passwordConfirm.center.id, 'suspend', { password });
            } else if (passwordConfirm.type === 'delete') {
              await handleCenterAction(passwordConfirm.center.id, 'delete', { confirmName: passwordConfirm.confirmName, password });
            } else {
              await handleInvoiceAction(passwordConfirm.inv.id, 'approve', password);
            }
            setPasswordConfirm(null);
          }}
        />
      )}
    </div>
  );
}
