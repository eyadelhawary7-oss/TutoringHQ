'use client';

import dynamic from 'next/dynamic';
import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import { usePathname } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { canonicalPlanId } from '@/lib/plans';
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
  Target,
  BarChart3,
  Plus,
  Shield,
  ShieldAlert,
  Activity,
  TrendingUp,
  Eye,
  Menu,
  ArrowLeft,
  CheckCircle,
  XCircle,
  BadgeCheck,
  Bell,
  MessageCircle,
  ChevronDown,
  IdCard,
  ChevronUp,
  Download,
} from 'lucide-react';
import { ChartCard, ChartLegend } from '@/components/charts';

const AreaChartComponent = dynamic(
  () => import('@/components/charts').then((m) => ({ default: m.AreaChartComponent })),
  { ssr: false, loading: () => <div className="chq-skeleton h-48 w-full rounded-xl" /> },
);
const BarChartComponent = dynamic(
  () => import('@/components/charts').then((m) => ({ default: m.BarChartComponent })),
  { ssr: false, loading: () => <div className="chq-skeleton h-48 w-full rounded-xl" /> },
);
const DonutChart = dynamic(
  () => import('@/components/charts').then((m) => ({ default: m.DonutChart })),
  { ssr: false, loading: () => <div className="chq-skeleton h-48 w-full rounded-xl" /> },
);
import PasswordConfirmModal from '@/components/PasswordConfirmModal';
import { AdminSidebar, type AdminTab } from '@/components/AdminSidebar';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { ALL_ADMIN_PERMISSIONS } from '@/lib/admin-roles';
import { PlanBadge, BillingStatusBadge } from '@/components/shared';
import { getCsrfHeaders } from '@/lib/csrf-client';
import type { AdminCardOrderRow } from '@/types/admin-card-orders';

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  suspended: 'bg-red-100 text-red-700',
  pending: 'bg-amber-100 text-amber-700',
  trial: 'bg-blue-100 text-blue-700',
  rejected: 'bg-red-100 text-red-700',
};

interface OverviewData {
  totalCenters: number;
  activeCenters: number;
  pendingSignups: number;
  suspendedCenters?: number;
  totalStudents: number;
  totalMRR?: number;
  mrr?: number;
  signupsChart?: { date: string; count: number }[];
  monthlyRevenue?: { month: string; revenue: number }[];
  recentActivity?: Array<{ id?: string; action?: string; details?: unknown; created_at?: string }>;
  totalRevenueCollected?: number;
  revenueThisMonth?: number;
  pendingRevenue?: number;
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
  last_active?: string;
  usage_scans?: number;
  is_blacklisted?: boolean;
  blacklist_reason?: string | null;
}

interface SalesLead {
  id: string;
  name: string;
  contact_person: string;
  phone: string;
  area: string;
  source: string;
  stage: 'prospect' | 'contacted' | 'demo_scheduled' | 'converted';
  notes: string;
}

const AREAS = ['Nasr City', 'Heliopolis', 'Maadi', '6th October', 'Sheikh Zayed', 'Dokki', 'Mohandeseen', 'Other'];
const SOURCES = ['Referral', 'Walk-in', 'WhatsApp', 'Social Media', 'Cold Call', 'Other'];
const AREA_LABELS: Record<string, string> = {
  'Nasr City': 'القاهرة - مدينة نصر',
  Heliopolis: 'القاهرة - مصر الجديدة',
  Maadi: 'القاهرة - المعادي',
  '6th October': 'الجيزة - أكتوبر',
  'Sheikh Zayed': 'الجيزة - الشيخ زايد',
  Dokki: 'القاهرة - الدقي',
  Mohandeseen: 'القاهرة - المهندسين',
  Other: 'غيره',
};
const SOURCE_LABELS: Record<string, string> = {
  Referral: 'إحالة',
  'Walk-in': 'زيارة ميدانية',
  WhatsApp: 'واتساب',
  'Social Media': 'تواصل اجتماعي',
  'Cold Call': 'توصية',
  Other: 'غيره',
};

interface BillingRow {
  id: string;
  name: string;
  phone?: string;
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
  custom_permissions?: string[];
  created_at?: string;
}

function CardOrderPreview({
  students,
  centerName,
  centerLogo,
}: {
  students: Array<{ id: string; name: string; student_number?: string; qr_code?: string | null }>;
  centerName: string;
  centerLogo: string | null;
}) {
  const tCommon = useTranslations('common');
  const tAdmin = useTranslations('admin');
  const [side, setSide] = useState<'front' | 'back'>('front');
  const first = students[0];
  const initials = centerName.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div className="flex items-center gap-4">
      <div className="relative w-48 aspect-[85.6/54] rounded-xl overflow-hidden shadow-lg border border-border bg-[var(--color-surface-1)]">
        {side === 'front' ? (
          <>
            <div className="absolute top-0 left-0 right-0 h-[20%] bg-gradient-to-br from-teal-600 to-teal-700" />
            <div className="absolute top-0 left-0 right-0 h-[20%] flex items-center justify-between px-2 py-1">
              {centerLogo ? <img src={centerLogo} alt="" className="h-5 w-5 object-contain" /> : <div className="h-5 w-5 rounded-full bg-teal-600 flex items-center justify-center text-white text-[8px] font-bold">{initials}</div>}
              <span className="text-white text-[10px] font-medium truncate">{centerName}</span>
            </div>
            <div className="absolute inset-0 flex flex-col items-center justify-center pt-[12%]">
              <div className="w-16 h-16 bg-[var(--color-surface-1)] rounded flex items-center justify-center">
                {first?.qr_code ? <img src={first.qr_code} alt="" className="w-14 h-14" /> : <div className="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />}
              </div>
              <div className="mt-1 text-xs font-bold text-[var(--color-text-primary)] truncate max-w-full px-1">
                {first?.name ?? tCommon('notAvailable')}
              </div>
              <div className="text-[9px] font-mono text-teal-600">{first?.student_number ?? tCommon('notSet')}</div>
            </div>
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--color-surface-1)]">
            {centerLogo ? <img src={centerLogo} alt="" className="w-16 h-16 object-contain" /> : <div className="w-12 h-12 rounded-full bg-teal-600 flex items-center justify-center text-white text-sm font-bold">{initials}</div>}
            <div className="mt-1 font-bold text-[var(--color-text-primary)] text-xs">{centerName}</div>
            <div className="absolute bottom-1 text-[6px] text-[var(--color-text-tertiary)]">{tAdmin('poweredByCenterHQ')}</div>
          </div>
        )}
      </div>
      <div className="flex gap-1">
        <button onClick={() => setSide('front')} className={`px-2 py-1 rounded text-xs ${side === 'front' ? 'bg-primary text-white' : 'bg-[var(--color-surface-2)]'} btn-press chq-focus`}>{tAdmin('front')}</button>
        <button onClick={() => setSide('back')} className={`px-2 py-1 rounded text-xs ${side === 'back' ? 'bg-primary text-white' : 'bg-[var(--color-surface-2)]'} btn-press chq-focus`}>{tAdmin('back')}</button>
      </div>
    </div>
  );
}

function formatActivitySummary(
  action: string,
  details: unknown | undefined,
  t: (key: string, values?: Record<string, string | number>) => string,
): string {
  const d = details as Record<string, unknown> | undefined;
  if (action === 'center_create') return t('activityNewSignup');
  if (action === 'admin_invoice_approved') return t('activityPaymentProofApproved');
  if (action === 'admin_invoice_rejected') return t('activityPaymentProofRejected');
  if (action === 'payment_on_scan' && d?.method)
    return t('activityPaymentOnScan', { method: String(d.method) });
  if (action === 'admin_payment_recorded') return t('activityAdminPaymentRecorded');
  if (action === 'approve_signup') return t('activitySignupApproved');
  if (action === 'reject_signup') return t('activitySignupRejected');
  if (action === 'suspend_center') return t('activityCenterSuspended');
  if (action === 'reactivate_center') return t('activityCenterReactivated');
  return action?.replace(/_/g, ' ') ?? '';
}

function centerStatusLabel(
  status: string | undefined,
  t: (key: string) => string,
): string {
  const s = (status || 'active').toLowerCase();
  if (s === 'active') return t('active');
  if (s === 'suspended') return t('suspended');
  if (s === 'pending') return t('pending');
  if (s === 'trial') return t('trial');
  if (s === 'rejected') return t('rejected');
  return status || t('active');
}

export default function AdminPage() {
  const tAdmin = useTranslations('admin');
  const tCommon = useTranslations('common');
  const tIdCards = useTranslations('idCards');
  const tCharts = useTranslations('charts');
  const tSettings = useTranslations('settings');
  const locale = useLocale();
  const isRTL = locale === 'ar';
  const router = useRouter();
  const pathname = usePathname();
  const { setHideShell } = useLayout();

  const [tab, setTab] = useState<AdminTab>('overview');
  const [viewingProof, setViewingProof] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [centerSearch, setCenterSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [filterPlan, setFilterPlan] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('newest');
  const [centersPage, setCentersPage] = useState(1);
  const [centersTotalPages, setCentersTotalPages] = useState(1);
  const [analyticsCenters, setAnalyticsCenters] = useState<CenterRow[]>([]);
  const [analyticsCentersLoading, setAnalyticsCentersLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkAction, setBulkAction] = useState('');
  const [bulkMessage, setBulkMessage] = useState('');
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [centers, setCenters] = useState<CenterRow[]>([]);
  const [billingData, setBillingData] = useState<BillingRow[]>([]);
  const [paymentHistory, setPaymentHistory] = useState<Array<{ centerName: string; amount: number; paid_at?: string; billing_period?: string; recorded_by?: string }>>([]);
  const [pendingInvoices, setPendingInvoices] = useState<Array<{ id: string; centerName: string; payment_amount?: number; center_id: string; payment_proof_url?: string | null }>>([]);
  const [pendingSignups, setPendingSignups] = useState<PendingSignup[]>([]);
  const [planRequests, setPlanRequests] = useState<PlanRequest[]>([]);
  const [internalTeam, setInternalTeam] = useState<TeamMember[]>([]);

  const [detailCenter, setDetailCenter] = useState<CenterRow | null>(null);
  const [showSuspendConfirm, setShowSuspendConfirm] = useState<CenterRow | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [showAddAdmin, setShowAddAdmin] = useState(false);
  const [showRejectReason, setShowRejectReason] = useState<PendingSignup | null>(null);
  const [openActionsId, setOpenActionsId] = useState<string | null>(null);
  const [blacklistModal, setBlacklistModal] = useState<CenterRow | null>(null);
  const [blacklistReasonInput, setBlacklistReasonInput] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState<
    | { type: 'suspend'; center: CenterRow }
    | { type: 'approve_invoice'; inv: { id: string; centerName: string; payment_amount: number } }
    | null
  >(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [changePlanModal, setChangePlanModal] = useState<{ centerId: string; centerName: string; currentPlan: string } | null>(null);
  const [newPlan, setNewPlan] = useState('');
  const [changingPlan, setChangingPlan] = useState(false);
  const [addAdminForm, setAddAdminForm] = useState({ name: '', phone: '', email: '' });
  const [selectedRole, setSelectedRole] = useState<string>('internal_viewer');
  const [customPerms, setCustomPerms] = useState<string[]>([]);
  const [cardOrders, setCardOrders] = useState<AdminCardOrderRow[]>([]);
  const [cardOrdersUnread, setCardOrdersUnread] = useState(0);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string } | null>(null);
  const [leads, setLeads] = useState<SalesLead[]>([]);
  const [showAddLead, setShowAddLead] = useState(false);
  const [selectedLead, setSelectedLead] = useState<SalesLead | null>(null);
  const [addLeadForm, setAddLeadForm] = useState<{ name: string; contactPerson: string; phone: string; area: string; source: string; stage: SalesLead['stage']; notes: string }>({ name: '', contactPerson: '', phone: '', area: '', source: '', stage: 'prospect', notes: '' });
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
    const params = new URLSearchParams({
      page: String(centersPage),
      limit: '50',
    });
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (filterPlan !== 'all') params.set('plan', filterPlan);
    if (centerSearch.trim()) params.set('search', centerSearch.trim());
    if (sortBy === 'oldest') params.set('sort', 'oldest');
    try {
      const res = await fetch(`/api/admin/centers?${params}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setCenters(data.centers ?? []);
      const tp = data.pagination?.total_pages ?? 0;
      setCentersTotalPages(Math.max(1, tp || 1));
    } catch {
      // ignore
    }
  }, [getSession, centersPage, statusFilter, filterPlan, centerSearch, sortBy]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [centersPage, statusFilter, filterPlan, centerSearch]);

  const toggleAllCenterSelection = useCallback(() => {
    setSelectedIds((prev) => {
      const pageIds = centers.map((c) => c.id);
      if (pageIds.length === 0) return prev;
      const allOnPageSelected = pageIds.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allOnPageSelected) {
        for (const id of pageIds) next.delete(id);
      } else {
        for (const id of pageIds) next.add(id);
      }
      return next;
    });
  }, [centers]);

  const toggleOneCenterSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const executeBulkAction = useCallback(async () => {
    if (!bulkAction || selectedIds.size === 0) return;
    setBulkLoading(true);
    setBulkError(null);
    const headers = await getAuthHeaders(true);
    if (!headers) {
      setBulkLoading(false);
      setBulkError(tAdmin('bulk.errors.unauthorized'));
      return;
    }
    try {
      const res = await fetch('/api/admin/centers/bulk', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: bulkAction,
          center_ids: Array.from(selectedIds),
          ...(bulkAction === 'send_wa' && { message: bulkMessage }),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        errorKey?: string;
        error?: string;
        errors?: string[];
      };
      if (!res.ok) {
        setBulkError(
          data.errorKey
            ? tAdmin(data.errorKey)
            : (data.error ?? tAdmin('bulk.errors.unknown')),
        );
        setBulkLoading(false);
        return;
      }
      if (Array.isArray(data.errors) && data.errors.length > 0) {
        setBulkError(
          tAdmin('bulk.completedWithErrors', {
            count: data.errors.length.toLocaleString('en-US'),
          }),
        );
      }
      setBulkLoading(false);
      setSelectedIds(new Set());
      setBulkAction('');
      setBulkMessage('');
      await loadCenters();
    } catch {
      setBulkError(tAdmin('bulk.errors.unknown'));
      setBulkLoading(false);
    }
  }, [bulkAction, bulkMessage, getAuthHeaders, loadCenters, selectedIds, tAdmin]);

  const loadAnalyticsCenters = useCallback(async () => {
    const session = await getSession();
    if (!session) return;
    setAnalyticsCentersLoading(true);
    try {
      const all: CenterRow[] = [];
      let pageNum = 1;
      let hasNext = true;
      while (hasNext && pageNum <= 200) {
        const params = new URLSearchParams({ page: String(pageNum), limit: '100' });
        const res = await fetch(`/api/admin/centers?${params}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) break;
        const data = await res.json();
        const batch = (data.centers ?? []) as CenterRow[];
        all.push(...batch);
        hasNext = Boolean(data.pagination?.has_next);
        pageNum += 1;
      }
      setAnalyticsCenters(all);
    } catch {
      setAnalyticsCenters([]);
    } finally {
      setAnalyticsCentersLoading(false);
    }
  }, [getSession]);

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

  const loadCardOrders = useCallback(async () => {
    const session = await getSession();
    if (!session) return;
    try {
      const res = await fetch('/api/admin/card-orders', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setCardOrders(data.orders || []);
    } catch {
      // ignore
    }
  }, [getSession]);

  const playNewOrderChime = useCallback(() => {
    try {
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)();
      const freqs = [523, 659, 784];
      let t = 0;
      freqs.forEach((freq) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = freq;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.15, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.15);
        osc.start(t);
        osc.stop(t + 0.15);
        t += 0.15;
      });
    } catch {
      // ignore
    }
  }, []);

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
    if (tab === 'analytics') loadAnalyticsCenters();
  }, [tab, loadAnalyticsCenters]);

  useEffect(() => {
    setCentersPage(1);
  }, [statusFilter, filterPlan]);
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
  useEffect(() => {
    if (tab === 'cardOrders') {
      loadCardOrders();
      setCardOrdersUnread(0);
    }
  }, [tab, loadCardOrders]);

  useEffect(() => {
    const channel = supabase
      .channel('card_orders_realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'card_orders' },
        async (payload) => {
          const newRow = payload.new as Record<string, unknown>;
          const centerId = newRow?.center_id as string;
          let centerName = 'Unknown';
          if (centerId) {
            try {
              const { data: center } = await supabase.from('centers').select('name').eq('id', centerId).single();
              centerName = (center as { name?: string })?.name ?? centerName;
            } catch {
              // ignore
            }
          }
          setCardOrdersUnread((c) => c + 1);
          playNewOrderChime();
          setToast({ msg: `🪪 ${tAdmin('cardOrdersNewOrder', { defaultValue: 'New card order from' })} ${centerName}!` });
          setTimeout(() => setToast(null), 5000);
          loadCardOrders();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadCardOrders, playNewOrderChime, tAdmin]);

  const PLAN_SORT_ORDER: Record<string, number> = {
    nano: 1, starter: 2, pro: 3, business: 4, enterprise: 5, top_centers: 6,
  };

  const displayedCenters = useMemo(() => {
    let result = [...centers];
    if (sortBy === 'plan_high') {
      result.sort(
        (a, b) =>
          (PLAN_SORT_ORDER[canonicalPlanId(b.plan)] ?? 0) - (PLAN_SORT_ORDER[canonicalPlanId(a.plan)] ?? 0),
      );
    } else if (sortBy === 'plan_low') {
      result.sort(
        (a, b) =>
          (PLAN_SORT_ORDER[canonicalPlanId(a.plan)] ?? 0) - (PLAN_SORT_ORDER[canonicalPlanId(b.plan)] ?? 0),
      );
    }
    return result;
  }, [centers, sortBy]);

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

  const overviewSignupData = useMemo(() => {
    if (signupsWeekly.length > 0) return signupsWeekly;
    return overview?.signupsChart ?? [];
  }, [signupsWeekly, overview?.signupsChart]);

  const signupTrendPct = useMemo(() => {
    const d = overviewSignupData;
    if (d.length < 2) return undefined;
    const last = Number(d[d.length - 1]?.count ?? 0);
    const prev = Number(d[d.length - 2]?.count ?? 0);
    if (prev === 0) return last > 0 ? 100 : 0;
    return Math.round(((last - prev) / prev) * 10000) / 100;
  }, [overviewSignupData]);

  const monthlyRevTrendPct = useMemo(() => {
    const m = overview?.monthlyRevenue ?? [];
    if (m.length < 2) return undefined;
    const last = Number(m[m.length - 1]?.revenue ?? 0);
    const prev = Number(m[m.length - 2]?.revenue ?? 0);
    if (prev === 0) return last > 0 ? 100 : 0;
    return Math.round(((last - prev) / prev) * 10000) / 100;
  }, [overview?.monthlyRevenue]);

  const adminPlanDonutData = useMemo(() => {
    const planIds = ['nano', 'starter', 'pro', 'business', 'enterprise', 'top_centers'] as const;
    const planColors = ['#94A3B8', '#6B7280', '#3B82F6', '#0D9488', '#7C3AED', '#F59E0B'] as const;
    const label: Record<(typeof planIds)[number], string> = {
      nano: tSettings('planNames.nano'),
      starter: tSettings('planNames.starter'),
      pro: tSettings('planNames.pro'),
      business: tSettings('planNames.business'),
      enterprise: tSettings('planNames.enterprise'),
      top_centers: tSettings('planNames.top_centers'),
    };
    return planIds.map((id, i) => ({
      name: label[id],
      value: analyticsCenters.filter((c) => c.plan === id).length,
      color: planColors[i],
    }));
  }, [analyticsCenters, tSettings]);

  const adminStatusDonutData = useMemo(
    () => [
      {
        name: tAdmin('subActive'),
        value: analyticsCenters.filter((c) => (c.status ?? 'active') === 'active').length,
        color: '#16A34A',
      },
      {
        name: tAdmin('subPending'),
        value: analyticsCenters.filter((c) => c.status === 'pending').length,
        color: '#F59E0B',
      },
      {
        name: tAdmin('subSuspended'),
        value: analyticsCenters.filter((c) => c.status === 'suspended').length,
        color: '#DC2626',
      },
    ],
    [analyticsCenters, tAdmin],
  );

  const topStudentsBarData = useMemo(
    () =>
      [...analyticsCenters]
        .sort((a, b) => (b.students_count ?? 0) - (a.students_count ?? 0))
        .slice(0, 5)
        .map((c) => ({ name: c.name, students_count: c.students_count ?? 0 })),
    [analyticsCenters],
  );

  const topRevenueProxyBarData = useMemo(
    () =>
      [...analyticsCenters]
        .filter((c) => (c.status ?? 'active') === 'active')
        .sort((a, b) => (b.students_count ?? 0) - (a.students_count ?? 0))
        .slice(0, 5)
        .map((c) => ({ name: c.name, students_count: c.students_count ?? 0 })),
    [analyticsCenters],
  );

  const activityActionLabel = useMemo(
    () =>
      ({
        signup_rejected: tAdmin('signupRejected'),
        'Signup rejected': tAdmin('signupRejected'),
        reject_signup: tAdmin('signupRejected'),
        student_create: tAdmin('studentCreate'),
        'student create': tAdmin('studentCreate'),
        center_update: tAdmin('centerUpdate'),
        'center update': tAdmin('centerUpdate'),
      }) as Record<string, string>,
    [tAdmin]
  );

  const handleDeleteCenter = async (centerId: string) => {
    setDeleteConfirm(null);
    const headers = await getAuthHeaders();
    if (!headers) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/admin/centers?id=${centerId}`, {
        method: 'DELETE',
        headers,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      setCenters((prev) => prev.filter((c) => c.id !== centerId));
      loadOverview();
      setToast({ msg: tAdmin('centerDeleted', { defaultValue: 'Center deleted successfully' }) });
      setTimeout(() => setToast(null), 3000);
    } catch (err) {
      console.error('Delete error:', err);
      alert('Failed to delete center: ' + (err as Error).message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleBlacklistCenter = async () => {
    if (!blacklistModal) return;
    const reason = blacklistReasonInput.trim();
    if (!reason) {
      alert(tAdmin('blacklistReasonRequired'));
      return;
    }
    const headers = await getAuthHeaders(false);
    if (!headers) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/admin/centers/${blacklistModal.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ action: 'blacklist', blacklist_reason: reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Blacklist failed');
      setBlacklistModal(null);
      setBlacklistReasonInput('');
      setOpenActionsId(null);
      loadCenters();
      setToast({ msg: tAdmin('centerBlacklistedToast') });
      setTimeout(() => setToast(null), 3000);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Blacklist failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCenterAction = async (
    centerId: string,
    action: 'suspend' | 'reactivate' | 'change_plan' | 'approve' | 'reject',
    extra?: { newPlan?: string; password?: string }
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
      setDeleteConfirm(null);
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

  const sendWhatsAppReminder = (
    centerPhone: string,
    centerName: string,
    amount: number,
    nextDue: string
  ) => {
    // Normalize phone - strip everything except digits
    let phone = centerPhone.replace(/\D/g, '');
    // Ensure Egyptian country code
    if (phone.startsWith('0')) phone = '2' + phone; // 01x -> 201x
    if (!phone.startsWith('20')) phone = '20' + phone;
    const formattedAmount = amount.toLocaleString('en-US');
    const formattedDue = new Date(nextDue).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric'
    });
    const message = encodeURIComponent(
      `السلام عليكم ${centerName} 👋\n\n` +
      `نود تذكيركم بأن دفعة اشتراككم في CenterHQ بقيمة *${formattedAmount} ${locale === 'ar' ? 'ج.م' : 'EGP'}* مستحقة بتاريخ *${formattedDue}*.\n\n` +
      `يمكنكم تسوية الدفع ورفع إثبات الدفع من خلال:\n` +
      `🔗 https://center-hq.vercel.app/settings/billing\n\n` +
      `شكراً لثقتكم بـ CenterHQ 🙏`
    );
    const waUrl = `https://wa.me/${phone}?text=${message}`;
    window.open(waUrl, '_blank', 'noopener,noreferrer');
  };

  const contactViaWhatsApp = (phone: string, centerName: string) => {
    let normalized = phone.replace(/\D/g, '');
    if (normalized.startsWith('0')) normalized = '2' + normalized;
    if (!normalized.startsWith('20')) normalized = '20' + normalized;
    const message = encodeURIComponent(
      `السلام عليكم 👋\n\n` +
      `شكراً لتسجيلكم في CenterHQ!\n\n` +
      `نود التواصل معكم لإتمام إعداد حساب "${centerName}" والتعرف على احتياجاتكم.\n\n` +
      `متى يناسبكم التحدث؟ 🙏`
    );
    window.open(`https://wa.me/${normalized}?text=${message}`, '_blank', 'noopener,noreferrer');
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
          role: selectedRole,
          custom_permissions: selectedRole === 'custom' ? customPerms : [],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed');
      setShowAddAdmin(false);
      setAddAdminForm({ name: '', phone: '', email: '' });
      setSelectedRole('internal_viewer');
      setCustomPerms([]);
      loadInternalTeam();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCardOrderStatusUpdate = async (orderId: string, status: string) => {
    const headers = await getAuthHeaders();
    if (!headers) return;
    setActionLoading(true);
    try {
      const res = await fetch('/api/admin/card-orders', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ id: orderId, status }),
      });
      if (!res.ok) throw new Error((await res.json())?.error || 'Failed');
      loadCardOrders();
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

  if (isLoading && !overview && !loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-surface-0)]">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (loadError && !overview) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--color-surface-0)]">
        <div className="text-center">
          <p className="text-red-600 font-medium mb-2">{loadError}</p>
          <div className="flex gap-3 justify-center">
            <button onClick={loadOverview} className="px-4 py-2 bg-primary text-white rounded-lg btn-press chq-focus">
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
    <div className="flex flex-col flex-1 min-h-0 min-h-screen w-full bg-[var(--color-surface-0)] animate-fade-in" dir={isRTL ? 'rtl' : 'ltr'}>
      <AdminHeader />
      <div className="flex flex-col lg:flex-row flex-1">
        <AdminSidebar activeTab={tab} onTabChange={setTab} activeRoute={pathname ?? undefined} />

      {/* Toast for new card order */}
      {toast && (
        <div className="fixed bottom-4 start-4 end-4 md:start-auto md:end-4 md:max-w-sm z-50 p-4 rounded-xl bg-[var(--color-surface-1)] border border-border shadow-lg animate-fade-in">
          <p className="text-sm font-medium text-[var(--color-text-primary)]">{toast.msg}</p>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 min-w-0 p-4 md:p-6 overflow-auto lg:ms-56">
        {/* Overview */}
        {tab === 'overview' && overview && (
          <>
            {/* Section: PLATFORM HEALTH */}
            <div className="flex items-center gap-3 mb-4">
              <span className="text-xs font-semibold tracking-widest text-[var(--color-text-secondary)] uppercase">{tAdmin('platformHealth')}</span>
              <div className="flex-1 h-px bg-[var(--color-border-subtle)]" />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
              {[
                { label: tAdmin('totalCenters'), value: String(overview.totalCenters ?? 0), iconBg: 'bg-teal-100', iconColor: 'text-teal-600', Icon: Building2 },
                { label: tAdmin('activeCenters'), value: String(overview.activeCenters ?? 0), iconBg: 'bg-green-100', iconColor: 'text-green-600', Icon: LayoutDashboard },
                { label: tAdmin('pendingSignups'), value: String(overview.pendingSignups ?? 0), iconBg: 'bg-amber-100', iconColor: 'text-amber-600', Icon: Clock },
                { label: tAdmin('suspendedCenters', { defaultValue: 'Suspended Centers' }), value: String(overview.suspendedCenters ?? 0), iconBg: 'bg-red-100', iconColor: 'text-red-600', Icon: AlertTriangle },
                { label: tAdmin('totalStudents'), value: String(overview.totalStudents ?? 0), iconBg: 'bg-blue-100', iconColor: 'text-blue-600', Icon: Users },
              ].map(({ label, value, iconBg, iconColor, Icon }) => (
                <div key={label} className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm p-6">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm text-[var(--color-text-secondary)] mb-1">{label}</p>
                      <p className="text-2xl font-bold text-[var(--color-text-primary)] font-mono">{value}</p>
                    </div>
                    <div className={`p-3 rounded-full ${iconBg}`}>
                      <Icon className={`w-5 h-5 ${iconColor}`} />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Section: REVENUE */}
            <div className="flex items-center gap-3 mb-4">
              <span className="text-xs font-semibold tracking-widest text-[var(--color-text-secondary)] uppercase">{tAdmin('revenue')}</span>
              <div className="flex-1 h-px bg-[var(--color-border-subtle)]" />
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
              <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm p-6">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-[var(--color-text-secondary)] mb-1">{tAdmin('mrr')}</p>
                    <p className="text-2xl font-bold text-[var(--color-text-primary)] font-mono">{(overview.totalMRR ?? overview.mrr ?? 0).toLocaleString('en-US')} {tCommon('egp')}</p>
                  </div>
                  <div className="p-3 rounded-full bg-green-100">
                    <TrendingUp className="w-5 h-5 text-green-600" />
                  </div>
                </div>
              </div>
              <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm p-6">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-[var(--color-text-secondary)] mb-1">{tAdmin('outstandingInvoices')}</p>
                    <p className="text-2xl font-bold text-[var(--color-text-primary)] font-mono">
                      {(overview.pendingRevenue ?? 0).toLocaleString('en-US')} {tCommon('egp')}
                    </p>
                  </div>
                  <div className="p-3 rounded-full bg-red-100">
                    <AlertTriangle className="w-5 h-5 text-red-600" />
                  </div>
                </div>
              </div>
              <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm p-6">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-[var(--color-text-secondary)] mb-1">{tAdmin('collectedThisMonth')}</p>
                    <p className="text-2xl font-bold text-[var(--color-text-primary)] font-mono">
                      {(overview.revenueThisMonth ?? 0).toLocaleString('en-US')} {tCommon('egp')}
                    </p>
                  </div>
                  <div className="p-3 rounded-full bg-teal-100">
                    <CreditCard className="w-5 h-5 text-teal-600" />
                  </div>
                </div>
              </div>
              <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm p-6">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-[var(--color-text-secondary)] mb-1">{tAdmin('collectionRate')}</p>
                    <p className="text-2xl font-bold text-[var(--color-text-primary)] font-mono">
                      {overview.totalRevenueCollected != null &&
                      overview.pendingRevenue != null &&
                      overview.totalRevenueCollected + overview.pendingRevenue > 0
                        ? Math.round(
                            (overview.totalRevenueCollected /
                              (overview.totalRevenueCollected + overview.pendingRevenue)) *
                              100
                          )
                        : 0}
                      %
                    </p>
                  </div>
                  <div className="p-3 rounded-full bg-blue-100">
                    <BarChart3 className="w-5 h-5 text-blue-600" />
                  </div>
                </div>
              </div>
            </div>

            {/* Section: SECURITY & ALERTS */}
            <div className="flex items-center gap-3 mb-4">
              <span className="text-xs font-semibold tracking-widest text-[var(--color-text-secondary)] uppercase">{tAdmin('securityAlerts')}</span>
              <div className="flex-1 h-px bg-[var(--color-border-subtle)]" />
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
              <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm p-6">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-[var(--color-text-secondary)] mb-1">{tAdmin('failedLogins24h')}</p>
                    <p className="text-2xl font-bold text-[var(--color-text-primary)] font-mono">0</p>
                  </div>
                  <div className="p-3 rounded-full bg-orange-100">
                    <Shield className="w-5 h-5 text-orange-600" />
                  </div>
                </div>
              </div>
              <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm p-6">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-[var(--color-text-secondary)] mb-1">{tAdmin('newSignups7d')}</p>
                    <p className="text-2xl font-bold text-[var(--color-text-primary)] font-mono">{overview.pendingSignups ?? 0}</p>
                  </div>
                  <div className="p-3 rounded-full bg-purple-100">
                    <Users className="w-5 h-5 text-purple-600" />
                  </div>
                </div>
              </div>
              <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm p-6">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-[var(--color-text-secondary)] mb-1">{tAdmin('flaggedActivity')}</p>
                    <p className="text-2xl font-bold text-[var(--color-text-primary)] font-mono">0</p>
                  </div>
                  <div className="p-3 rounded-full bg-red-100">
                    <ShieldAlert className="w-5 h-5 text-red-600" />
                  </div>
                </div>
              </div>
              <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm p-6">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-[var(--color-text-secondary)] mb-1">{tAdmin('systemStatus')}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
                      </span>
                      <span className="text-sm font-semibold text-[var(--color-text-primary)]">{tAdmin('allSystemsOperational')}</span>
                    </div>
                  </div>
                  <div className="p-3 rounded-full bg-green-100">
                    <Activity className="w-5 h-5 text-green-600" />
                  </div>
                </div>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4 mb-6">
              {overviewSignupData.length > 0 && (
                <ChartCard
                  title={tAdmin('newCentersPerWeek')}
                  value={Number(overviewSignupData[overviewSignupData.length - 1]?.count ?? 0)}
                  trend={signupTrendPct}
                  trendLabel={tCharts('vsLastWeek')}
                  minHeight={220}
                >
                  <AreaChartComponent
                    data={overviewSignupData}
                    dataKey="count"
                    xKey="date"
                    height={200}
                    color="teal"
                    showGrid={false}
                  />
                </ChartCard>
              )}
              {(overview.monthlyRevenue?.length ?? 0) > 0 && overview.monthlyRevenue && (
                <ChartCard
                  title={tCharts('monthlyRevenue')}
                  valuePrefix="EGP "
                  value={Number(overview.monthlyRevenue[overview.monthlyRevenue.length - 1]?.revenue ?? 0)}
                  trend={monthlyRevTrendPct}
                  trendLabel={tCharts('vsLastMonth')}
                  minHeight={220}
                >
                  <BarChartComponent
                    data={overview.monthlyRevenue}
                    dataKey="revenue"
                    xKey="month"
                    height={200}
                    color="teal"
                    prefix="EGP "
                    showGrid
                  />
                </ChartCard>
              )}
            </div>

            {(overview.recentActivity?.length ?? 0) > 0 && (
              <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm p-6">
                <h3 className="font-bold text-[var(--color-text-primary)] mb-3">{tAdmin('recentActivity')}</h3>
                <div className="space-y-3">
                  {overview.recentActivity!.slice(0, 5).map((a, i) => (
                    <div key={a.id || i} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                      <span className="text-sm text-[var(--color-text-primary)]">
                        {activityActionLabel[a.action ?? ''] ?? formatActivitySummary(a.action || '', a.details, tAdmin)}
                        {a.details && typeof (a.details as { center_name?: string }).center_name === 'string' ? (
                          <> - {(a.details as { center_name: string }).center_name}</>
                        ) : null}
                      </span>
                      <span className="text-xs text-[var(--color-text-secondary)] whitespace-nowrap ms-3">
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
            <div className="flex flex-wrap gap-2 items-center justify-end mb-3">
              <a
                href="/api/admin/export/centers"
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-0)] border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] rounded-lg text-sm transition-colors"
              >
                <Download className="w-4 h-4 shrink-0" />
                {tAdmin('exportCenters')}
              </a>
              <a
                href="/api/admin/export/invoices"
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-0)] border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] rounded-lg text-sm transition-colors"
              >
                <Download className="w-4 h-4 shrink-0" />
                {tAdmin('exportInvoices')}
              </a>
              <a
                href="/api/admin/export/commissions"
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-0)] border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] rounded-lg text-sm transition-colors"
              >
                <Download className="w-4 h-4 shrink-0" />
                {tAdmin('exportCommissions')}
              </a>
            </div>
            <div className="flex gap-3 flex-wrap mb-3">
              <select
                value={filterPlan}
                onChange={(e) => {
                  setFilterPlan(e.target.value);
                  setCentersPage(1);
                }}
                className="px-3 py-1.5 text-sm border border-[var(--color-border-subtle)] rounded-lg bg-[var(--color-surface-1)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                <option value="all">كل الخطط</option>
                <option value="nano">ناشئ</option>
                <option value="starter">سنتر صغير</option>
                <option value="pro">سنتر متوسط</option>
                <option value="business">سنتر كبير</option>
                <option value="enterprise">سنتر ضخم</option>
                <option value="top_centers">ميجا سنتر</option>
              </select>
              <select
                value={sortBy}
                onChange={(e) => {
                  setSortBy(e.target.value);
                  setCentersPage(1);
                }}
                className="px-3 py-1.5 text-sm border border-[var(--color-border-subtle)] rounded-lg bg-[var(--color-surface-1)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                <option value="newest">الأحدث أولاً</option>
                <option value="oldest">الأقدم أولاً</option>
                <option value="plan_high">الخطة: الأعلى أولاً</option>
                <option value="plan_low">الخطة: الأدنى أولاً</option>
              </select>
            </div>
            <div className="flex flex-wrap gap-3 items-center mb-4">
              <div className="relative flex-1 min-w-[200px]">
                <Search size={15} className="absolute top-1/2 -translate-y-1/2 start-3 text-[var(--color-text-secondary)]" />
                <input
                  type="search"
                  value={centerSearch}
                  onChange={(e) => {
                    setCenterSearch(e.target.value);
                    setCentersPage(1);
                  }}
                  placeholder={tAdmin('searchCenters')}
                  className="w-full ps-9 pe-4 py-2.5 rounded-xl border border-border bg-[var(--color-surface-2)] text-[var(--color-text-primary)] text-sm"
                />
              </div>
              <div className="flex gap-1 flex-wrap">
                {['all', 'active', 'pending', 'suspended', 'at_risk'].map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      setStatusFilter(s);
                      setCentersPage(1);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${statusFilter === s ? 'bg-primary/20 text-primary' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]'} btn-press chq-focus`}
                  >
                    {s === 'all' ? tCommon('all') : s === 'at_risk' ? (tAdmin('atRisk') ?? 'At Risk') : s === 'active' ? tCommon('active') : s === 'pending' ? tAdmin('pending') : tAdmin('suspended')}
                  </button>
                ))}
              </div>
            </div>

            {selectedIds.size > 0 && (
              <div className="flex items-center gap-3 flex-wrap bg-primary/10 border border-primary/25 rounded-xl p-4 mb-4">
                <span className="text-primary text-sm font-medium">
                  {selectedIds.size.toLocaleString('en-US')} {tAdmin('selected')}
                </span>
                <select
                  value={bulkAction}
                  onChange={(e) => setBulkAction(e.target.value)}
                  className="px-3 py-1.5 text-sm border border-[var(--color-border-subtle)] rounded-lg bg-[var(--color-surface-2)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">{tAdmin('bulkSelectAction')}</option>
                  <option value="approve">{tAdmin('bulkApprove')}</option>
                  <option value="suspend">{tAdmin('bulkSuspend')}</option>
                  <option value="reactivate">{tAdmin('bulkReactivate')}</option>
                  <option value="send_wa">{tAdmin('bulkSendWA')}</option>
                </select>
                {bulkAction === 'send_wa' && (
                  <input
                    type="text"
                    value={bulkMessage}
                    onChange={(e) => setBulkMessage(e.target.value)}
                    placeholder={tAdmin('bulkWAMessage')}
                    className="flex-1 min-w-[12rem] px-3 py-1.5 text-sm border border-[var(--color-border-subtle)] rounded-lg bg-[var(--color-surface-2)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                )}
                {bulkError ? (
                  <span className="text-red-600 text-xs">{bulkError}</span>
                ) : null}
                <button
                  type="button"
                  onClick={() => void executeBulkAction()}
                  disabled={
                    bulkLoading ||
                    !bulkAction ||
                    (bulkAction === 'send_wa' && !bulkMessage.trim())
                  }
                  className="px-4 py-1.5 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground rounded-lg text-sm font-medium transition-colors btn-press chq-focus"
                >
                  {bulkLoading ? tAdmin('applying') : tAdmin('applyAction')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedIds(new Set());
                    setBulkError(null);
                  }}
                  className="px-3 py-1.5 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-0)] text-[var(--color-text-primary)] rounded-lg text-sm transition-colors border border-[var(--color-border-subtle)] btn-press chq-focus"
                >
                  {tAdmin('clearSelection')}
                </button>
              </div>
            )}

            <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-0)]">
                      <th className="py-3 px-4 w-10" aria-label={tAdmin('bulkSelectAction')}>
                        <input
                          type="checkbox"
                          checked={centers.length > 0 && centers.every((c) => selectedIds.has(c.id))}
                          onChange={toggleAllCenterSelection}
                          className="rounded border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] text-primary focus:ring-primary"
                        />
                      </th>
                      <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{tCommon('name')}</th>
                      <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider hidden md:table-cell">{tAdmin('owner')}</th>
                      <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider hidden lg:table-cell">{tCommon('phone')}</th>
                      <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{tAdmin('plan')}</th>
                      <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{tCommon('status')}</th>
                      <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider hidden md:table-cell">{tAdmin('studentsCount')}</th>
                      <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider hidden lg:table-cell">{tAdmin('lastActive') ?? 'Last Active'}</th>
                      <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider hidden lg:table-cell">{tAdmin('usage') ?? 'Usage'}</th>
                      <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider hidden lg:table-cell">{tAdmin('createdAt')}</th>
                      <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{tCommon('actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border-subtle)]">
                    {displayedCenters.map((c) => (
                      <tr key={c.id} className="hover:bg-[var(--color-surface-0)] transition-colors">
                        <td className="py-3.5 px-4 w-10 align-middle">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(c.id)}
                            onChange={() => toggleOneCenterSelection(c.id)}
                            className="rounded border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] text-primary focus:ring-primary"
                          />
                        </td>
                        <td className="py-3.5 px-4 text-sm text-[var(--color-text-primary)] font-medium">
                          <span className="inline-flex flex-wrap items-center gap-2">
                            {c.name}
                            {c.is_blacklisted ? (
                              <span className="inline-flex rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-red-600 text-white">
                                {tAdmin('blacklisted')}
                              </span>
                            ) : null}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-sm text-[var(--color-text-secondary)] hidden md:table-cell">
                          {c.owner?.name ?? c.owner_name ?? tCommon('notAvailable')}
                        </td>
                        <td className="py-3.5 px-4 font-mono text-xs text-[var(--color-text-secondary)] hidden lg:table-cell" dir="ltr">
                          {c.phone ?? tCommon('notSet')}
                        </td>
                        <td className="py-3.5 px-4"><PlanBadge plan={c.plan} /></td>
                        <td className="py-3.5 px-4">
                          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[c.status || 'active'] || STATUS_STYLES.active}`}>
                            {centerStatusLabel(c.status, tAdmin)}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-sm text-[var(--color-text-secondary)] font-mono hidden md:table-cell">{c.students_count ?? 0}</td>
                        <td
                          className={`py-3.5 px-4 text-xs hidden lg:table-cell ${
                            (c.last_active?.includes('days') || c.last_active === 'Never')
                              ? 'text-red-600 font-semibold'
                              : 'text-[var(--color-text-secondary)]'
                          }`}
                        >
                          {c.last_active ?? tCommon('never')}
                        </td>
                        <td className="py-3.5 px-4 font-mono text-xs text-[var(--color-text-secondary)] hidden lg:table-cell">{c.usage_scans ?? 0}</td>
                        <td className="py-3.5 px-4 text-xs text-[var(--color-text-secondary)] hidden lg:table-cell">
                          {c.created_at ? new Date(c.created_at).toLocaleDateString() : tCommon('notSet')}
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="flex items-center justify-end gap-3">
                            <div className="relative">
                              <button
                                onClick={() => setOpenActionsId(openActionsId === c.id ? null : c.id)}
                                className="p-1.5 rounded-lg hover:bg-[var(--color-surface-2)] text-[var(--color-text-secondary)] btn-press chq-focus"
                                title={tCommon('actions')}
                              >
                                <MoreVertical size={16} />
                              </button>
                            {openActionsId === c.id && (
                              <>
                                <div className="fixed inset-0 z-40" onClick={() => setOpenActionsId(null)} aria-hidden="true" />
                                <div className="absolute top-full end-0 mt-1 z-50 min-w-[180px] py-1 rounded-lg border border-border shadow-lg bg-[var(--color-surface-1)]">
                                  <button onClick={() => { setDetailCenter(c); setOpenActionsId(null); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-surface-2)] text-start btn-press chq-focus">
                                    <ExternalLink size={14} />{tAdmin('viewDetails')}
                                  </button>
                                  {c.status === 'active' && (
                                    <button onClick={() => { setShowSuspendConfirm(c); setOpenActionsId(null); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-surface-2)] text-start btn-press chq-focus">
                                      <AlertTriangle size={14} />{tAdmin('suspend')}
                                    </button>
                                  )}
                                  {!c.is_blacklisted && (
                                    <button
                                      onClick={() => {
                                        setBlacklistModal(c);
                                        setBlacklistReasonInput('');
                                        setOpenActionsId(null);
                                      }}
                                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 text-start btn-press chq-focus"
                                    >
                                      <ShieldAlert size={14} />
                                      {tAdmin('blacklistMenu')}
                                    </button>
                                  )}
                                  {c.status === 'suspended' && (
                                    <button onClick={() => { handleCenterAction(c.id, 'reactivate'); setOpenActionsId(null); }} disabled={actionLoading} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-surface-2)] text-start disabled:opacity-50 btn-press chq-focus">
                                      <Check size={14} />{tAdmin('reactivate')}
                                    </button>
                                  )}
                                  <button onClick={() => { setChangePlanModal({ centerId: c.id, centerName: c.name ?? '', currentPlan: c.plan ?? 'starter' }); setOpenActionsId(null); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-surface-2)] text-start btn-press chq-focus">
                                    <CreditCard size={14} />{tAdmin('changePlan')}
                                  </button>
                                  <button onClick={() => { setDeleteConfirm(c.id); setOpenActionsId(null); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600  hover:bg-red-50 text-start btn-press chq-focus">
                                    <Trash2 size={14} />{tCommon('delete')}
                                  </button>
                                </div>
                              </>
                            )}
                            </div>
                            <Link
                              href={`/admin/centers/${c.id}`}
                              className="text-teal-400 hover:text-teal-300 text-sm font-medium transition-colors shrink-0"
                            >
                              {tAdmin('centersManage')}
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {centersTotalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--color-border-subtle)]">
                  <span className="text-sm text-[var(--color-text-secondary)]">
                    {tAdmin('pageOf', { page: centersPage, total: centersTotalPages })}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setCentersPage((p) => Math.max(1, p - 1))}
                      disabled={centersPage === 1}
                      className="px-3 py-1.5 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-0)] disabled:opacity-40 text-[var(--color-text-primary)] rounded-lg text-sm transition-colors border border-[var(--color-border-subtle)] btn-press chq-focus"
                    >
                      {tAdmin('prevPage')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setCentersPage((p) => Math.min(centersTotalPages, p + 1))}
                      disabled={centersPage === centersTotalPages}
                      className="px-3 py-1.5 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-0)] disabled:opacity-40 text-[var(--color-text-primary)] rounded-lg text-sm transition-colors border border-[var(--color-border-subtle)] btn-press chq-focus"
                    >
                      {tAdmin('nextPage')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* Billing */}
        {tab === 'billing' && (
          <>
            <h2 className="text-lg font-bold text-[var(--color-text-primary)] mb-4">{tAdmin('billing')}</h2>
            <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm overflow-hidden mb-6">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-0)]">
                      <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{tCommon('name')}</th>
                      <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{tAdmin('plan')}</th>
                      <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider hidden md:table-cell">{tAdmin('billingPeriod')}</th>
                      <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{tCommon('amount')}</th>
                      <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider hidden md:table-cell">{tAdmin('nextDue')}</th>
                      <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{tCommon('status')}</th>
                      <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{tCommon('actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border-subtle)]">
                    {billingData.map((b) => {
                      const isPaid = b.billing_status === 'paid';
                      const nextDueStr = b.nextDue ?? b.next_payment_due ?? '';
                      const billingStatus = b.billing_status ?? b.status ?? 'active';
                      return (
                        <tr key={b.id} className="hover:bg-[var(--color-surface-0)] transition-colors">
                          <td className="py-3.5 px-4 text-sm text-[var(--color-text-primary)] font-medium">{b.name}</td>
                          <td className="py-3.5 px-4"><PlanBadge plan={b.plan} /></td>
                          <td className="py-3.5 px-4 text-sm text-[var(--color-text-secondary)] hidden md:table-cell">
                            {b.billing_period ?? tCommon('notSet')}
                          </td>
                          <td className="py-3.5 px-4 font-mono font-bold text-[var(--color-text-primary)]">{(b.amount ?? 0).toLocaleString('en-US')} {tCommon('egp')}</td>
                          <td className="py-3.5 px-4 text-sm text-[var(--color-text-secondary)] hidden md:table-cell">
                            {nextDueStr || tCommon('notSet')}
                          </td>
                          <td className="py-3.5 px-4">
                            <BillingStatusBadge status={isPaid ? 'paid' : (billingStatus === 'overdue' ? 'overdue' : 'active')} nextDue={nextDueStr || new Date().toISOString()} />
                          </td>
                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-2 flex-nowrap">
                              {!isPaid && (
                                <button
                                  onClick={() => handleMarkPaid(b.id, b.amount ?? 0, b.billing_period ?? 'monthly')}
                                  disabled={actionLoading}
                                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg whitespace-nowrap transition-all shadow-sm disabled:opacity-50 btn-press chq-focus"
                                >
                                  <BadgeCheck className="w-4 h-4" />
                                  {tAdmin('markAsPaid')}
                                </button>
                              )}
                              <button
                                onClick={() => sendWhatsAppReminder(b.phone ?? '', b.name ?? '', b.amount ?? 0, nextDueStr || '')}
                                disabled={actionLoading}
                                className="inline-flex items-center gap-1.5 px-4 py-2 border border-[var(--color-border-default)] hover:bg-[var(--color-surface-0)] hover:border-[var(--color-border-strong)] text-[var(--color-text-primary)] text-sm font-semibold rounded-lg whitespace-nowrap transition-all disabled:opacity-50 btn-press chq-focus"
                              >
                                <Bell className="w-4 h-4" />
                                {tAdmin('sendReminder')}
                              </button>
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
                <h3 className="font-bold text-[var(--color-text-primary)] mt-6 mb-3">{tAdmin('pendingInvoices')}</h3>
                <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm overflow-hidden mb-6">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-0)]">
                          <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{tCommon('name')}</th>
                          <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{tCommon('amount')}</th>
                          <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{tCommon('actions')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--color-border-subtle)]">
                        {pendingInvoices.map((inv) => (
                          <tr key={inv.id} className="hover:bg-[var(--color-surface-0)] transition-colors">
                            <td className="py-3.5 px-4 text-sm text-[var(--color-text-primary)] font-medium">{inv.centerName}</td>
                            <td className="py-3.5 px-4 font-mono font-bold text-[var(--color-text-primary)]">{(inv.payment_amount ?? 0).toLocaleString('en-US')} {tCommon('egp')}</td>
                            <td className="py-3.5 px-4">
                              <div className="flex items-center gap-2 flex-nowrap">
                                {inv.payment_proof_url ? (
                                  <button
                                    onClick={() => setViewingProof(inv.payment_proof_url || null)}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold rounded-lg whitespace-nowrap transition-colors border border-blue-200 btn-press chq-focus"
                                  >
                                    <Eye className="w-3.5 h-3.5" /> {tAdmin('viewProof')}
                                  </button>
                                ) : (
                                  <span className="text-xs text-[var(--color-text-tertiary)] px-3">{tAdmin('noImage')}</span>
                                )}
                                <button
                                  onClick={() => {
                                    if ((inv.payment_amount ?? 0) > 50000) {
                                      setPasswordConfirm({ type: 'approve_invoice', inv: { id: inv.id, centerName: inv.centerName, payment_amount: inv.payment_amount ?? 0 } });
                                    } else {
                                      handleInvoiceAction(inv.id, 'approve');
                                    }
                                  }}
                                  disabled={actionLoading}
                                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-700 active:bg-green-800 text-white text-sm font-semibold rounded-lg whitespace-nowrap transition-all shadow-sm hover:shadow-md disabled:opacity-50 btn-press chq-focus"
                                >
                                  <CheckCircle className="w-4 h-4" />
                                  {tAdmin('approvePay')}
                                </button>
                                <button
                                  onClick={() => handleInvoiceAction(inv.id, 'reject')}
                                  disabled={actionLoading}
                                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white text-sm font-semibold rounded-lg whitespace-nowrap transition-all shadow-sm hover:shadow-md disabled:opacity-50 btn-press chq-focus"
                                >
                                  <XCircle className="w-4 h-4" />
                                  {tAdmin('rejectPayment')}
                                </button>
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

            <h3 className="font-bold text-[var(--color-text-primary)] mt-6 mb-3">{tAdmin('paymentHistory')}</h3>
            <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-0)]">
                      <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{tAdmin('createdAt')}</th>
                      <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{tCommon('name')}</th>
                      <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{tCommon('amount')}</th>
                      <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider hidden md:table-cell">{tAdmin('billingPeriod')}</th>
                      <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider hidden lg:table-cell">{tAdmin('recordedBy')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border-subtle)]">
                    {paymentHistory.map((p, i) => (
                      <tr key={i} className="hover:bg-[var(--color-surface-0)] transition-colors">
                        <td className="py-3.5 px-4 text-sm text-[var(--color-text-secondary)]">
                          {p.paid_at ? new Date(p.paid_at).toLocaleDateString() : tCommon('notSet')}
                        </td>
                        <td className="py-3.5 px-4 text-sm text-[var(--color-text-primary)] font-medium">{p.centerName}</td>
                        <td className="py-3.5 px-4 font-mono font-bold text-[var(--color-text-primary)]">{p.amount.toLocaleString('en-US')} {tCommon('egp')}</td>
                        <td className="py-3.5 px-4 text-sm text-[var(--color-text-secondary)] hidden md:table-cell">
                          {p.billing_period ?? tCommon('notSet')}
                        </td>
                        <td className="py-3.5 px-4 text-sm text-[var(--color-text-secondary)] hidden lg:table-cell">
                          {p.recorded_by ?? tCommon('notSet')}
                        </td>
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
            <h2 className="text-lg font-bold text-[var(--color-text-primary)] mb-4">{tAdmin('planRequests')}</h2>
            <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-0)]">
                      <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{tCommon('name')}</th>
                      <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">Current → Requested</th>
                      <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{tAdmin('createdAt')}</th>
                      <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{tCommon('status')}</th>
                      <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{tCommon('actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border-subtle)]">
                    {planRequests.map((pr) => (
                      <tr key={pr.id} className="hover:bg-[var(--color-surface-0)] transition-colors">
                        <td className="py-3.5 px-4 text-sm text-[var(--color-text-primary)] font-medium">{pr.centerName}</td>
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-2">
                            <PlanBadge plan={pr.current_plan} />
                            <span className="text-[var(--color-text-secondary)]">→</span>
                            <PlanBadge plan={pr.requested_plan} />
                            {pr.priceDiffFormatted && <span className="text-xs text-[var(--color-text-secondary)]">{pr.priceDiffFormatted}</span>}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-sm text-[var(--color-text-secondary)]">
                          {pr.requested_at ? new Date(pr.requested_at).toLocaleDateString() : tCommon('notSet')}
                        </td>
                        <td className="py-3.5 px-4">
                          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${pr.status === 'pending' ? STATUS_STYLES.pending : pr.status === 'approved' ? STATUS_STYLES.active : STATUS_STYLES.rejected}`}>
                            {pr.status === 'pending' ? tAdmin('pending') : pr.status === 'approved' ? tAdmin('approved') : tAdmin('rejected')}
                          </span>
                        </td>
                        <td className="py-3.5 px-4">
                          {pr.status === 'pending' && (
                            <div className="flex items-center gap-2 flex-nowrap">
                              <button onClick={() => handlePlanRequestAction(pr.id, 'approve')} disabled={actionLoading} className="inline-flex items-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-700 active:bg-green-800 text-white text-sm font-semibold rounded-lg whitespace-nowrap transition-all shadow-sm hover:shadow-md disabled:opacity-50 btn-press chq-focus">
                                <CheckCircle className="w-4 h-4" />
                                {tAdmin('approve')}
                              </button>
                              <button onClick={() => handlePlanRequestAction(pr.id, 'reject')} disabled={actionLoading} className="inline-flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white text-sm font-semibold rounded-lg whitespace-nowrap transition-all shadow-sm hover:shadow-md disabled:opacity-50 btn-press chq-focus">
                                <XCircle className="w-4 h-4" />
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
            <h2 className="text-lg font-bold text-[var(--color-text-primary)] mb-4">{tAdmin('pendingSignups')}</h2>
            <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-0)]">
                      <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{tAdmin('center')}</th>
                      <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{tAdmin('owner')}</th>
                      <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{tCommon('phone')}</th>
                      <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider hidden md:table-cell">{tAdmin('email')}</th>
                      <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{tAdmin('plan')}</th>
                      <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider hidden md:table-cell">{tAdmin('referredBy')}</th>
                      <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{tAdmin('createdAt')}</th>
                      <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{tCommon('actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border-subtle)]">
                    {pendingSignups.map((ps) => (
                      <tr key={ps.id} className="hover:bg-[var(--color-surface-0)] transition-colors">
                        <td className="py-3.5 px-4 text-sm text-[var(--color-text-primary)] font-medium">{ps.name}</td>
                        <td className="py-3.5 px-4 text-sm text-[var(--color-text-secondary)]">
                          {ps.owner_name ?? tCommon('notAvailable')}
                        </td>
                        <td className="py-3.5 px-4 font-mono text-xs text-[var(--color-text-secondary)]" dir="ltr">
                          {ps.phone ?? tCommon('notSet')}
                        </td>
                        <td className="py-3.5 px-4 text-sm text-[var(--color-text-secondary)] hidden md:table-cell">
                          {ps.email ?? tCommon('notSet')}
                        </td>
                        <td className="py-3.5 px-4"><PlanBadge plan={ps.plan} /></td>
                        <td className="py-3.5 px-4 font-mono text-xs text-[var(--color-text-secondary)] hidden md:table-cell">
                          {ps.referral_code_used ?? ps.referring_center_name ?? tCommon('notSet')}
                        </td>
                        <td className="py-3.5 px-4 text-sm text-[var(--color-text-secondary)]">
                          {ps.created_at ? new Date(ps.created_at).toLocaleDateString() : tCommon('notSet')}
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-2 flex-nowrap">
                            <button
                              onClick={() => contactViaWhatsApp(ps.phone ?? '', ps.name ?? '')}
                              className="inline-flex items-center gap-1.5 px-3 py-2 bg-green-500 hover:bg-green-600 text-white text-xs font-semibold rounded-lg whitespace-nowrap transition-all shadow-sm btn-press chq-focus"
                              title={tAdmin('contactWhatsApp', { defaultValue: 'Contact on WhatsApp' })}
                            >
                              <MessageCircle className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline">WhatsApp</span>
                            </button>
                            <button onClick={() => handleCenterAction(ps.id, 'approve')} disabled={actionLoading} className="inline-flex items-center gap-1.5 px-3 py-2 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold rounded-lg whitespace-nowrap transition-all shadow-sm disabled:opacity-50 btn-press chq-focus">
                              <CheckCircle className="w-3.5 h-3.5" />
                              {tAdmin('approve')}
                            </button>
                            <button onClick={() => setShowRejectReason(ps)} className="inline-flex items-center gap-1.5 px-3 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-lg whitespace-nowrap transition-all shadow-sm btn-press chq-focus">
                              <XCircle className="w-3.5 h-3.5" />
                              {tAdmin('reject')}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {pendingSignups.length === 0 && (
                      <tr><td colSpan={8} className="py-8 px-4 text-center text-[var(--color-text-secondary)]">{tAdmin('noPending')}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* Card Orders */}
        {tab === 'cardOrders' && (
          <>
            <h2 className="text-lg font-bold text-[var(--color-text-primary)] mb-4">{tAdmin('cardOrders')}</h2>
            <div className="glass overflow-hidden rounded-xl">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[var(--color-surface-2)]">
                    <tr>
                      <th className="text-start px-4 py-3 font-medium text-[var(--color-text-secondary)]">{tAdmin('orderId', { defaultValue: 'Order ID' })}</th>
                      <th className="text-start px-4 py-3 font-medium text-[var(--color-text-secondary)]">{tAdmin('centerName', { defaultValue: 'Center' })}</th>
                      <th className="text-start px-4 py-3 font-medium text-[var(--color-text-secondary)]">{tAdmin('studentsCount')}</th>
                      <th className="text-start px-4 py-3 font-medium text-[var(--color-text-secondary)]">{tCommon('amount')}</th>
                      <th className="text-start px-4 py-3 font-medium text-[var(--color-text-secondary)]">{tCommon('status')}</th>
                      <th className="text-start px-4 py-3 font-medium text-[var(--color-text-secondary)]">{tAdmin('createdAt')}</th>
                      <th className="text-start px-4 py-3 font-medium text-[var(--color-text-secondary)]">{tCommon('actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cardOrders.map((order) => {
                      const statusColors: Record<string, string> = {
                        pending: 'bg-amber-100 text-amber-700',
                        paid: 'bg-emerald-100 text-emerald-800',
                        confirmed: 'bg-blue-100 text-blue-700',
                        printing: 'bg-purple-100 text-purple-700',
                        ready_for_pickup: 'bg-cyan-100 text-cyan-800',
                        shipped: 'bg-teal-100 text-teal-700',
                        delivered: 'bg-green-100 text-green-700',
                      };
                      const sc = statusColors[order.status] || statusColors.pending;
                      const isExpanded = expandedOrderId === order.id;
                      return (
                        <>
                          <tr
                            key={order.id}
                            className="border-t border-border hover:bg-[var(--color-surface-0)] cursor-pointer"
                            onClick={() => setExpandedOrderId(isExpanded ? null : order.id)}
                          >
                            <td className="px-4 py-3 font-mono text-xs text-[var(--color-text-secondary)]">{order.id.slice(0, 8)}…</td>
                            <td className="px-4 py-3 font-medium text-[var(--color-text-primary)]">{order.center_name}</td>
                            <td className="px-4 py-3 font-mono">{order.quantity}</td>
                            <td className="px-4 py-3 font-mono font-bold">{order.total_amount.toLocaleString('en-US')} {tCommon('egp')}</td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${sc}`}>
                                {order.status === 'pending'
                                  ? tIdCards('statusPending')
                                  : order.status === 'paid'
                                    ? tIdCards('statusPaid')
                                    : order.status === 'printing'
                                      ? tIdCards('statusPrinting')
                                      : order.status === 'ready_for_pickup'
                                        ? tIdCards('statusReadyPickup')
                                        : order.status === 'shipped'
                                          ? tIdCards('statusShipped')
                                          : order.status === 'delivered'
                                            ? tIdCards('statusDelivered')
                                            : order.status === 'confirmed'
                                              ? tIdCards('statusConfirmed')
                                              : order.status}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-xs text-[var(--color-text-secondary)]">
                              {order.created_at ? new Date(order.created_at).toLocaleDateString() : tCommon('notSet')}
                            </td>
                            <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                              <span className="inline-flex">{isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</span>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr key={`${order.id}-exp`} className="border-t border-border bg-[var(--color-surface-0)]">
                              <td colSpan={7} className="px-4 py-4">
                                <div className="space-y-4">
                                  <div>
                                    <p className="text-xs font-medium text-[var(--color-text-secondary)] mb-2">{tAdmin('studentsInOrder', { defaultValue: 'Students' })}</p>
                                    <div className="flex flex-wrap gap-2">
                                      {order.students.map((s) => (
                                        <span key={s.id} className="px-2 py-1 rounded-lg bg-[var(--color-surface-0)] border border-border text-sm">
                                          {s.name} <span className="font-mono text-[var(--color-text-secondary)]">{s.student_number || ''}</span>
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                  <div className="flex flex-wrap gap-4 items-start">
                                    <div className="flex-1 min-w-[200px]">
                                      <p className="text-xs font-medium text-[var(--color-text-secondary)] mb-1">{tAdmin('deliveryAddress', { defaultValue: 'Delivery Address' })}</p>
                                      <p className="text-sm">{order.delivery_address || tCommon('notSet')}</p>
                                      {order.notes && (
                                        <>
                                          <p className="text-xs font-medium text-[var(--color-text-secondary)] mt-2 mb-1">{tAdmin('notes', { defaultValue: 'Notes' })}</p>
                                          <p className="text-sm">{order.notes}</p>
                                        </>
                                      )}
                                    </div>
                                    <div className="flex flex-col gap-2">
                                      <div>
                                        <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">{tCommon('status')}</label>
                                        <select
                                          value={order.status}
                                          onChange={(e) => handleCardOrderStatusUpdate(order.id, e.target.value)}
                                          disabled={actionLoading}
                                          className="px-3 py-2 rounded-lg border border-border bg-[var(--color-surface-0)] text-sm"
                                        >
                                          <option value="pending">{tIdCards('statusPending')}</option>
                                          <option value="paid">{tIdCards('statusPaid')}</option>
                                          <option value="printing">{tIdCards('statusPrinting')}</option>
                                          <option value="ready_for_pickup">{tIdCards('statusReadyPickup')}</option>
                                          <option value="shipped">{tIdCards('statusShipped')}</option>
                                          <option value="delivered">{tIdCards('statusDelivered')}</option>
                                          <option value="confirmed">{tIdCards('statusConfirmed')}</option>
                                        </select>
                                      </div>
                                      {order.center_phone && (
                                        <a
                                          href={`https://wa.me/20${order.center_phone.replace(/\D/g, '').replace(/^0/, '')}?text=${encodeURIComponent(tIdCards('whatsappOrderReadyMessage', { orderNumber: order.id.slice(0, 8) }))}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-green-600 text-white hover:bg-green-700"
                                        >
                                          <MessageCircle size={14} /> {tAdmin('contactWhatsApp', { defaultValue: 'Contact on WhatsApp' })}
                                        </a>
                                      )}
                                    </div>
                                  </div>
                                  <div className="pt-2">
                                    <p className="text-xs font-medium text-[var(--color-text-secondary)] mb-2">{tAdmin('cardPreview', { defaultValue: 'Card Preview' })}</p>
                                    <CardOrderPreview
                                      students={order.students}
                                      centerName={order.center_name}
                                      centerLogo={order.center_logo_url ?? null}
                                    />
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                    {cardOrders.length === 0 && (
                      <tr><td colSpan={7} className="px-4 py-8 text-center text-[var(--color-text-secondary)]">{tAdmin('noCardOrders', { defaultValue: 'No card orders yet' })}</td></tr>
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
              <h2 className="text-lg font-bold text-[var(--color-text-primary)]">{tAdmin('internalTeam')}</h2>
              <button onClick={() => setShowAddAdmin(true)} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-primary hover:bg-primary/90 btn-press chq-focus">
                + {tAdmin('addAdmin', { defaultValue: 'Add Admin' })}
              </button>
            </div>
            <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-0)]">
                    <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{tCommon('name')}</th>
                    <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{tCommon('phone')}</th>
                    <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">Role</th>
                    <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{tAdmin('joinedDate')}</th>
                    <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{tCommon('actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-subtle)]">
                  {internalTeam.map((m) => (
                    <tr key={m.id} className="hover:bg-[var(--color-surface-0)] transition-colors">
                      <td className="py-3.5 px-4 text-sm text-[var(--color-text-primary)] font-medium">{m.name}</td>
                      <td className="py-3.5 px-4 font-mono text-xs text-[var(--color-text-secondary)]" dir="ltr">
                        {m.phone ?? m.email ?? tCommon('notSet')}
                      </td>
                      <td className="py-3.5 px-4"><span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-700 border border-purple-300">{m.role}</span></td>
                      <td className="py-3.5 px-4 text-sm text-[var(--color-text-secondary)]">
                        {m.created_at ? new Date(m.created_at).toLocaleDateString() : tCommon('notSet')}
                      </td>
                      <td className="py-3.5 px-4">
                        {!['super_admin', 'admin'].includes(m.role) && (
                          <button onClick={() => handleRemoveTeamMember(m.id)} disabled={actionLoading} className="px-2 py-1 rounded text-xs font-semibold border border-red-300 text-red-600  hover:bg-red-50 btn-press chq-focus">
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

        {/* Sales Pipeline */}
        {tab === 'salesPipeline' && (
          <>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-[var(--color-text-primary)]">{tAdmin('salesPipeline') ?? 'Sales Pipeline'}</h2>
              <button onClick={() => setShowAddLead(true)} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-primary btn-press chq-focus">
                <Plus size={16} />{tAdmin('addLead') ?? 'Add Lead'}
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
              {[
                { label: 'Total Leads', value: leads.length },
                { label: 'Contacted', value: leads.filter(l => l.stage === 'contacted').length },
                { label: 'Demo Scheduled', value: leads.filter(l => l.stage === 'demo_scheduled').length },
                { label: 'Converted', value: leads.filter(l => l.stage === 'converted').length },
                { label: 'Conversion Rate', value: leads.length > 0 ? `${Math.round((leads.filter(l => l.stage === 'converted').length / leads.length) * 100)}%` : '0%' },
              ].map(({ label, value }) => (
                <div key={label} className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm p-6">
                  <div className="text-2xl font-bold font-mono text-[var(--color-text-primary)]">{value}</div>
                  <div className="text-sm text-[var(--color-text-secondary)]">{label}</div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {(['prospect', 'contacted', 'demo_scheduled', 'converted'] as const).map((stage) => (
                <div key={stage} className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-sm text-[var(--color-text-primary)]">{stage.replace('_', ' ')}</h3>
                    <span className="text-xs font-mono text-[var(--color-text-secondary)]">{leads.filter(l => l.stage === stage).length}</span>
                  </div>
                  <div className="space-y-2">
                    {leads.filter(l => l.stage === stage).map((lead) => (
                      <div key={lead.id} onClick={() => setSelectedLead(lead)} className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm p-4 cursor-pointer hover:shadow-md transition-shadow">
                        <p className="font-semibold text-sm text-[var(--color-text-primary)]">{lead.name}</p>
                        <p className="text-xs text-[var(--color-text-secondary)]">{lead.contact_person}</p>
                        <p className="text-xs font-mono text-[var(--color-text-secondary)] mt-1" dir="ltr">{lead.phone}</p>
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-xs text-[var(--color-text-secondary)]">{lead.area}</span>
                          <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]">{lead.source}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Analytics */}
        {tab === 'analytics' && (
          <>
            <h2 className="text-lg font-bold text-[var(--color-text-primary)] mb-4">{tAdmin('analytics')}</h2>
            <div className="grid md:grid-cols-2 gap-4 mb-6">
              <ChartCard
                title={tCharts('centersByPlan')}
                value={analyticsCenters.length}
                loading={analyticsCentersLoading}
                minHeight={300}
              >
                <DonutChart
                  data={adminPlanDonutData}
                  height={200}
                  centerLabel={tAdmin('totalCenters')}
                  centerValue={analyticsCenters.length}
                />
                <ChartLegend
                  direction="vertical"
                  items={adminPlanDonutData.map((d) => ({
                    color: d.color ?? '#64748B',
                    label: d.name,
                    value: d.value,
                  }))}
                />
              </ChartCard>
              <ChartCard
                title={tCharts('centersByStatus')}
                value={analyticsCenters.length}
                loading={analyticsCentersLoading}
                minHeight={300}
              >
                <DonutChart
                  data={adminStatusDonutData}
                  height={200}
                  centerLabel={tAdmin('totalCenters')}
                  centerValue={analyticsCenters.length}
                />
                <ChartLegend
                  direction="vertical"
                  items={adminStatusDonutData.map((d) => ({
                    color: d.color ?? '#64748B',
                    label: d.name,
                    value: d.value,
                  }))}
                />
              </ChartCard>
            </div>
            <div className="grid md:grid-cols-2 gap-4 mb-6">
              <ChartCard title={tCharts('topFiveByStudents')} loading={analyticsCentersLoading} minHeight={260}>
                <BarChartComponent
                  data={topStudentsBarData}
                  layout="vertical"
                  categoryKey="name"
                  dataKey="students_count"
                  xKey="name"
                  height={200}
                  color="teal"
                  showGrid
                  rtl={isRTL}
                />
              </ChartCard>
              <ChartCard
                title={tCharts('topFiveByRevenue')}
                subtitle={tCharts('estRevenueProxy')}
                loading={analyticsCentersLoading}
                minHeight={260}
              >
                <BarChartComponent
                  data={topRevenueProxyBarData}
                  layout="vertical"
                  categoryKey="name"
                  dataKey="students_count"
                  xKey="name"
                  height={200}
                  color="blue"
                  showGrid
                  rtl={isRTL}
                />
              </ChartCard>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {(
                [
                  {
                    key: 'avgStudents',
                    label: tAdmin('analyticsAvgStudentsPerCenter'),
                    value: analyticsCenters.length > 0 ? Math.round(analyticsCenters.reduce((s, c) => s + (c.students_count ?? 0), 0) / analyticsCenters.length) : 0,
                  },
                  {
                    key: 'avgRevenue',
                    label: tAdmin('analyticsAvgRevenuePerCenter'),
                    value:
                      analyticsCenters.filter((c) => (c.status ?? 'active') === 'active').length > 0
                        ? `${Math.round((overview?.totalMRR ?? overview?.mrr ?? 0) / Math.max(1, analyticsCenters.filter((c) => (c.status ?? 'active') === 'active').length)).toLocaleString('en-US')} ${tCommon('egp')}`
                        : `${(0).toLocaleString('en-US')} ${tCommon('egp')}`,
                  },
                  {
                    key: 'zeroStudents',
                    label: tAdmin('analyticsCentersZeroStudents'),
                    value: analyticsCenters.filter((c) => (c.students_count ?? 0) === 0).length,
                  },
                  {
                    key: 'atRisk',
                    label: tAdmin('analyticsCentersAtRisk'),
                    value: analyticsCenters.filter((c) => c.last_active?.includes('days') || c.last_active === 'Never').length,
                  },
                ] as const
              ).map(({ key, label, value }) => (
                <div key={key} className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm p-6">
                  <div className="text-2xl font-bold font-mono text-[var(--color-text-primary)]">{value}</div>
                  <div className="text-sm text-[var(--color-text-secondary)]">{label}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Center Detail Slide-over */}
      {detailCenter && (
        <div className="fixed inset-0 z-50" onClick={() => setDetailCenter(null)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="absolute top-0 end-0 bottom-0 w-full max-w-md overflow-y-auto rounded-s-2xl border-s border-border bg-[var(--color-surface-1)]" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-border flex items-center justify-between">
              <h2 className="font-bold text-[var(--color-text-primary)] text-lg">{detailCenter.name}</h2>
              <button onClick={() => setDetailCenter(null)} className="p-1.5 rounded-lg hover:bg-[var(--color-surface-2)] btn-press chq-focus"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              {(
                [
                  {
                    label: tAdmin('owner'),
                    value: detailCenter.owner?.name ?? detailCenter.owner_name ?? null,
                    isPlan: false,
                    empty: () => (
                      <span className="text-slate-500 text-xs italic">{tCommon('notAvailable')}</span>
                    ),
                  },
                  {
                    label: tCommon('phone'),
                    value: detailCenter.phone ?? null,
                    isPlan: false,
                    empty: () => (
                      <span className="text-slate-500 text-xs italic">{tCommon('notSet')}</span>
                    ),
                  },
                  {
                    label: tCommon('email'),
                    value: detailCenter.email ?? null,
                    isPlan: false,
                    empty: () => (
                      <span className="text-slate-500 text-xs italic">{tCommon('notSet')}</span>
                    ),
                  },
                  { label: tAdmin('plan'), value: detailCenter.plan, isPlan: true },
                  {
                    label: tAdmin('billingPeriod'),
                    value: detailCenter.billing_period ?? null,
                    isPlan: false,
                    empty: () => (
                      <span className="text-slate-500 text-xs italic">{tCommon('notSet')}</span>
                    ),
                  },
                  { label: tAdmin('studentsCount'), value: String(detailCenter.students_count ?? 0), isPlan: false },
                  {
                    label: tCommon('status'),
                    value: detailCenter.status ?? null,
                    isPlan: false,
                    empty: () => (
                      <span className="text-slate-500 text-xs italic">{tCommon('notSet')}</span>
                    ),
                  },
                  {
                    label: tAdmin('nextDue'),
                    value: detailCenter.next_due ?? null,
                    isPlan: false,
                    empty: () => (
                      <span className="text-slate-500 text-xs italic">{tCommon('notSet')}</span>
                    ),
                  },
                  {
                    label: tAdmin('referralCode'),
                    value: detailCenter.referral_code ?? null,
                    isPlan: false,
                    empty: () => (
                      <span className="text-slate-500 text-xs italic">{tCommon('notSet')}</span>
                    ),
                  },
                  {
                    label: tAdmin('lastActive'),
                    value: detailCenter.last_active ?? null,
                    isPlan: false,
                    empty: () => (
                      <span className="text-slate-500 text-xs italic">{tCommon('never')}</span>
                    ),
                  },
                  { label: tAdmin('usage'), value: String(detailCenter.usage_scans ?? 0), isPlan: false },
                  {
                    label: tAdmin('createdAt'),
                    value: detailCenter.created_at
                      ? new Date(detailCenter.created_at).toLocaleDateString()
                      : null,
                    isPlan: false,
                    empty: () => (
                      <span className="text-slate-500 text-xs italic">{tCommon('notSet')}</span>
                    ),
                  },
                ] as Array<{
                  label: string;
                  value: string | null;
                  isPlan?: boolean;
                  empty?: () => ReactNode;
                }>
              ).map((row) => {
                const { label, isPlan } = row;
                const value = row.value;
                const showEmpty = value == null || value === '';
                return (
                  <div key={label}>
                    <p className="text-xs text-[var(--color-text-secondary)] mb-0.5">{label}</p>
                    {isPlan ? (
                      <PlanBadge plan={value ?? ''} />
                    ) : showEmpty && row.empty ? (
                      row.empty()
                    ) : (
                      <p className="font-medium text-[var(--color-text-primary)]">{value}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Suspend Confirm */}
      {showSuspendConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowSuspendConfirm(null)}>
          <div className="rounded-2xl border border-border p-6 max-w-sm mx-4 w-full bg-[var(--color-surface-1)]" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-[var(--color-text-primary)] mb-2">{tAdmin('confirmSuspend')}</h3>
            <p className="text-sm text-[var(--color-text-secondary)] mb-4">{tAdmin('suspendConfirmBody', { name: showSuspendConfirm.name })}</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowSuspendConfirm(null)} className="px-4 py-2 rounded-lg text-sm border border-border btn-press chq-focus">{tCommon('cancel')}</button>
              <button
                onClick={() => setPasswordConfirm({ type: 'suspend', center: showSuspendConfirm })}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-red-600 hover:bg-red-700 btn-press chq-focus"
              >
                {tCommon('confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Center Confirm */}
      {deleteConfirm && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setDeleteConfirm(null)}
        >
          <div
            style={{ background: 'var(--color-surface-1)', borderRadius: 12, padding: 24, width: 360, maxWidth: '90vw' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>{tAdmin('deleteCenters')}</h3>
            <p style={{ fontSize: 14, color: '#6b7280', marginBottom: 20 }}>
              {tAdmin('deleteCenterPermanent', { defaultValue: 'This action cannot be undone. The center and all its data will be permanently deleted.' })}
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setDeleteConfirm(null)}
                style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--color-border-default)', background: 'var(--color-surface-2)', cursor: 'pointer', fontSize: 14 }} className="btn-press chq-focus">
                {tCommon('cancel')}
              </button>
              <button
                onClick={() => handleDeleteCenter(deleteConfirm)}
                style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: '#dc2626', color: 'white', cursor: 'pointer', fontSize: 14, fontWeight: 500 }} className="btn-press chq-focus">
                {tCommon('delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Admin Modal */}
      {showAddAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowAddAdmin(false)}>
          <div className="rounded-2xl border border-border p-6 max-w-sm mx-4 w-full max-h-[90vh] overflow-y-auto bg-[var(--color-surface-1)]" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-[var(--color-text-primary)] mb-4">{tAdmin('inviteTeamMember', { defaultValue: 'Add Admin' })}</h3>
            <p className="text-xs text-[var(--color-text-secondary)] mb-3">{tAdmin('noTeamMembers', { defaultValue: 'User must have signed up at CenterHQ first.' })}</p>
            <div className="space-y-3">
              <input
                value={addAdminForm.name}
                onChange={(e) => setAddAdminForm((f) => ({ ...f, name: e.target.value }))}
                placeholder={tCommon('name')}
                className="w-full px-3 py-2.5 rounded-lg border border-border bg-[var(--color-surface-2)] text-[var(--color-text-primary)] text-sm"
              />
              <input
                value={addAdminForm.phone}
                onChange={(e) => setAddAdminForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder={tCommon('phone')}
                type="tel"
                dir="ltr"
                className="w-full px-3 py-2.5 rounded-lg border border-border bg-[var(--color-surface-2)] text-[var(--color-text-primary)] text-sm"
              />
              <input
                value={addAdminForm.email}
                onChange={(e) => setAddAdminForm((f) => ({ ...f, email: e.target.value }))}
                placeholder={tCommon('email')}
                type="email"
                className="w-full px-3 py-2.5 rounded-lg border border-border bg-[var(--color-surface-2)] text-[var(--color-text-primary)] text-sm"
              />
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">الدور / Role</label>
                <select
                  value={selectedRole}
                  onChange={(e) => { setSelectedRole(e.target.value); setCustomPerms([]); }}
                  className="w-full px-3 py-2 border border-[var(--color-border-subtle)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                  <option value="internal_viewer">مشاهد / Viewer</option>
                  <option value="internal_admin">مدير داخلي / Internal Admin</option>
                  <option value="sales_rep">مندوب مبيعات / Sales Rep</option>
                  <option value="support_agent">موظف دعم / Support Agent</option>
                  <option value="accountant">محاسب / Accountant</option>
                  <option value="custom">مخصص / Custom</option>
                </select>
              </div>
              {selectedRole === 'custom' && (
                <div className="border border-[var(--color-border-subtle)] rounded-lg p-3 space-y-2">
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">الصلاحيات المسموح بها:</p>
                  {ALL_ADMIN_PERMISSIONS.map((p) => (
                    <label key={p.key} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={customPerms.includes(p.key)}
                        onChange={(e) =>
                          setCustomPerms((prev) =>
                            e.target.checked ? [...prev, p.key] : prev.filter((k) => k !== p.key)
                          )
                        }
                        className="rounded border-[var(--color-border-default)] text-teal-600"
                      />
                      <span>{p.labelAr}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setShowAddAdmin(false)} className="px-4 py-2 rounded-lg text-sm border border-border btn-press chq-focus">{tCommon('cancel')}</button>
              <button onClick={handleAddAdmin} disabled={actionLoading || !addAdminForm.name.trim() || !addAdminForm.phone.trim()} className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-primary hover:bg-primary/90 disabled:opacity-50 btn-press chq-focus">
                {tAdmin('invite')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject Reason Modal */}
      {showRejectReason && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowRejectReason(null)}>
          <div className="rounded-2xl border border-border p-6 max-w-sm mx-4 w-full bg-[var(--color-surface-1)]" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-[var(--color-text-primary)] mb-3">{tAdmin('rejectionReason')}</h3>
            <textarea placeholder={tAdmin('rejectReasonPlaceholder')} className="w-full px-3 py-2.5 rounded-lg border border-border bg-[var(--color-surface-2)] text-[var(--color-text-primary)] text-sm h-24 resize-none mb-4" />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowRejectReason(null)} className="px-4 py-2 rounded-lg text-sm border border-border btn-press chq-focus">{tCommon('cancel')}</button>
              <button
                onClick={() => { handleCenterAction(showRejectReason.id, 'reject'); setShowRejectReason(null); }}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-red-600 hover:bg-red-700 btn-press chq-focus"
              >
                {tAdmin('reject')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Lead Modal */}
      {showAddLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowAddLead(false)}>
          <div className="rounded-2xl border border-border p-6 max-w-md mx-4 w-full max-h-[90vh] overflow-y-auto bg-[var(--color-surface-1)] text-start" dir="rtl" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-[var(--color-text-primary)] mb-4">إضافة عميل جديد</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">اسم السنتر</label>
                <input placeholder="اسم السنتر التعليمي" value={addLeadForm.name} onChange={(e) => setAddLeadForm(f => ({ ...f, name: e.target.value }))} className="w-full px-3 py-2.5 rounded-lg border border-border bg-[var(--color-surface-2)] text-[var(--color-text-primary)] text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">اسم مسؤول التواصل</label>
                <input placeholder="الاسم الكامل للمسؤول" value={addLeadForm.contactPerson} onChange={(e) => setAddLeadForm(f => ({ ...f, contactPerson: e.target.value }))} className="w-full px-3 py-2.5 rounded-lg border border-border bg-[var(--color-surface-2)] text-[var(--color-text-primary)] text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">رقم الهاتف</label>
                <input placeholder="01x xxxx xxxx" type="tel" dir="ltr" value={addLeadForm.phone} onChange={(e) => setAddLeadForm(f => ({ ...f, phone: e.target.value }))} className="w-full px-3 py-2.5 rounded-lg border border-border bg-[var(--color-surface-2)] text-[var(--color-text-primary)] text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">المنطقة</label>
                <select value={addLeadForm.area} onChange={(e) => setAddLeadForm(f => ({ ...f, area: e.target.value }))} className="w-full px-3 py-2.5 rounded-lg border border-border bg-[var(--color-surface-2)] text-[var(--color-text-primary)] text-sm">
                  <option value="">المنطقة</option>
                  {AREAS.map((a) => <option key={a} value={a}>{AREA_LABELS[a] ?? a}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">المصدر</label>
                <select value={addLeadForm.source} onChange={(e) => setAddLeadForm(f => ({ ...f, source: e.target.value }))} className="w-full px-3 py-2.5 rounded-lg border border-border bg-[var(--color-surface-2)] text-[var(--color-text-primary)] text-sm">
                  <option value="">المصدر</option>
                  {SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABELS[s] ?? s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">مرحلة المسار</label>
                <select value={addLeadForm.stage} onChange={(e) => setAddLeadForm(f => ({ ...f, stage: e.target.value as 'prospect' | 'contacted' | 'demo_scheduled' | 'converted' }))} className="w-full px-3 py-2.5 rounded-lg border border-border bg-[var(--color-surface-2)] text-[var(--color-text-primary)] text-sm">
                  <option value="prospect">عميل محتمل</option>
                  <option value="contacted">تم التواصل</option>
                  <option value="demo_scheduled">تم العرض</option>
                  <option value="converted">تم الإغلاق</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">ملاحظات</label>
                <textarea placeholder="أي ملاحظات إضافية..." value={addLeadForm.notes} onChange={(e) => setAddLeadForm(f => ({ ...f, notes: e.target.value }))} className="w-full px-3 py-2.5 rounded-lg border border-border bg-[var(--color-surface-2)] text-[var(--color-text-primary)] text-sm h-20 resize-none" />
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setShowAddLead(false)} className="px-4 py-2 rounded-lg text-sm border border-border btn-press chq-focus">إلغاء</button>
              <button
                onClick={() => {
                  if (addLeadForm.name.trim()) {
                    setLeads(prev => [...prev, {
                      id: `sl-${Date.now()}`,
                      name: addLeadForm.name.trim(),
                      contact_person: addLeadForm.contactPerson,
                      phone: addLeadForm.phone,
                      area: addLeadForm.area,
                      source: addLeadForm.source,
                      stage: addLeadForm.stage,
                      notes: addLeadForm.notes,
                    }]);
                    setAddLeadForm({ name: '', contactPerson: '', phone: '', area: '', source: '', stage: 'prospect', notes: '' });
                    setShowAddLead(false);
                  }
                }}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-primary btn-press chq-focus"
              >
                حفظ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lead Detail Slide-over */}
      {selectedLead && (
        <div className="fixed inset-0 z-50" onClick={() => setSelectedLead(null)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="absolute top-0 end-0 bottom-0 w-full max-w-md overflow-y-auto rounded-s-2xl border-s border-border bg-[var(--color-surface-1)]" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-border flex items-center justify-between">
              <h2 className="font-bold text-[var(--color-text-primary)] text-lg">{selectedLead.name}</h2>
              <button onClick={() => setSelectedLead(null)} className="p-1.5 rounded-lg hover:bg-[var(--color-surface-2)] btn-press chq-focus"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div><p className="text-xs text-[var(--color-text-secondary)] mb-0.5">{tAdmin('contactPerson')}</p><p className="font-medium text-[var(--color-text-primary)]">{selectedLead.contact_person}</p></div>
              <div><p className="text-xs text-[var(--color-text-secondary)] mb-0.5">{tCommon('phone')}</p><p className="font-medium text-[var(--color-text-primary)]" dir="ltr">{selectedLead.phone}</p></div>
              <div><p className="text-xs text-[var(--color-text-secondary)] mb-0.5">{tAdmin('area')}</p><p className="font-medium text-[var(--color-text-primary)]">{selectedLead.area}</p></div>
              <div><p className="text-xs text-[var(--color-text-secondary)] mb-0.5">{tAdmin('source')}</p><p className="font-medium text-[var(--color-text-primary)]">{selectedLead.source}</p></div>
              <div><p className="text-xs text-[var(--color-text-secondary)] mb-0.5">{tAdmin('notes')}</p><p className="font-medium text-[var(--color-text-primary)]">{selectedLead.notes}</p></div>
              <div>
                <p className="text-xs text-[var(--color-text-secondary)] mb-1">{tAdmin('changeStage')}</p>
                <select
                  value={selectedLead.stage}
                  onChange={(e) => {
                    const newStage = e.target.value as SalesLead['stage'];
                    setLeads(prev => prev.map(l => l.id === selectedLead.id ? { ...l, stage: newStage } : l));
                    setSelectedLead({ ...selectedLead, stage: newStage });
                  }}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-[var(--color-surface-2)] text-[var(--color-text-primary)] text-sm"
                >
                  <option value="prospect">{tAdmin('leadStageProspect')}</option>
                  <option value="contacted">{tAdmin('leadStageContacted')}</option>
                  <option value="demo_scheduled">{tAdmin('leadStageDemoScheduled')}</option>
                  <option value="converted">{tAdmin('leadStageConverted')}</option>
                </select>
              </div>
              <button onClick={() => { setLeads(prev => prev.filter(l => l.id !== selectedLead.id)); setSelectedLead(null); }} className="w-full px-4 py-2 rounded-lg text-sm font-semibold text-destructive border border-destructive/30 hover:bg-destructive/10 btn-press chq-focus">
                {tAdmin('deleteLead')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Change Plan Modal */}
      {changePlanModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-[var(--color-surface-1)] rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b border-[var(--color-border-subtle)]">
              <div>
                <h2 className="text-lg font-bold text-[var(--color-text-primary)]">{tAdmin('changePlan')}</h2>
                <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">{changePlanModal.centerName}</p>
              </div>
              <button onClick={() => { setChangePlanModal(null); setNewPlan(''); }} className="p-2 hover:bg-[var(--color-surface-2)] rounded-lg btn-press chq-focus">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <p className="text-sm text-[var(--color-text-secondary)] mb-3">
                  {tAdmin('changePlanCurrent')}{' '}
                  <span className="font-semibold text-[var(--color-text-primary)] capitalize">{changePlanModal.currentPlan}</span>
                </p>
                <label className="text-sm font-medium text-[var(--color-text-primary)] block mb-2">{tAdmin('changePlanNewLabel')}</label>
                <select
                  value={newPlan}
                  onChange={(e) => setNewPlan(e.target.value)}
                  className="w-full px-3 py-2 border border-[var(--color-border-subtle)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-[var(--color-surface-1)]"
                >
                  <option value="">{tAdmin('selectPlanPlaceholder')}</option>
                  <option value="nano">Nano - ≤100 students - EGP 2,500/mo</option>
                  <option value="starter">Starter - ≤250 students - EGP 5,200/mo</option>
                  <option value="pro">Pro - ≤500 students - EGP 9,200/mo</option>
                  <option value="business">Business - ≤1,000 students - EGP 15,000/mo</option>
                  <option value="enterprise">Enterprise - ≤2,000 students - EGP 21,300/mo</option>
                  <option value="top_centers">Top Centers - Custom</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-3 p-6 pt-0">
              <button
                onClick={() => { setChangePlanModal(null); setNewPlan(''); }}
                className="px-4 py-2 border border-[var(--color-border-default)] hover:bg-[var(--color-surface-0)] text-[var(--color-text-primary)] text-sm font-semibold rounded-lg transition-colors btn-press chq-focus"
              >
                {tCommon('cancel')}
              </button>
              <button
                disabled={!newPlan || newPlan === changePlanModal.currentPlan || changingPlan}
                onClick={async () => {
                  if (!newPlan) return;
                  setChangingPlan(true);
                  try {
                    await handleCenterAction(changePlanModal.centerId, 'change_plan', { newPlan });
                    setChangePlanModal(null);
                    setNewPlan('');
                    loadCenters();
                  } finally {
                    setChangingPlan(false);
                  }
                }}
                className="px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors btn-press chq-focus"
              >
                {changingPlan ? tAdmin('changePlanSaving') : tAdmin('changePlan')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payment Proof Image Modal */}
      {viewingProof && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => setViewingProof(null)}>
          <div className="relative max-w-2xl w-full" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-white font-semibold">{tAdmin('paymentProof')}</span>
              <div className="flex items-center gap-2">
                <a
                  href={viewingProof}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--color-surface-1)]/20 hover:bg-[var(--color-surface-1)]/30 text-white text-xs font-semibold rounded-lg transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> {tAdmin('openOriginal')}
                </a>
                <button onClick={() => setViewingProof(null)} className="p-2 bg-[var(--color-surface-1)]/20 hover:bg-[var(--color-surface-1)]/30 rounded-lg transition-colors btn-press chq-focus">
                  <X className="w-4 h-4 text-white" />
                </button>
              </div>
            </div>
            <img
              src={viewingProof}
              alt={tAdmin('paymentProofAlt')}
              className="w-full rounded-xl shadow-2xl max-h-[80vh] object-contain bg-[var(--color-surface-1)]"
            />
          </div>
        </div>
      )}

      {blacklistModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setBlacklistModal(null)}>
          <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-xl max-w-md w-full p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-1">{tAdmin('blacklistCenter')}</h3>
            <p className="text-sm text-[var(--color-text-secondary)] mb-3">{blacklistModal.name}</p>
            <p className="text-xs text-[var(--color-text-secondary)] mb-2">{tAdmin('blacklistConfirm')}</p>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">{tAdmin('blacklistReasonLabel')}</label>
            <textarea
              value={blacklistReasonInput}
              onChange={(e) => setBlacklistReasonInput(e.target.value)}
              className="w-full min-h-[88px] rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-0)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
              placeholder={tAdmin('blacklistReasonPlaceholder')}
            />
            <div className="flex justify-end gap-2 mt-4">
              <button type="button" onClick={() => setBlacklistModal(null)} className="px-4 py-2 text-sm rounded-lg border border-[var(--color-border-subtle)] btn-press chq-focus">
                {tCommon('cancel')}
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => void handleBlacklistCenter()}
                className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white font-medium disabled:opacity-50 btn-press chq-focus"
              >
                {actionLoading ? tAdmin('blacklistSaving') : tAdmin('blacklistMenu')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Password Confirm Modal (suspend, approve invoice) */}
      {passwordConfirm && (
        <PasswordConfirmModal
          isOpen={!!passwordConfirm}
          onClose={() => setPasswordConfirm(null)}
          title={
            passwordConfirm.type === 'suspend'
              ? tAdmin('confirmSuspend')
              : tAdmin('confirmApprovePayment')
          }
          onConfirm={async (password) => {
            if (passwordConfirm.type === 'suspend') {
              await handleCenterAction(passwordConfirm.center.id, 'suspend', { password });
            } else {
              await handleInvoiceAction(passwordConfirm.inv.id, 'approve', password);
            }
            setPasswordConfirm(null);
          }}
        />
      )}
      </div>
    </div>
  );
}
