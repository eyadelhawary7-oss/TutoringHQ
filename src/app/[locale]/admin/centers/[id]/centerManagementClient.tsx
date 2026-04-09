'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Link } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { AdminSidebar } from '@/components/AdminSidebar';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { useSidebar } from '@/contexts/SidebarContext';
import { useLayout } from '@/contexts/LayoutContext';
import { getCsrfHeaders } from '@/lib/csrf-client';
import { useToast } from '@/hooks/useToast';
import { Pin, Trash2 } from 'lucide-react';

type CenterData = {
  center: Record<string, unknown>;
  invoices: Record<string, unknown>[];
  renewalHistory: Record<string, unknown>[];
  planRequests: Record<string, unknown>[];
  referralsMade: Record<string, unknown>[];
  pricingPlans: Record<string, unknown>[];
  adminUsers: Record<string, unknown>[];
  referralCommissions: Record<string, unknown>[];
  payoutRequests: Record<string, unknown>[];
};

interface CenterManagementClientProps {
  centerId: string;
}

const AdminDatePicker = ({
  value,
  onChange,
  placeholder = 'Select date',
}: {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
}) => (
  <input
    type="date"
    value={value}
    aria-label={placeholder}
    onChange={(e) => onChange(e.target.value)}
    className="w-full rounded-lg px-3 py-2 text-sm border border-gray-300 bg-gray-100 text-slate-900 dark:border-slate-600 dark:bg-slate-700 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
  />
);

const Toggle = ({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) => (
  <div
    className="flex items-center gap-3 cursor-pointer select-none"
    onClick={() => onChange(!checked)}
    role="switch"
    aria-checked={checked}
    tabIndex={0}
    onKeyDown={(e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        onChange(!checked);
      }
    }}
  >
    <div
      style={{
        width: 48,
        height: 26,
        borderRadius: 13,
        backgroundColor: checked ? '#0d9488' : '#475569',
        position: 'relative',
        transition: 'background-color 0.2s',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 3,
          left: checked ? 25 : 3,
          width: 20,
          height: 20,
          borderRadius: '50%',
          backgroundColor: 'white',
          boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
          transition: 'left 0.2s',
        }}
      />
    </div>
    <span className="text-sm text-slate-600 dark:text-slate-300">{label}</span>
  </div>
);

const CANCELLATION_REASON_LABELS: Record<string, string> = {
  moving_competitor: 'Switching to another platform',
  too_expensive: 'Too expensive',
  center_closing: 'Center is closing',
  not_using: 'Not using the platform enough',
  other: 'Other reason',
};

const GOVERNORATE_OPTIONS: { value: string; label: string }[] = [
  { value: 'cairo', label: 'Cairo - القاهرة' },
  { value: 'giza', label: 'Giza - الجيزة' },
  { value: 'alexandria', label: 'Alexandria - الإسكندرية' },
  { value: 'dakahlia', label: 'Dakahlia - الدقهلية' },
  { value: 'red_sea', label: 'Red Sea - البحر الأحمر' },
  { value: 'beheira', label: 'Beheira - البحيرة' },
  { value: 'fayoum', label: 'Fayoum - الفيوم' },
  { value: 'gharbia', label: 'Gharbia - الغربية' },
  { value: 'ismailia', label: 'Ismailia - الإسماعيلية' },
  { value: 'menofia', label: 'Menofia - المنوفية' },
  { value: 'minya', label: 'Minya - المنيا' },
  { value: 'qaliubiya', label: 'Qaliubiya - القليوبية' },
  { value: 'new_valley', label: 'New Valley - الوادي الجديد' },
  { value: 'suez', label: 'Suez - السويس' },
  { value: 'aswan', label: 'Aswan - أسوان' },
  { value: 'assiut', label: 'Assiut - أسيوط' },
  { value: 'beni_suef', label: 'Beni Suef - بني سويف' },
  { value: 'port_said', label: 'Port Said - بورسعيد' },
  { value: 'damietta', label: 'Damietta - دمياط' },
  { value: 'sharqia', label: 'Sharqia - الشرقية' },
  { value: 'south_sinai', label: 'South Sinai - جنوب سيناء' },
  { value: 'kafr_el_sheikh', label: 'Kafr El Sheikh - كفر الشيخ' },
  { value: 'matrouh', label: 'Matrouh - مطروح' },
  { value: 'luxor', label: 'Luxor - الأقصر' },
  { value: 'qena', label: 'Qena - قنا' },
  { value: 'north_sinai', label: 'North Sinai - شمال سيناء' },
  { value: 'sohag', label: 'Sohag - سوهاج' },
];

function statusBadgeClass(status: string | undefined): string {
  switch (status) {
    case 'active':
      return 'bg-teal-900 text-teal-300';
    case 'suspended':
      return 'bg-red-900 text-red-300';
    case 'pending':
      return 'bg-amber-900 text-amber-300';
    case 'pending_cancellation':
      return 'bg-amber-900 text-amber-200';
    case 'cancelled':
      return 'bg-slate-700 text-slate-200';
    case 'rejected':
      return 'bg-gray-200 text-slate-600 dark:bg-slate-700 dark:text-slate-400';
    default:
      return 'bg-gray-200 text-slate-600 dark:bg-slate-700 dark:text-slate-400';
  }
}

function invoiceDisplayStatus(inv: Record<string, unknown>): string {
  const st = String(inv.status ?? '');
  if (st === 'pending' && inv.due_date) {
    const due = new Date(String(inv.due_date)).getTime();
    if (!isNaN(due) && due < Date.now()) return 'overdue';
  }
  return st;
}

function invoiceStatusBadgeClass(status: string): string {
  switch (status) {
    case 'paid':
      return 'bg-green-900 text-green-300';
    case 'pending':
      return 'bg-amber-900 text-amber-300';
    case 'overdue':
      return 'bg-red-900 text-red-300';
    case 'cancelled':
      return 'bg-gray-200 text-slate-600 dark:bg-slate-700 dark:text-slate-400';
    case 'approved':
      return 'bg-teal-900 text-teal-300';
    case 'rejected':
    case 'failed':
      return 'bg-red-900 text-red-300';
    case 'chargeback':
      return 'bg-orange-900 text-orange-300';
    default:
      return 'bg-gray-200 text-slate-600 dark:bg-slate-700 dark:text-slate-400';
  }
}

const CREATE_INVOICE_TYPES = [
  'base_subscription',
  'subscription',
  'whatsapp_addon',
  'setup_fee',
  'payment_proof',
  'announcement_settlement',
  'announcement_cap',
  'plan_upgrade_difference',
  'pack_billing',
] as const;

export default function CenterManagementClient({ centerId }: CenterManagementClientProps) {
  const t = useTranslations('admin');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const toast = useToast();
  const { closeMainSidebar } = useSidebar() ?? {};
  const { setHideShell } = useLayout();
  const isRTL = locale === 'ar';

  const [data, setData] = useState<CenterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [dataFetchedAt, setDataFetchedAt] = useState<number>(0);

  const [s1Name, setS1Name] = useState('');
  const [s1OwnerName, setS1OwnerName] = useState('');
  const [s1Phone, setS1Phone] = useState('');
  const [s1Email, setS1Email] = useState('');
  const [s1City, setS1City] = useState('');
  const [s1District, setS1District] = useState('');
  const [s1Governorate, setS1Governorate] = useState('');
  const [s1CenterCode, setS1CenterCode] = useState('');
  const [s1CardColor, setS1CardColor] = useState('#0D9488');
  const [s1SignupNotes, setS1SignupNotes] = useState('');
  const [s1Saving, setS1Saving] = useState(false);

  // Section 2
  const [s2Status, setS2Status] = useState('');
  const [s2SubscriptionStatus, setS2SubscriptionStatus] = useState('');
  const [s2BillingStatus, setS2BillingStatus] = useState('');
  const [s2Plan, setS2Plan] = useState('');
  const [s2PricingType, setS2PricingType] = useState('fixed');
  const [s2BillingType, setS2BillingType] = useState('fixed');
  const [s2SubBillingPeriod, setS2SubBillingPeriod] = useState('quarterly');
  const [s2WeeklyStudentLimit, setS2WeeklyStudentLimit] = useState('');
  const [s2PaygRate, setS2PaygRate] = useState('');
  const [s2PlanWarning, setS2PlanWarning] = useState(false);
  const [s2Saving, setS2Saving] = useState(false);
  const [s2CancellationBusy, setS2CancellationBusy] = useState(false);

  // Section 3 - MUST precede handlePlanChange (which calls setS3AllInPrice, setS3BillingAmount)
  const [s3BillingAmount, setS3BillingAmount] = useState('');
  const [s3AllInPrice, setS3AllInPrice] = useState('');
  const [s3NextPaymentDue, setS3NextPaymentDue] = useState('');
  const [s3AutoSuspendAt, setS3AutoSuspendAt] = useState('');
  const [s3SubStartDate, setS3SubStartDate] = useState('');
  const [s3IsEarlyAdopter, setS3IsEarlyAdopter] = useState(false);
  const [s3EarlyAdopterPrice, setS3EarlyAdopterPrice] = useState('');
  const [s3EarlyAdopterNumber, setS3EarlyAdopterNumber] = useState('');
  const [s3Saving, setS3Saving] = useState(false);

  // Section 4
  const [s4Invoices, setS4Invoices] = useState<Record<string, unknown>[]>([]);
  const [s4ExpandedId, setS4ExpandedId] = useState<string | null>(null);
  const [s4StatusChanges, setS4StatusChanges] = useState<Record<string, string>>({});
  const [s4DiscountInputs, setS4DiscountInputs] = useState<Record<string, string>>({});
  const [s4MarkPaidId, setS4MarkPaidId] = useState<string | null>(null);
  const [s4MarkPaidMethod, setS4MarkPaidMethod] = useState('cash');
  const [s4MarkPaidRef, setS4MarkPaidRef] = useState('');
  const [s4MarkPaidAt, setS4MarkPaidAt] = useState('');
  const [s4ShowCreate, setS4ShowCreate] = useState(false);
  const [s4CreateType, setS4CreateType] = useState('subscription');
  const [s4CreateAmount, setS4CreateAmount] = useState('');
  const [s4CreatePeriodStart, setS4CreatePeriodStart] = useState('');
  const [s4CreatePeriodEnd, setS4CreatePeriodEnd] = useState('');
  const [s4CreateDueDate, setS4CreateDueDate] = useState('');
  const [s4CreateError, setS4CreateError] = useState('');
  const [s4CreateSaving, setS4CreateSaving] = useState(false);
  const [s4ActionLoadingId, setS4ActionLoadingId] = useState<string | null>(null);

  // Section 5
  const [s5History, setS5History] = useState<Record<string, unknown>[]>([]);
  const [s5ShowModal, setS5ShowModal] = useState(false);
  const [s5Date, setS5Date] = useState('');
  const [s5Amount, setS5Amount] = useState('');
  const [s5Method, setS5Method] = useState('cash');
  const [s5Notes, setS5Notes] = useState('');
  const [s5AmountError, setS5AmountError] = useState('');
  const [s5Saving, setS5Saving] = useState(false);

  // Section 6
  const [s6PackEnabled, setS6PackEnabled] = useState(false);
  const [s6PackRequestStatus, setS6PackRequestStatus] = useState('none');
  const [s6PackPrice, setS6PackPrice] = useState('12');
  const [s6PackCustomMin, setS6PackCustomMin] = useState('');
  const [s6PackPendingBalance, setS6PackPendingBalance] = useState('0');
  const [s6PackMonthsNoInvoice, setS6PackMonthsNoInvoice] = useState('0');
  const [s6PackRejectionReason, setS6PackRejectionReason] = useState('');
  const [s6Saving, setS6Saving] = useState(false);

  // Section 7
  const [s7Balance, setS7Balance] = useState('0');
  const [s7PricePerBlast, setS7PricePerBlast] = useState('8');
  const [s7Cap, setS7Cap] = useState('1500');
  const [s7Saving, setS7Saving] = useState(false);

  // Section 8
  const [s8IndividualAlerts, setS8IndividualAlerts] = useState(false);
  const [s8DailySummary, setS8DailySummary] = useState(true);
  const [s8SummerMode, setS8SummerMode] = useState(false);
  const [s8WhatsappOptedIn, setS8WhatsappOptedIn] = useState(false);
  const [s8ScheduleStart, setS8ScheduleStart] = useState('8');
  const [s8ScheduleEnd, setS8ScheduleEnd] = useState('20');
  const [s8InstapayNumber, setS8InstapayNumber] = useState('');
  const [s8ScheduleError, setS8ScheduleError] = useState('');
  const [s8Saving, setS8Saving] = useState(false);

  // Section 9
  const [s9Requests, setS9Requests] = useState<Record<string, unknown>[]>([]);
  const [s9ActionLoading, setS9ActionLoading] = useState(false);
  const [s9ApproveId, setS9ApproveId] = useState<string | null>(null);
  const [s9ApprovePlan, setS9ApprovePlan] = useState('');
  const [s9ApproveBilling, setS9ApproveBilling] = useState('');
  const [s9ApproveAllIn, setS9ApproveAllIn] = useState('');
  const [s9RejectId, setS9RejectId] = useState<string | null>(null);
  const [s9RejectNotes, setS9RejectNotes] = useState('');
  const [s9RejectNotesError, setS9RejectNotesError] = useState('');
  const [s9ShowOverride, setS9ShowOverride] = useState(false);
  const [s9OverridePlan, setS9OverridePlan] = useState('nano');
  const [s9OverrideBilling, setS9OverrideBilling] = useState('');
  const [s9OverrideAllIn, setS9OverrideAllIn] = useState('');

  // Section 10
  const [s10Commissions, setS10Commissions] = useState<Record<string, unknown>[]>([]);
  const [s10RewardStatus, setS10RewardStatus] = useState('pending');
  const [s10RewardAmount, setS10RewardAmount] = useState('0');
  const [s10CommLoadingId, setS10CommLoadingId] = useState<string | null>(null);
  const [s10Saving, setS10Saving] = useState(false);
  const [s10CopiedCode, setS10CopiedCode] = useState(false);

  // Section 11
  const [s11ShowBlacklist, setS11ShowBlacklist] = useState(false);
  const [s11Reason, setS11Reason] = useState('');
  const [s11ReasonError, setS11ReasonError] = useState('');
  const [s11ShowUnblacklist, setS11ShowUnblacklist] = useState(false);
  const [s11Loading, setS11Loading] = useState(false);

  const [opsNotes, setOpsNotes] = useState<Record<string, unknown>[]>([]);
  const [opsNotesLoading, setOpsNotesLoading] = useState(false);
  const [opsNewNote, setOpsNewNote] = useState('');
  const [opsAddingNote, setOpsAddingNote] = useState(false);
  const [opsPinBusyId, setOpsPinBusyId] = useState<string | null>(null);
  const [opsDeleteBusyId, setOpsDeleteBusyId] = useState<string | null>(null);
  const [opsWaText, setOpsWaText] = useState('');
  const [opsSendingWa, setOpsSendingWa] = useState(false);
  const [opsAuditLogs, setOpsAuditLogs] = useState<Record<string, unknown>[]>([]);
  const [opsAuditLoading, setOpsAuditLoading] = useState(false);

  const getSession = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
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

  const getPdfAuthHeaders = useCallback(async () => {
    const session = await getSession();
    if (!session) return null;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${session.access_token}`,
    };
    const csrf = await getCsrfHeaders(session.access_token);
    Object.assign(headers, csrf);
    return headers;
  }, [getSession]);

  const openAdminInvoicePdf = useCallback(
    async (invoiceId: string) => {
      const headers = await getPdfAuthHeaders();
      if (!headers) {
        toast.error(t('centerManagement.error'));
        return;
      }
      try {
        const res = await fetch(`/api/admin/invoices/${invoiceId}/pdf`, { headers });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          toast.error(typeof j.error === 'string' ? j.error : t('centerManagement.error'));
          return;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const opened = window.open(url, '_blank', 'noopener,noreferrer');
        if (!opened) {
          toast.error(t('centerManagement.error'));
          URL.revokeObjectURL(url);
          return;
        }
        setTimeout(() => URL.revokeObjectURL(url), 120_000);
      } catch {
        toast.error(t('centerManagement.error'));
      }
    },
    [getPdfAuthHeaders, t, toast],
  );

  const showApiError = useCallback(
    (j: Record<string, unknown>) => {
      const ek = typeof j.errorKey === 'string' ? j.errorKey : '';
      if (ek) {
        const base = t(ek as never);
        const detail = typeof j.errorDetail === 'string' ? j.errorDetail : '';
        toast.error(
          detail && ek === 'manualWA.errors.sendFailed' ? `${base}: ${detail}` : base,
        );
        return;
      }
      toast.error(typeof j.error === 'string' ? j.error : t('centerManagement.error'));
    },
    [t, toast],
  );

  const refreshOpsPanels = useCallback(async () => {
    const headers = await getAuthHeaders();
    if (!headers) return;
    setOpsNotesLoading(true);
    setOpsAuditLoading(true);
    try {
      const [nRes, aRes] = await Promise.all([
        fetch(`/api/admin/centers/${centerId}/notes`, { headers }),
        fetch(`/api/admin/centers/${centerId}/audit-log`, { headers }),
      ]);
      const nj = (await nRes.json().catch(() => ({}))) as { notes?: Record<string, unknown>[] };
      const aj = (await aRes.json().catch(() => ({}))) as { logs?: Record<string, unknown>[] };
      if (nRes.ok && Array.isArray(nj.notes)) setOpsNotes(nj.notes);
      else if (!nRes.ok) toast.error(t('centerNotes.loadError'));
      if (aRes.ok && Array.isArray(aj.logs)) setOpsAuditLogs(aj.logs);
      else if (!aRes.ok) toast.error(t('auditLog.loadError'));
    } finally {
      setOpsNotesLoading(false);
      setOpsAuditLoading(false);
    }
  }, [centerId, getAuthHeaders, t, toast]);

  useEffect(() => {
    if (loading || !data?.center) return;
    void refreshOpsPanels();
  }, [loading, data?.center, dataFetchedAt, refreshOpsPanels]);

  const handlePlanChange = (newPlan: string) => {
    setS2Plan(newPlan);
    setS2PlanWarning(false);
    const planData = data?.pricingPlans?.find((p: Record<string, unknown>) => p.plan_key === newPlan);
    if (planData && planData.all_in_price != null) {
      const monthly = Number(planData.all_in_price);
      if (!isNaN(monthly)) {
        setS3AllInPrice(String(monthly));
        setS3BillingAmount(String(monthly * 3));
        setS2PlanWarning(true);
      }
    } else if (newPlan === 'top_centers') {
      setS3AllInPrice('0');
      setS3BillingAmount('0');
      setS2PlanWarning(true);
    }
  };

  const openMarkPaidModal = (invId: string) => {
    setS4MarkPaidId(invId);
    setS4MarkPaidMethod('cash');
    setS4MarkPaidRef('');
    setS4MarkPaidAt(new Date().toISOString().slice(0, 10));
  };

  const openCreateModal = () => {
    setS4ShowCreate(true);
    setS4CreateType('subscription');
    setS4CreateAmount('');
    setS4CreatePeriodStart('');
    setS4CreatePeriodEnd('');
    setS4CreateDueDate('');
    setS4CreateError('');
  };

  const openRecordModal = () => {
    setS5ShowModal(true);
    setS5Amount('');
    setS5Method('cash');
    setS5Notes('');
    setS5AmountError('');
    setS5Date(new Date().toISOString().slice(0, 10));
  };

  const parseHour = (s: string, defaultVal: number): number => {
    const n = parseInt(s, 10);
    return !isNaN(n) && n >= 0 && n <= 23 ? n : defaultVal;
  };

  const getRecordedByName = (recordedById: unknown): string => {
    if (!recordedById) return 'System';
    const found = data?.adminUsers?.find(
      (u: Record<string, unknown>) => String(u.id) === String(recordedById),
    );
    return (found?.name as string) ?? String(recordedById).slice(0, 8) + '...';
  };

  const computePlanBilling = (planKey: string): { billing: string; allIn: string } => {
    const planData = data?.pricingPlans?.find((p: Record<string, unknown>) => p.plan_key === planKey);
    if (planData && planData.all_in_price != null) {
      const monthly = Number(planData.all_in_price);
      if (!isNaN(monthly)) return { billing: String(monthly * 3), allIn: String(monthly) };
    }
    if (planKey === 'top_centers') return { billing: '0', allIn: '0' };
    return { billing: '', allIn: '' };
  };

  const openApproveModal = (request: Record<string, unknown>) => {
    const requestId = request.id as string;
    const requestedPlan = (request.requested_plan as string) ?? 'nano';
    const { billing, allIn } = computePlanBilling(requestedPlan);
    setS9ApproveId(requestId);
    setS9ApprovePlan(requestedPlan);
    setS9ApproveBilling(billing);
    setS9ApproveAllIn(allIn);
  };

  const handleApprovePlanChange = (newPlan: string) => {
    setS9ApprovePlan(newPlan);
    const { billing, allIn } = computePlanBilling(newPlan);
    setS9ApproveBilling(billing);
    setS9ApproveAllIn(allIn);
  };

  const openOverrideModal = () => {
    const currentPlan = (data?.center?.plan as string) ?? 'nano';
    const { billing, allIn } = computePlanBilling(currentPlan);
    setS9OverridePlan(currentPlan);
    setS9OverrideBilling(billing);
    setS9OverrideAllIn(allIn);
    setS9ShowOverride(true);
  };

  const handleOverridePlanChange = (newPlan: string) => {
    setS9OverridePlan(newPlan);
    const { billing, allIn } = computePlanBilling(newPlan);
    setS9OverrideBilling(billing);
    setS9OverrideAllIn(allIn);
  };

  const formatDate = (val: unknown): string => {
    if (!val) return tCommon('notSet');
    const d = new Date(val as string);
    return isNaN(d.getTime())
      ? String(val)
      : d.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        });
  };
  const shortUuid = (val: unknown): string => (val ? String(val).slice(0, 8) + '...' : tCommon('notSet'));
  const getAdminName = (id: unknown): string => {
    if (!id) return tCommon('notSet');
    const found = data?.adminUsers?.find((u: Record<string, unknown>) => String(u.id) === String(id));
    return (found?.name as string) ?? shortUuid(id);
  };

  useEffect(() => {
    setLoading(true);
    setFetchError(null);
    let cancelled = false;
    void (async () => {
      try {
        const session = await getSession();
        if (!session?.access_token) {
          throw new Error(t('centerManagement.error'));
        }
        const res = await fetch(`/api/admin/centers/${centerId}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || t('centerManagement.error'));
        }
        const json = (await res.json()) as CenterData;
        if (!cancelled) {
          setData(json);
          setDataFetchedAt(Date.now());
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setFetchError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [centerId, retryCount, getSession, t]);

  useEffect(() => {
    if (!data?.center) return;
    const c = data.center;
    setS1Name((c.name as string) ?? '');
    setS1OwnerName((c.owner_name as string) ?? '');
    setS1Phone((c.phone as string) ?? '');
    setS1Email((c.email as string) ?? '');
    setS1City((c.city as string) ?? '');
    setS1District((c.district as string) ?? '');
    const gov = (c.governorate as string) ?? '';
    setS1Governorate(gov ? gov.toLowerCase() : '');
    setS1CenterCode((c.center_code as string) ?? '');
    setS1CardColor((c.card_color as string) ?? '#0D9488');
    setS1SignupNotes((c.signup_notes as string) ?? '');
    setS2Status((c.status as string) ?? '');
    setS2SubscriptionStatus((c.subscription_status as string) ?? '');
    setS2BillingStatus((c.billing_status as string) ?? '');
    setS2Plan((c.plan as string) ?? '');
    setS2PricingType((c.pricing_type as string) ?? 'fixed');
    setS2BillingType((c.billing_type as string) ?? 'fixed');
    setS2SubBillingPeriod((c.subscription_billing_period as string) ?? 'quarterly');
    setS2WeeklyStudentLimit(c.weekly_student_limit != null ? String(c.weekly_student_limit) : '');
    setS2PaygRate(c.payg_rate != null ? String(c.payg_rate) : '');
    setS3BillingAmount(c.billing_amount != null ? String(c.billing_amount) : '');
    setS3AllInPrice(c.all_in_price != null ? String(c.all_in_price) : '');
    setS3NextPaymentDue((c.next_payment_due as string) ?? '');
    setS3AutoSuspendAt((c.auto_suspend_at as string) ?? '');
    setS3SubStartDate((c.subscription_start_date as string) ?? '');
    setS3IsEarlyAdopter((c.is_early_adopter as boolean) ?? false);
    setS3EarlyAdopterPrice(c.early_adopter_price != null ? String(c.early_adopter_price) : '');
    setS3EarlyAdopterNumber(c.early_adopter_number != null ? String(c.early_adopter_number) : '');
    setS6PackEnabled((c.parent_pack_enabled as boolean) ?? false);
    setS6PackRequestStatus((c.pack_request_status as string) ?? 'none');
    setS6PackPrice(c.pack_price_per_parent != null ? String(c.pack_price_per_parent) : '12');
    setS6PackCustomMin(c.pack_custom_invoice_minimum != null ? String(c.pack_custom_invoice_minimum) : '');
    setS6PackPendingBalance(c.pack_pending_balance != null ? String(c.pack_pending_balance) : '0');
    setS6PackMonthsNoInvoice(c.pack_months_without_invoice != null ? String(c.pack_months_without_invoice) : '0');
    setS6PackRejectionReason((c.pack_rejection_reason as string) ?? '');
    setS7Balance(c.announcement_balance != null ? String(c.announcement_balance) : '0');
    setS7PricePerBlast(c.announcement_price_per_blast != null ? String(c.announcement_price_per_blast) : '8');
    setS7Cap(c.announcement_cap != null ? String(c.announcement_cap) : '1500');
    setS8IndividualAlerts((c.individual_alerts_enabled as boolean) ?? false);
    setS8DailySummary((c.daily_summary_enabled as boolean) ?? true);
    setS8SummerMode((c.summer_mode as boolean) ?? false);
    setS8WhatsappOptedIn((c.whatsapp_opted_in as boolean) ?? false);
    setS8ScheduleStart(c.schedule_start_hour != null ? String(c.schedule_start_hour) : '8');
    setS8ScheduleEnd(c.schedule_end_hour != null ? String(c.schedule_end_hour) : '20');
    setS8InstapayNumber((c.instapay_number as string) ?? '');
    setS10RewardStatus((c.referral_reward_status as string) ?? 'pending');
    setS10RewardAmount(c.referral_reward_amount != null ? String(c.referral_reward_amount) : '0');
  }, [data?.center?.id]);

  useEffect(() => {
    if (!data) return;
    setS4Invoices((data.invoices ?? []) as Record<string, unknown>[]);
    setS5History((data.renewalHistory ?? []) as Record<string, unknown>[]);
    setS9Requests((data.planRequests ?? []) as Record<string, unknown>[]);
    setS10Commissions((data.referralCommissions ?? []) as Record<string, unknown>[]);
  }, [dataFetchedAt]);

  useEffect(() => {
    setHideShell(true);
    return () => setHideShell(false);
  }, [setHideShell]);

  useEffect(() => {
    closeMainSidebar?.();
  }, [closeMainSidebar]);

  const saveSection1 = async () => {
    const headers = await getAuthHeaders();
    if (!headers) {
      toast.error(tCommon('errorGeneric'));
      return;
    }
    setS1Saving(true);
    try {
      const res = await fetch(`/api/admin/centers/${centerId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          name: s1Name,
          owner_name: s1OwnerName,
          phone: s1Phone,
          email: s1Email,
          city: s1City,
          district: s1District,
          governorate: s1Governorate || null,
          center_code: s1CenterCode,
          card_color: s1CardColor,
          signup_notes: s1SignupNotes,
        }),
      });
      const raw = await res.text();
      let body: { error?: string; center?: Record<string, unknown> } = {};
      try {
        body = JSON.parse(raw) as typeof body;
      } catch {
        /* non-JSON */
      }
      if (!res.ok) {
        const msg = typeof body.error === 'string' ? body.error : raw;
        if (
          msg.includes('center_code') ||
          msg.includes('unique') ||
          msg.includes('23505')
        ) {
          toast.error(t('centerManagement.section1.centerCodeDuplicate'));
        } else {
          toast.error(typeof body.error === 'string' ? body.error : t('centerManagement.saveError'));
        }
        return;
      }
      if (body.center) {
        setData((prev) => (prev ? { ...prev, center: body.center! } : prev));
      }
      toast.success(t('centerManagement.saveSuccess'));
    } catch {
      toast.error(t('centerManagement.saveError'));
    } finally {
      setS1Saving(false);
    }
  };

  const saveSection2 = async () => {
    const headers = await getAuthHeaders();
    if (!headers) {
      toast.error(tCommon('errorGeneric'));
      return;
    }
    setS2Saving(true);
    try {
      const res = await fetch(`/api/admin/centers/${centerId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          status: s2Status,
          subscription_status: s2SubscriptionStatus,
          billing_status: s2BillingStatus,
          plan: s2Plan,
          pricing_type: s2PricingType,
          billing_type: s2BillingType,
          subscription_billing_period: s2SubBillingPeriod,
          weekly_student_limit: s2WeeklyStudentLimit !== '' ? Number(s2WeeklyStudentLimit) : null,
          payg_rate: s2PaygRate !== '' ? Number(s2PaygRate) : null,
        }),
      });
      const raw = await res.text();
      let body: { error?: string; center?: Record<string, unknown> } = {};
      try {
        body = JSON.parse(raw) as typeof body;
      } catch {
        /* non-JSON */
      }
      if (!res.ok) {
        toast.error(typeof body.error === 'string' ? body.error : t('centerManagement.saveError'));
        return;
      }
      if (body.center) {
        setData((prev) => (prev ? { ...prev, center: body.center! } : prev));
      }
      toast.success(t('centerManagement.saveSuccess'));
    } catch {
      toast.error(t('centerManagement.saveError'));
    } finally {
      setS2Saving(false);
    }
  };

  const patchCancellationAction = async (cancellationAction: 'approve_cancellation' | 'reject_cancellation') => {
    const headers = await getAuthHeaders();
    if (!headers) {
      toast.error(tCommon('errorGeneric'));
      return;
    }
    setS2CancellationBusy(true);
    try {
      const res = await fetch(`/api/admin/centers/${centerId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ action: cancellationAction }),
      });
      const raw = await res.text();
      let body: { error?: string; center?: Record<string, unknown> } = {};
      try {
        body = JSON.parse(raw) as typeof body;
      } catch {
        /* non-JSON */
      }
      if (!res.ok) {
        toast.error(typeof body.error === 'string' ? body.error : t('centerManagement.saveError'));
        return;
      }
      if (body.center) {
        setData((prev) => (prev ? { ...prev, center: body.center! } : prev));
      }
      toast.success(
        cancellationAction === 'approve_cancellation'
          ? t('centerManagement.cancellation.approved')
          : t('centerManagement.cancellation.rejected'),
      );
    } catch {
      toast.error(t('centerManagement.saveError'));
    } finally {
      setS2CancellationBusy(false);
    }
  };

  const saveSection3 = async () => {
    const headers = await getAuthHeaders();
    if (!headers) {
      toast.error(tCommon('errorGeneric'));
      return;
    }
    setS3Saving(true);
    try {
      const res = await fetch(`/api/admin/centers/${centerId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          billing_amount: s3BillingAmount !== '' ? Number(s3BillingAmount) : null,
          all_in_price: s3AllInPrice !== '' ? Number(s3AllInPrice) : null,
          next_payment_due: s3NextPaymentDue || null,
          auto_suspend_at: s3AutoSuspendAt || null,
          subscription_start_date: s3SubStartDate || null,
          is_early_adopter: s3IsEarlyAdopter,
          early_adopter_price: s3EarlyAdopterPrice !== '' ? Number(s3EarlyAdopterPrice) : null,
          early_adopter_number: s3EarlyAdopterNumber !== '' ? Number(s3EarlyAdopterNumber) : null,
        }),
      });
      const raw = await res.text();
      let body: { error?: string; center?: Record<string, unknown> } = {};
      try {
        body = JSON.parse(raw) as typeof body;
      } catch {
        /* non-JSON */
      }
      if (!res.ok) {
        toast.error(typeof body.error === 'string' ? body.error : t('centerManagement.saveError'));
        return;
      }
      if (body.center) {
        setData((prev) => (prev ? { ...prev, center: body.center! } : prev));
      }
      toast.success(t('centerManagement.saveSuccess'));
    } catch {
      toast.error(t('centerManagement.saveError'));
    } finally {
      setS3Saving(false);
    }
  };

  const saveInvoiceStatus = async (invId: string) => {
    const newStatus = s4StatusChanges[invId];
    if (!newStatus) return;
    const headers = await getAuthHeaders();
    if (!headers) {
      toast.error(tCommon('errorGeneric'));
      return;
    }
    setS4ActionLoadingId(invId);
    try {
      const response = await fetch(`/api/admin/centers/${centerId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ action: 'update_invoice', invoiceId: invId, status: newStatus }),
      });
      const raw = await response.text();
      let res: { error?: string; invoice?: Record<string, unknown> } = {};
      try {
        res = JSON.parse(raw) as typeof res;
      } catch {
        /* non-JSON */
      }
      if (!response.ok) {
        toast.error(typeof res.error === 'string' ? res.error : t('centerManagement.saveError'));
        return;
      }
      if (res?.invoice) {
        setS4Invoices((prev) => prev.map((i) => (String(i.id) === invId ? { ...i, ...res.invoice } : i)));
      }
      toast.success(t('centerManagement.saveSuccess'));
    } finally {
      setS4ActionLoadingId(null);
    }
  };

  const saveInvoiceDiscount = async (invId: string) => {
    const val = s4DiscountInputs[invId] ?? '';
    if (val === '') return;
    const headers = await getAuthHeaders();
    if (!headers) {
      toast.error(tCommon('errorGeneric'));
      return;
    }
    setS4ActionLoadingId(invId);
    try {
      const response = await fetch(`/api/admin/centers/${centerId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          action: 'update_invoice',
          invoiceId: invId,
          discountAmount: Number(val),
        }),
      });
      const raw = await response.text();
      let res: { error?: string; invoice?: Record<string, unknown> } = {};
      try {
        res = JSON.parse(raw) as typeof res;
      } catch {
        /* non-JSON */
      }
      if (!response.ok) {
        toast.error(typeof res.error === 'string' ? res.error : t('centerManagement.saveError'));
        return;
      }
      if (res?.invoice) {
        setS4Invoices((prev) => prev.map((i) => (String(i.id) === invId ? { ...i, ...res.invoice } : i)));
      }
      toast.success(t('centerManagement.saveSuccess'));
    } finally {
      setS4ActionLoadingId(null);
    }
  };

  const confirmMarkPaid = async () => {
    const capturedId = s4MarkPaidId!;
    setS4MarkPaidId(null);
    const headers = await getAuthHeaders();
    if (!headers) {
      toast.error(tCommon('errorGeneric'));
      return;
    }
    setS4ActionLoadingId(capturedId);
    try {
      const response = await fetch(`/api/admin/centers/${centerId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          action: 'update_invoice',
          invoiceId: capturedId,
          status: 'paid',
          paymentMethod: s4MarkPaidMethod,
          paymentReference: s4MarkPaidRef,
          paidAt: s4MarkPaidAt,
        }),
      });
      const raw = await response.text();
      let res: { error?: string; invoice?: Record<string, unknown> } = {};
      try {
        res = JSON.parse(raw) as typeof res;
      } catch {
        /* non-JSON */
      }
      if (!response.ok) {
        toast.error(typeof res.error === 'string' ? res.error : t('centerManagement.saveError'));
        return;
      }
      if (res?.invoice) {
        setS4Invoices((prev) =>
          prev.map((i) => (String(i.id) === capturedId ? { ...i, ...res.invoice } : i)),
        );
      }
      toast.success(t('centerManagement.saveSuccess'));
    } finally {
      setS4ActionLoadingId(null);
    }
  };

  const cancelInvoice = async (invId: string) => {
    if (!window.confirm(tCommon('confirm'))) return;
    const headers = await getAuthHeaders();
    if (!headers) {
      toast.error(tCommon('errorGeneric'));
      return;
    }
    setS4ActionLoadingId(invId);
    try {
      const response = await fetch(`/api/admin/centers/${centerId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ action: 'update_invoice', invoiceId: invId, status: 'cancelled' }),
      });
      const raw = await response.text();
      let res: { error?: string; invoice?: Record<string, unknown> } = {};
      try {
        res = JSON.parse(raw) as typeof res;
      } catch {
        /* non-JSON */
      }
      if (!response.ok) {
        toast.error(typeof res.error === 'string' ? res.error : t('centerManagement.saveError'));
        return;
      }
      if (res?.invoice) {
        setS4Invoices((prev) => prev.map((i) => (String(i.id) === invId ? { ...i, ...res.invoice } : i)));
      }
      toast.success(t('centerManagement.saveSuccess'));
    } finally {
      setS4ActionLoadingId(null);
    }
  };

  const submitCreateInvoice = async () => {
    setS4CreateError('');
    if (isNaN(Number(s4CreateAmount)) || Number(s4CreateAmount) <= 0) {
      setS4CreateError(t('centerManagement.saveError'));
      return;
    }
    if (!s4CreatePeriodStart || !s4CreatePeriodEnd || !s4CreateDueDate) {
      setS4CreateError(t('centerManagement.saveError'));
      return;
    }
    const headers = await getAuthHeaders();
    if (!headers) {
      toast.error(tCommon('errorGeneric'));
      return;
    }
    setS4CreateSaving(true);
    try {
      const response = await fetch(`/api/admin/centers/${centerId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          action: 'create_invoice',
          invoiceType: s4CreateType,
          totalAmount: Number(s4CreateAmount),
          billingPeriodStart: s4CreatePeriodStart,
          billingPeriodEnd: s4CreatePeriodEnd,
          dueDate: s4CreateDueDate,
        }),
      });
      const raw = await response.text();
      let res: { error?: string; invoice?: Record<string, unknown> } = {};
      try {
        res = JSON.parse(raw) as typeof res;
      } catch {
        /* non-JSON */
      }
      if (!response.ok) {
        setS4CreateError(typeof res.error === 'string' ? res.error : t('centerManagement.saveError'));
        return;
      }
      if (res?.invoice) {
        setS4Invoices((prev) => [res.invoice!, ...prev]);
      }
      setS4ShowCreate(false);
      toast.success(t('centerManagement.saveSuccess'));
    } finally {
      setS4CreateSaving(false);
    }
  };

  const submitRecordPayment = async () => {
    setS5AmountError('');
    if (isNaN(Number(s5Amount)) || Number(s5Amount) <= 0) {
      setS5AmountError(t('centerManagement.section5.amountRequired'));
      return;
    }
    const headers = await getAuthHeaders();
    if (!headers) {
      toast.error(tCommon('errorGeneric'));
      return;
    }
    setS5Saving(true);
    try {
      const response = await fetch(`/api/admin/centers/${centerId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          action: 'record_payment',
          renewalDate: s5Date,
          amountPaid: Number(s5Amount),
          paymentMethod: s5Method,
          notes: s5Notes || null,
        }),
      });
      const raw = await response.text();
      let res: { error?: string; renewal?: Record<string, unknown> } = {};
      try {
        res = JSON.parse(raw) as typeof res;
      } catch {
        /* non-JSON */
      }
      if (!response.ok) {
        toast.error(typeof res.error === 'string' ? res.error : t('centerManagement.saveError'));
        return;
      }
      const r = res;
      if (r?.renewal) {
        setS5History((prev) => [r.renewal!, ...prev]);
      }
      setS5ShowModal(false);
      setS5Date(new Date().toISOString().slice(0, 10)); // record_payment
      setS5Amount('');
      setS5Method('cash');
      setS5Notes('');
      toast.success(t('centerManagement.saveSuccess'));
    } finally {
      setS5Saving(false);
    }
  };

  const saveSection6 = async () => {
    const headers = await getAuthHeaders();
    if (!headers) {
      toast.error(tCommon('errorGeneric'));
      return;
    }
    setS6Saving(true);
    try {
      const res = await fetch(`/api/admin/centers/${centerId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          parent_pack_enabled: s6PackEnabled,
          pack_request_status: s6PackRequestStatus,
          pack_price_per_parent: Number(s6PackPrice),
          pack_custom_invoice_minimum: s6PackCustomMin !== '' ? Number(s6PackCustomMin) : null,
          pack_pending_balance: Number(s6PackPendingBalance),
          pack_months_without_invoice: Number(s6PackMonthsNoInvoice),
          pack_rejection_reason: s6PackRejectionReason || null,
        }),
      });
      const raw = await res.text();
      let body: { error?: string; center?: Record<string, unknown> } = {};
      try {
        body = JSON.parse(raw) as typeof body;
      } catch {
        /* non-JSON */
      }
      if (!res.ok) {
        toast.error(typeof body.error === 'string' ? body.error : t('centerManagement.saveError'));
        return;
      }
      if (body.center) {
        setData((prev) => (prev ? { ...prev, center: body.center! } : prev));
      }
      toast.success(t('centerManagement.saveSuccess'));
    } catch {
      toast.error(t('centerManagement.saveError'));
    } finally {
      setS6Saving(false);
    }
  };

  const saveSection7 = async () => {
    const headers = await getAuthHeaders();
    if (!headers) {
      toast.error(tCommon('errorGeneric'));
      return;
    }
    setS7Saving(true);
    try {
      const res = await fetch(`/api/admin/centers/${centerId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          announcement_balance: Number(s7Balance),
          announcement_price_per_blast: Number(s7PricePerBlast),
          announcement_cap: Number(s7Cap),
          announcement_balance_updated_at: new Date().toISOString(),
        }),
      });
      const raw = await res.text();
      let body: { error?: string; center?: Record<string, unknown> } = {};
      try {
        body = JSON.parse(raw) as typeof body;
      } catch {
        /* non-JSON */
      }
      if (!res.ok) {
        toast.error(typeof body.error === 'string' ? body.error : t('centerManagement.saveError'));
        return;
      }
      if (body.center) {
        setData((prev) => (prev ? { ...prev, center: body.center! } : prev));
      }
      toast.success(t('centerManagement.saveSuccess'));
    } catch {
      toast.error(t('centerManagement.saveError'));
    } finally {
      setS7Saving(false);
    }
  };

  const saveSection8 = async () => {
    const startVal = parseHour(s8ScheduleStart, 8);
    const endVal = parseHour(s8ScheduleEnd, 20);
    if (endVal <= startVal) {
      setS8ScheduleError(t('centerManagement.section8.scheduleHourError'));
      return;
    }
    setS8ScheduleError('');
    const headers = await getAuthHeaders();
    if (!headers) {
      toast.error(tCommon('errorGeneric'));
      return;
    }
    setS8Saving(true);
    try {
      const res = await fetch(`/api/admin/centers/${centerId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          individual_alerts_enabled: s8IndividualAlerts,
          daily_summary_enabled: s8DailySummary,
          summer_mode: s8SummerMode,
          whatsapp_opted_in: s8WhatsappOptedIn,
          schedule_start_hour: parseHour(s8ScheduleStart, 8),
          schedule_end_hour: parseHour(s8ScheduleEnd, 20),
          instapay_number: s8InstapayNumber.trim() || null,
        }),
      });
      const raw = await res.text();
      let body: { error?: string; center?: Record<string, unknown> } = {};
      try {
        body = JSON.parse(raw) as typeof body;
      } catch {
        /* non-JSON */
      }
      if (!res.ok) {
        toast.error(typeof body.error === 'string' ? body.error : t('centerManagement.saveError'));
        return;
      }
      if (body.center) {
        setData((prev) => (prev ? { ...prev, center: body.center! } : prev));
      }
      toast.success(t('centerManagement.saveSuccess'));
    } catch {
      toast.error(t('centerManagement.saveError'));
    } finally {
      setS8Saving(false);
    }
  };

  const confirmApprovePlanRequest = async () => {
    const capturedId = s9ApproveId;
    const capturedPlan = s9ApprovePlan;
    const capturedBilling = s9ApproveBilling;
    const capturedAllIn = s9ApproveAllIn;
    setS9ApproveId(null);
    if (!capturedId) return;
    const headers = await getAuthHeaders();
    if (!headers) {
      toast.error(tCommon('errorGeneric'));
      return;
    }
    setS9ActionLoading(true);
    try {
      const response = await fetch(`/api/admin/centers/${centerId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          action: 'approve_plan_request',
          planRequestId: capturedId,
          newPlan: capturedPlan,
          newBillingAmount: Number(capturedBilling),
          newAllInPrice: Number(capturedAllIn),
        }),
      });
      const raw = await response.text();
      let res: { error?: string } = {};
      try {
        res = JSON.parse(raw) as typeof res;
      } catch {
        /* non-JSON */
      }
      if (!response.ok) {
        toast.error(typeof res.error === 'string' ? res.error : t('centerManagement.saveError'));
        return;
      }
      setS9Requests((prev) =>
        prev.map((r) => (String(r.id) === capturedId ? { ...r, status: 'approved' } : r)),
      );
      toast.success(t('centerManagement.saveSuccess'));
    } finally {
      setS9ActionLoading(false);
    }
  };

  const confirmRejectPlanRequest = async () => {
    const capturedId = s9RejectId;
    if (!capturedId) return;
    if (!s9RejectNotes.trim()) {
      setS9RejectNotesError(t('centerManagement.section9.rejectNotesEmpty'));
      return;
    }
    const capturedNotes = s9RejectNotes.trim();
    setS9RejectId(null);
    const headers = await getAuthHeaders();
    if (!headers) {
      toast.error(tCommon('errorGeneric'));
      return;
    }
    setS9ActionLoading(true);
    try {
      const response = await fetch(`/api/admin/centers/${centerId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          action: 'reject_plan_request',
          planRequestId: capturedId,
          notes: capturedNotes,
        }),
      });
      const raw = await response.text();
      let res: { error?: string } = {};
      try {
        res = JSON.parse(raw) as typeof res;
      } catch {
        /* non-JSON */
      }
      if (!response.ok) {
        toast.error(typeof res.error === 'string' ? res.error : t('centerManagement.saveError'));
        return;
      }
      setS9Requests((prev) =>
        prev.map((r) => (String(r.id) === capturedId ? { ...r, status: 'rejected' } : r)),
      );
      toast.success(t('centerManagement.saveSuccess'));
    } finally {
      setS9ActionLoading(false);
    }
  };

  const confirmOverridePlan = async () => {
    const capturedPlan = s9OverridePlan;
    const capturedBilling = s9OverrideBilling;
    const capturedAllIn = s9OverrideAllIn;
    setS9ShowOverride(false);
    const headers = await getAuthHeaders();
    if (!headers) {
      toast.error(tCommon('errorGeneric'));
      return;
    }
    setS9ActionLoading(true);
    try {
      const response = await fetch(`/api/admin/centers/${centerId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          action: 'override_plan',
          newPlan: capturedPlan,
          newBillingAmount: Number(capturedBilling),
          newAllInPrice: Number(capturedAllIn),
        }),
      });
      const raw = await response.text();
      let res: { error?: string; center?: Record<string, unknown> } = {};
      try {
        res = JSON.parse(raw) as typeof res;
      } catch {
        /* non-JSON */
      }
      if (!response.ok) {
        toast.error(typeof res.error === 'string' ? res.error : t('centerManagement.saveError'));
        return;
      }
      setData((prev) =>
        prev
          ? {
              ...prev,
              center: {
                ...prev.center,
                plan: capturedPlan,
                billing_amount: Number(capturedBilling),
                all_in_price: Number(capturedAllIn),
              },
            }
          : prev,
      );
      setS3BillingAmount(capturedBilling);
      setS3AllInPrice(capturedAllIn);
      toast.success(t('centerManagement.saveSuccess'));
    } finally {
      setS9ActionLoading(false);
    }
  };

  const markCommissionPaidHandler = async (commission: Record<string, unknown>) => {
    const capturedId = String(commission.id ?? '');
    if (!capturedId) return;
    setS10CommLoadingId(capturedId);
    const headers = await getAuthHeaders();
    if (!headers) {
      toast.error(tCommon('errorGeneric'));
      setS10CommLoadingId(null);
      return;
    }
    try {
      const response = await fetch(`/api/admin/centers/${centerId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ action: 'mark_commission_paid', commissionId: capturedId }),
      });
      const raw = await response.text();
      let res: { error?: string } = {};
      try {
        res = JSON.parse(raw) as typeof res;
      } catch {
        /* non-JSON */
      }
      if (response.status === 404) {
        toast.error(t('centerManagement.section10.commissionTableUnavailable'));
        return;
      }
      if (!response.ok) {
        toast.error(typeof res.error === 'string' ? res.error : t('centerManagement.saveError'));
        return;
      }
      setS10Commissions((prev) =>
        prev.map((c) => (String(c.id) === capturedId ? { ...c, status: 'paid' } : c)),
      );
      toast.success(t('centerManagement.saveSuccess'));
    } finally {
      setS10CommLoadingId(null);
    }
  };

  const saveReferralRewardsSection10 = async () => {
    const headers = await getAuthHeaders();
    if (!headers) {
      toast.error(tCommon('errorGeneric'));
      return;
    }
    setS10Saving(true);
    try {
      const res = await fetch(`/api/admin/centers/${centerId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          referral_reward_status: s10RewardStatus,
          referral_reward_amount: Number(s10RewardAmount),
        }),
      });
      const raw = await res.text();
      let body: { error?: string; center?: Record<string, unknown> } = {};
      try {
        body = JSON.parse(raw) as typeof body;
      } catch {
        /* non-JSON */
      }
      if (!res.ok) {
        toast.error(typeof body.error === 'string' ? body.error : t('centerManagement.saveError'));
        return;
      }
      if (body.center) {
        setData((prev) => (prev ? { ...prev, center: body.center! } : prev));
      }
      toast.success(t('centerManagement.saveSuccess'));
    } catch {
      toast.error(t('centerManagement.saveError'));
    } finally {
      setS10Saving(false);
    }
  };

  const confirmBlacklist = async () => {
    if (s11Reason.trim().length < 10) {
      setS11ReasonError(t('centerManagement.section11.reasonMinLength'));
      return;
    }
    const capturedReason = s11Reason.trim();
    setS11ShowBlacklist(false);
    const headers = await getAuthHeaders();
    if (!headers) {
      toast.error(tCommon('errorGeneric'));
      return;
    }
    setS11Loading(true);
    try {
      const response = await fetch(`/api/admin/centers/${centerId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ action: 'blacklist', reason: capturedReason }),
      });
      const raw = await response.text();
      let res: { error?: string; center?: Record<string, unknown> } = {};
      try {
        res = JSON.parse(raw) as typeof res;
      } catch {
        /* non-JSON */
      }
      if (!response.ok) {
        toast.error(typeof res.error === 'string' ? res.error : t('centerManagement.saveError'));
        return;
      }
      const nowIso = new Date().toISOString();
      setData((prev) =>
        !prev
          ? prev
          : {
              ...prev,
              center: {
                ...prev.center,
                is_blacklisted: true,
                blacklisted_at: nowIso,
                blacklist_reason: capturedReason,
                status: 'suspended',
                subscription_status: 'suspended',
                billing_status: 'suspended',
              },
            },
      );
      setS2Status('suspended');
      setS2SubscriptionStatus('suspended');
      setS2BillingStatus('suspended');
      toast.success(t('centerManagement.section11.blacklistedToast'));
    } finally {
      setS11Loading(false);
    }
  };

  const confirmUnblacklist = async () => {
    setS11ShowUnblacklist(false);
    const headers = await getAuthHeaders();
    if (!headers) {
      toast.error(tCommon('errorGeneric'));
      return;
    }
    setS11Loading(true);
    try {
      const response = await fetch(`/api/admin/centers/${centerId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ action: 'unblacklist' }),
      });
      const raw = await response.text();
      let res: { error?: string; center?: Record<string, unknown> } = {};
      try {
        res = JSON.parse(raw) as typeof res;
      } catch {
        /* non-JSON */
      }
      if (!response.ok) {
        toast.error(typeof res.error === 'string' ? res.error : t('centerManagement.saveError'));
        return;
      }
      setData((prev) =>
        prev
          ? {
              ...prev,
              center: {
                ...prev.center,
                is_blacklisted: false,
                blacklisted_at: null,
                blacklist_reason: null,
              },
            }
          : prev,
      );
      toast.info(t('centerManagement.section11.unblacklistedInfo'));
    } finally {
      setS11Loading(false);
    }
  };

  const billingNum = parseFloat(s3BillingAmount);
  const allInNum = parseFloat(s3AllInPrice);
  const effectiveMonthly = !isNaN(billingNum) ? billingNum / 3 : 0;
  const annualEquivalent = !isNaN(allInNum) ? allInNum * 12 * 0.85 : 0;

  return (
    <div
      className="flex flex-col flex-1 min-h-0 min-h-screen bg-[var(--color-surface-0)]"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      <AdminHeader />
      <div className="flex flex-1">
        <AdminSidebar activeRoute={`/admin/centers/${centerId}`} />
        <main className="flex-1 flex flex-col min-w-0 p-4 md:p-6 overflow-auto lg:ms-56">
          {loading ? (
            <div className="space-y-3 max-w-xl" aria-busy="true">
              <div className="h-4 bg-gray-200 dark:bg-slate-700 rounded animate-pulse" />
              <div className="h-4 bg-gray-200 dark:bg-slate-700 rounded animate-pulse w-5/6" />
              <div className="h-4 bg-gray-200 dark:bg-slate-700 rounded animate-pulse w-4/6" />
              <p className="text-sm text-[var(--color-text-secondary)] pt-2">{t('centerManagement.loading')}</p>
            </div>
          ) : null}

          {!loading && fetchError ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 text-destructive px-4 py-3 space-y-3">
              <p>{t('centerManagement.error')}</p>
              <p className="text-sm opacity-90 break-words">{fetchError}</p>
              <button
                type="button"
                onClick={() => setRetryCount((c) => c + 1)}
                className="rounded-lg bg-[var(--color-brand-500)] text-white px-4 py-2 text-sm font-semibold hover:opacity-90"
              >
                {t('centerManagement.retry')}
              </button>
            </div>
          ) : null}

          {!loading && data ? (
            <>
              <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col gap-2">
                  <Link
                    href="/admin"
                    className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-brand-500)] w-fit"
                  >
                    {t('centerManagement.backToList')}
                  </Link>
                  <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-secondary)]">
                    {t('centerManagement.title')}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-xl font-bold text-[var(--color-text-primary)]">
                      {(data.center.name as string) ?? tCommon('notAvailable')}
                    </h1>
                    {data.center.center_code ? (
                      <span className="text-xs font-mono px-2 py-0.5 rounded-md bg-[var(--color-surface-2)] text-slate-200 border border-slate-600">
                        {String(data.center.center_code)}
                      </span>
                    ) : null}
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-md capitalize ${statusBadgeClass(
                        data.center.status as string | undefined,
                      )}`}
                    >
                      {String(data.center.status ?? tCommon('notSet'))}
                    </span>
                  </div>
                </div>
              </div>

              <section className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl p-6 mb-6">
                <h2 className="text-base font-semibold text-slate-900 dark:text-white mb-4 tracking-wide">{t('centerManagement.section1.title')}</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-slate-600 dark:text-slate-300 mb-1">{t('centerManagement.section1.name')}</label>
                    <input
                      type="text"
                      value={s1Name}
                      onChange={(e) => setS1Name(e.target.value)}
                      className="w-full bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-slate-600 dark:text-slate-300 mb-1">
                      {t('centerManagement.section1.ownerName')}
                    </label>
                    <input
                      type="text"
                      value={s1OwnerName}
                      onChange={(e) => setS1OwnerName(e.target.value)}
                      className="w-full bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-slate-600 dark:text-slate-300 mb-1">{t('centerManagement.section1.phone')}</label>
                    <input
                      type="text"
                      value={s1Phone}
                      onChange={(e) => setS1Phone(e.target.value)}
                      className="w-full bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-3 py-2 text-sm"
                      dir="ltr"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-slate-600 dark:text-slate-300 mb-1">{t('centerManagement.section1.email')}</label>
                    <input
                      type="email"
                      value={s1Email}
                      onChange={(e) => setS1Email(e.target.value)}
                      className="w-full bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-3 py-2 text-sm"
                      dir="ltr"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-slate-600 dark:text-slate-300 mb-1">{t('centerManagement.section1.city')}</label>
                    <input
                      type="text"
                      value={s1City}
                      onChange={(e) => setS1City(e.target.value)}
                      className="w-full bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-slate-600 dark:text-slate-300 mb-1">
                      {t('centerManagement.section1.district')}
                    </label>
                    <input
                      type="text"
                      value={s1District}
                      onChange={(e) => setS1District(e.target.value)}
                      className="w-full bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm text-slate-600 dark:text-slate-300 mb-1">
                      {t('centerManagement.section1.governorate')}
                    </label>
                    <select
                      value={s1Governorate}
                      onChange={(e) => setS1Governorate(e.target.value)}
                      className="w-full bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="">{tCommon('select')}</option>
                      {GOVERNORATE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm text-slate-600 dark:text-slate-300 mb-1">
                      {t('centerManagement.section1.centerCode')}
                    </label>
                    <input
                      type="text"
                      value={s1CenterCode}
                      onChange={(e) => setS1CenterCode(e.target.value)}
                      className="w-full bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-3 py-2 text-sm font-mono"
                      dir="ltr"
                    />
                    <p className="text-amber-400/90 text-sm mt-1">{t('centerManagement.section1.centerCodeWarning')}</p>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm text-slate-600 dark:text-slate-300 mb-1">
                      {t('centerManagement.section1.cardColor')}
                    </label>
                    <div className="flex items-center gap-3">
                      <input
                        type="color"
                        value={s1CardColor}
                        onChange={(e) => setS1CardColor(e.target.value)}
                        className="h-10 w-14 cursor-pointer rounded border border-gray-300 dark:border-slate-600 bg-transparent p-0"
                        aria-label={t('centerManagement.section1.cardColor')}
                      />
                      <span
                        className="h-8 w-8 min-h-[32px] min-w-[32px] rounded-full border-2 border-gray-400 dark:border-slate-500 shrink-0"
                        style={{ backgroundColor: s1CardColor }}
                        aria-hidden
                      />
                    </div>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm text-slate-600 dark:text-slate-300 mb-1">
                      {t('centerManagement.section1.signupNotes')}
                    </label>
                    <textarea
                      value={s1SignupNotes}
                      onChange={(e) => setS1SignupNotes(e.target.value)}
                      rows={5}
                      style={{
                        backgroundColor: '#334155',
                        color: 'white',
                        borderColor: '#475569',
                        colorScheme: 'dark',
                      }}
                      className="admin-textarea w-full rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-teal-500"
                      placeholder={t('centerManagement.section1.signupNotes')}
                    />
                  </div>
                </div>
                <div className="mt-6 flex justify-end">
                  <button
                    type="button"
                    disabled={s1Saving}
                    onClick={() => void saveSection1()}
                    className="rounded-lg bg-teal-600 text-white px-5 py-2.5 text-sm font-semibold hover:bg-teal-500 disabled:opacity-50"
                  >
                    {s1Saving ? t('centerManagement.saving') : t('centerManagement.saveSection')}
                  </button>
                </div>
              </section>

              <section className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl p-6 mb-6">
                <h2 className="text-base font-semibold text-slate-900 dark:text-white mb-4 tracking-wide">{t('centerManagement.section2.title')}</h2>
                {String(data.center?.status) === 'pending_cancellation' ? (
                  <div
                    className="mb-4 rounded-xl border border-amber-400/60 bg-amber-500/10 px-4 py-3 text-sm text-amber-950 dark:border-amber-600 dark:bg-amber-950/30 dark:text-amber-100"
                    dir={isRTL ? 'rtl' : 'ltr'}
                  >
                    <p className="font-semibold">⚠️ {t('centerManagement.cancellation.bannerTitle')}</p>
                    <p className="mt-2 text-slate-800 dark:text-amber-50/95">
                      {t('centerManagement.cancellation.reason')}:{' '}
                      {CANCELLATION_REASON_LABELS[String(data.center?.cancellation_reason)] ??
                        String(data.center?.cancellation_reason ?? tCommon('notSet'))}
                    </p>
                    <p className="mt-1 text-slate-700 dark:text-amber-50/90">
                      {t('centerManagement.cancellation.requested')}: {formatDate(data.center?.cancellation_requested_at)}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-3">
                      <button
                        type="button"
                        disabled={s2CancellationBusy}
                        onClick={() => {
                          if (
                            !window.confirm(t('centerManagement.cancellation.approveConfirm'))
                          ) {
                            return;
                          }
                          void patchCancellationAction('approve_cancellation');
                        }}
                        className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                      >
                        {s2CancellationBusy
                          ? t('centerManagement.saving')
                          : t('centerManagement.cancellation.approve')}
                      </button>
                      <button
                        type="button"
                        disabled={s2CancellationBusy}
                        onClick={() => void patchCancellationAction('reject_cancellation')}
                        className="rounded-lg border-2 border-teal-600 px-4 py-2 text-sm font-semibold text-teal-700 hover:bg-teal-50 dark:border-teal-500 dark:text-teal-200 dark:hover:bg-teal-950/40 disabled:opacity-50"
                      >
                        {t('centerManagement.cancellation.reject')}
                      </button>
                    </div>
                  </div>
                ) : null}
                {s2PlanWarning ? (
                  <p className="text-amber-400/90 text-sm mb-4">{t('centerManagement.section2.planWarning')}</p>
                ) : null}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-slate-600 dark:text-slate-300 mb-1">{t('centerManagement.section2.status')}</label>
                    <select
                      value={s2Status}
                      onChange={(e) => setS2Status(e.target.value)}
                      className="w-full bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="active">active</option>
                      <option value="pending_cancellation">pending_cancellation</option>
                      <option value="cancelled">cancelled</option>
                      <option value="paid_pending_activation">paid_pending_activation</option>
                      <option value="suspended">suspended</option>
                      <option value="pending">pending</option>
                      <option value="rejected">rejected</option>
                      <option value="deleted">deleted</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-slate-600 dark:text-slate-300 mb-1">
                      {t('centerManagement.section2.subscriptionStatus')}
                    </label>
                    <select
                      value={s2SubscriptionStatus}
                      onChange={(e) => setS2SubscriptionStatus(e.target.value)}
                      className="w-full bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="active">active</option>
                      <option value="suspended">suspended</option>
                      <option value="pending">pending</option>
                      <option value="trial">trial</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-slate-600 dark:text-slate-300 mb-1">
                      {t('centerManagement.section2.billingStatus')}
                    </label>
                    <select
                      value={s2BillingStatus}
                      onChange={(e) => setS2BillingStatus(e.target.value)}
                      className="w-full bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="active">active</option>
                      <option value="suspended">suspended</option>
                      <option value="pending">pending</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-slate-600 dark:text-slate-300 mb-1">{t('centerManagement.section2.plan')}</label>
                    <select
                      value={s2Plan}
                      onChange={(e) => handlePlanChange(e.target.value)}
                      className="w-full bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-3 py-2 text-sm"
                    >
                      {(data.pricingPlans ?? []).map((p) => (
                        <option key={String(p.plan_key)} value={String(p.plan_key)}>
                          {String(p.plan_key)}
                        </option>
                      ))}
                      {(data.pricingPlans ?? []).every((p) => p.plan_key !== 'top_centers') ? (
                        <option value="top_centers">top_centers</option>
                      ) : null}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-slate-600 dark:text-slate-300 mb-1">
                      {t('centerManagement.section2.pricingType')}
                    </label>
                    <select
                      value={s2PricingType}
                      onChange={(e) => setS2PricingType(e.target.value)}
                      className="w-full bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="fixed">fixed</option>
                      <option value="payg">payg</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-slate-600 dark:text-slate-300 mb-1">
                      {t('centerManagement.section2.billingType')}
                    </label>
                    <select
                      value={s2BillingType}
                      onChange={(e) => setS2BillingType(e.target.value)}
                      className="w-full bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="fixed">fixed</option>
                      <option value="subscription">subscription</option>
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm text-slate-600 dark:text-slate-300 mb-1">
                      {t('centerManagement.section2.billingPeriod')}
                    </label>
                    <select
                      value={s2SubBillingPeriod}
                      onChange={(e) => setS2SubBillingPeriod(e.target.value)}
                      className="w-full bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="monthly">monthly</option>
                      <option value="quarterly">quarterly</option>
                      <option value="biannual">biannual</option>
                      <option value="yearly">yearly</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-slate-600 dark:text-slate-300 mb-1">
                      {t('centerManagement.section2.weeklyStudentLimit')}
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={s2WeeklyStudentLimit}
                      onChange={(e) => setS2WeeklyStudentLimit(e.target.value)}
                      className="w-full bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-3 py-2 text-sm"
                      dir="ltr"
                    />
                  </div>
                  {s2PricingType === 'payg' ? (
                    <div>
                      <label className="block text-sm text-slate-600 dark:text-slate-300 mb-1">
                        {t('centerManagement.section2.paygRate')}
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={s2PaygRate}
                        onChange={(e) => setS2PaygRate(e.target.value)}
                        className="w-full bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-3 py-2 text-sm"
                        dir="ltr"
                      />
                    </div>
                  ) : null}
                </div>
                <div className="mt-6 flex justify-end">
                  <button
                    type="button"
                    disabled={s2Saving}
                    onClick={() => void saveSection2()}
                    className="rounded-lg bg-teal-600 text-white px-5 py-2.5 text-sm font-semibold hover:bg-teal-500 disabled:opacity-50"
                  >
                    {s2Saving ? t('centerManagement.saving') : t('centerManagement.saveSection')}
                  </button>
                </div>
              </section>

              <section className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl p-6 mb-6">
                <h2 className="text-base font-semibold text-slate-900 dark:text-white mb-4 tracking-wide">{t('centerManagement.section3.title')}</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4 text-sm text-slate-600 dark:text-slate-300">
                  <div>
                    {t('centerManagement.section3.effectiveMonthly')}:{' '}
                    <span className="text-slate-900 dark:text-white font-medium tabular-nums">
                      {!isNaN(billingNum)
                        ? effectiveMonthly.toLocaleString('en-US')
                        : `${(0).toLocaleString('en-US')} ${tCommon('egp')}`}
                    </span>
                  </div>
                  <div>
                    {t('centerManagement.section3.annualEquivalent')}:{' '}
                    <span className="text-slate-900 dark:text-white font-medium tabular-nums">
                      {!isNaN(allInNum)
                        ? Math.round(annualEquivalent).toLocaleString('en-US')
                        : `${(0).toLocaleString('en-US')} ${tCommon('egp')}`}
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-slate-600 dark:text-slate-300 mb-1">
                      {t('centerManagement.section3.billingAmount')}
                    </label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={s3BillingAmount}
                      onChange={(e) => setS3BillingAmount(e.target.value)}
                      className="w-full bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-3 py-2 text-sm"
                      dir="ltr"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-slate-600 dark:text-slate-300 mb-1">
                      {t('centerManagement.section3.allInPrice')}
                    </label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={s3AllInPrice}
                      onChange={(e) => setS3AllInPrice(e.target.value)}
                      className="w-full bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-3 py-2 text-sm"
                      dir="ltr"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-slate-600 dark:text-slate-300 mb-1">
                      {t('centerManagement.section3.nextPaymentDue')}
                    </label>
                    <AdminDatePicker value={s3NextPaymentDue} onChange={setS3NextPaymentDue} placeholder="YYYY-MM-DD" />
                  </div>
                  <div>
                    <label className="block text-sm text-slate-600 dark:text-slate-300 mb-1">
                      {t('centerManagement.section3.autoSuspendAt')}
                    </label>
                    <AdminDatePicker value={s3AutoSuspendAt} onChange={setS3AutoSuspendAt} />
                    <p className="text-slate-500 dark:text-slate-400 text-xs mt-1">{t('centerManagement.section3.autoSuspendWarning')}</p>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm text-slate-600 dark:text-slate-300 mb-1">
                      {t('centerManagement.section3.subscriptionStartDate')}
                    </label>
                    <AdminDatePicker value={s3SubStartDate} onChange={setS3SubStartDate} placeholder="YYYY-MM-DD" />
                  </div>
                  <div className="md:col-span-2">
                    <Toggle
                      checked={s3IsEarlyAdopter}
                      onChange={setS3IsEarlyAdopter}
                      label={t('centerManagement.section3.isEarlyAdopter')}
                    />
                  </div>
                  {s3IsEarlyAdopter ? (
                    <>
                      <div>
                        <label className="block text-sm text-slate-600 dark:text-slate-300 mb-1">
                          {t('centerManagement.section3.earlyAdopterPrice')}
                        </label>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={s3EarlyAdopterPrice}
                          onChange={(e) => setS3EarlyAdopterPrice(e.target.value)}
                          className="w-full bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-3 py-2 text-sm"
                          dir="ltr"
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-slate-600 dark:text-slate-300 mb-1">
                          {t('centerManagement.section3.earlyAdopterNumber')}
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={s3EarlyAdopterNumber}
                          onChange={(e) => setS3EarlyAdopterNumber(e.target.value)}
                          className="w-full bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-3 py-2 text-sm"
                          dir="ltr"
                        />
                      </div>
                    </>
                  ) : null}
                </div>
                <div className="mt-6 flex justify-end">
                  <button
                    type="button"
                    disabled={s3Saving}
                    onClick={() => void saveSection3()}
                    className="rounded-lg bg-teal-600 text-white px-5 py-2.5 text-sm font-semibold hover:bg-teal-500 disabled:opacity-50"
                  >
                    {s3Saving ? t('centerManagement.saving') : t('centerManagement.saveSection')}
                  </button>
                </div>
              </section>

              <section className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl p-6 mb-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                  <h2 className="text-base font-semibold text-slate-900 dark:text-white mb-4 tracking-wide">{t('centerManagement.section4.title')}</h2>
                  <button
                    type="button"
                    onClick={() => openCreateModal()}
                    className="rounded-lg bg-teal-600 text-white px-4 py-2 text-sm font-semibold hover:bg-teal-500 shrink-0"
                  >
                    {t('centerManagement.section4.createInvoice')}
                  </button>
                </div>
                {s4Invoices.length === 0 ? (
                  <p className="text-slate-500 dark:text-slate-400">{t('centerManagement.section4.noInvoices')}</p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-gray-300 dark:border-slate-600">
                    <table className="w-full text-sm text-left text-slate-800 dark:text-slate-200 min-w-[720px]">
                      <thead className="bg-[var(--color-surface-0)] text-slate-500 dark:text-slate-400">
                        <tr>
                          <th className="p-2 font-medium">{t('centerManagement.section4.invoiceNumber')}</th>
                          <th className="p-2 font-medium">{t('centerManagement.section4.type')}</th>
                          <th className="p-2 font-medium">{t('centerManagement.section4.amount')}</th>
                          <th className="p-2 font-medium">{t('centerManagement.section4.status')}</th>
                          <th className="p-2 font-medium">{t('centerManagement.section4.dueDate')}</th>
                          <th className="p-2 font-medium">{t('centerManagement.section4.created')}</th>
                          <th className="p-2 font-medium">PDF</th>
                          <th className="p-2 w-24" />
                        </tr>
                      </thead>
                      <tbody>
                        {s4Invoices.map((inv, idx) => {
                          const invId = String(inv.id ?? '');
                          const rowKey = invId || `invoice-row-${idx}`;
                          const disp = invoiceDisplayStatus(inv);
                          const rawStatus = String(inv.status ?? '');
                          const isPendingOnly = rawStatus === 'pending';
                          const canMarkPaid =
                            rawStatus === 'pending' || disp === 'overdue';
                          const busy = s4ActionLoadingId === invId;
                          return (
                            <Fragment key={rowKey}>
                              <tr className="border-t border-gray-200 dark:border-t-slate-700 align-top">
                                <td className="p-2 font-mono text-xs">{String(inv.invoice_number ?? tCommon('notSet'))}</td>
                                <td className="p-2">{String(inv.invoice_type ?? tCommon('notSet'))}</td>
                                <td className="p-2 tabular-nums">
                                  {inv.total_amount != null
                                    ? String(inv.total_amount)
                                    : `${(0).toLocaleString('en-US')} ${tCommon('egp')}`}
                                </td>
                                <td className="p-2">
                                  <span
                                    className={`inline-block text-xs px-2 py-0.5 rounded capitalize ${invoiceStatusBadgeClass(
                                      disp,
                                    )}`}
                                  >
                                    {disp}
                                  </span>
                                </td>
                                <td className="p-2 text-xs whitespace-nowrap">
                                  {inv.due_date != null
                                    ? String(inv.due_date).slice(0, 10)
                                    : tCommon('notSet')}
                                </td>
                                <td className="p-2 text-xs whitespace-nowrap">
                                  {inv.created_at != null
                                    ? String(inv.created_at).slice(0, 10)
                                    : tCommon('notSet')}
                                </td>
                                <td className="p-2">
                                  <button
                                    type="button"
                                    onClick={() => void openAdminInvoicePdf(invId)}
                                    className="rounded border border-teal-600/60 px-2 py-1 text-xs font-semibold text-teal-600 hover:bg-teal-50 dark:hover:bg-teal-950/30"
                                  >
                                    PDF
                                  </button>
                                </td>
                                <td className="p-2">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setS4ExpandedId((id) => (id === invId ? null : invId))
                                    }
                                    className="text-teal-400 hover:text-teal-300 text-xs font-medium"
                                  >
                                    {s4ExpandedId === invId ? '▲' : '▼'}
                                  </button>
                                </td>
                              </tr>
                              {s4ExpandedId === invId ? (
                                <tr className="bg-gray-50 dark:bg-[var(--color-surface-2)] border-t border-gray-200 dark:border-t-slate-700">
                                  <td colSpan={8} className="p-4 space-y-4">
                                    <div className="flex flex-wrap gap-3 items-end">
                                      <div>
                                        <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                                          {t('centerManagement.section4.updateStatus')}
                                        </label>
                                        <select
                                          value={s4StatusChanges[invId] ?? rawStatus}
                                          onChange={(e) =>
                                            setS4StatusChanges((prev) => ({
                                              ...prev,
                                              [invId]: e.target.value,
                                            }))
                                          }
                                          className="rounded-lg border border-gray-300 dark:border-slate-600 bg-gray-100 text-slate-900 dark:bg-slate-700 dark:text-white px-2 py-1.5 text-sm"
                                        >
                                          <option value="pending">pending</option>
                                          <option value="paid">paid</option>
                                          <option value="cancelled">cancelled</option>
                                          <option value="approved">approved</option>
                                          <option value="rejected">rejected</option>
                                          <option value="failed">failed</option>
                                          <option value="chargeback">chargeback</option>
                                        </select>
                                        <button
                                          type="button"
                                          disabled={busy}
                                          onClick={() => void saveInvoiceStatus(invId)}
                                          className="ms-2 rounded bg-teal-700 text-white px-2 py-1.5 text-xs disabled:opacity-50"
                                        >
                                          {t('centerManagement.saveSection')}
                                        </button>
                                      </div>
                                      {isPendingOnly ? (
                                        <div>
                                          <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                                            {t('centerManagement.section4.discountAmount')}
                                          </label>
                                          <input
                                            type="number"
                                            min={0}
                                            step="0.01"
                                            value={s4DiscountInputs[invId] ?? ''}
                                            onChange={(e) =>
                                              setS4DiscountInputs((prev) => ({
                                                ...prev,
                                                [invId]: e.target.value,
                                              }))
                                            }
                                            className="w-28 shrink-0 bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-2 py-1.5 text-sm"
                                            dir="ltr"
                                          />
                                          <button
                                            type="button"
                                            disabled={busy}
                                            onClick={() => void saveInvoiceDiscount(invId)}
                                            className="ms-2 rounded bg-gray-300 text-slate-900 dark:bg-slate-600 dark:text-white px-2 py-1.5 text-xs disabled:opacity-50"
                                          >
                                            {t('centerManagement.section4.applyDiscount')}
                                          </button>
                                        </div>
                                      ) : null}
                                      {canMarkPaid ? (
                                        <button
                                          type="button"
                                          disabled={busy}
                                          onClick={() => openMarkPaidModal(invId)}
                                          className="rounded bg-green-800 text-white px-3 py-1.5 text-xs disabled:opacity-50"
                                        >
                                          {t('centerManagement.section4.markPaid')}
                                        </button>
                                      ) : null}
                                      {isPendingOnly ? (
                                        <button
                                          type="button"
                                          disabled={busy}
                                          onClick={() => void cancelInvoice(invId)}
                                          className="rounded bg-red-900/80 text-white px-3 py-1.5 text-xs disabled:opacity-50"
                                        >
                                          {t('centerManagement.section4.cancelInvoice')}
                                        </button>
                                      ) : null}
                                    </div>
                                  </td>
                                </tr>
                              ) : null}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {s4MarkPaidId ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
                  <div className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl p-6 max-w-md w-full space-y-3">
                    <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-4 tracking-wide">{t('centerManagement.section4.markPaid')}</h3>
                    <div>
                      <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                        {t('centerManagement.section4.paymentMethod')}
                      </label>
                      <select
                        value={s4MarkPaidMethod}
                        onChange={(e) => setS4MarkPaidMethod(e.target.value)}
                        className="w-full bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-3 py-2 text-sm"
                      >
                        <option value="cash">cash</option>
                        <option value="bank_transfer">bank_transfer</option>
                        <option value="card">card</option>
                        <option value="other">other</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                        {t('centerManagement.section4.paymentReference')}
                      </label>
                      <input
                        type="text"
                        value={s4MarkPaidRef}
                        onChange={(e) => setS4MarkPaidRef(e.target.value)}
                        className="w-full bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-3 py-2 text-sm"
                        dir="ltr"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                        {t('centerManagement.section4.paidAt')}
                      </label>
                      <AdminDatePicker value={s4MarkPaidAt} onChange={setS4MarkPaidAt} />
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setS4MarkPaidId(null)}
                        className="px-4 py-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700"
                      >
                        {tCommon('cancel')}
                      </button>
                      <button
                        type="button"
                        onClick={() => void confirmMarkPaid()}
                        className="px-4 py-2 rounded-lg bg-teal-600 text-white font-semibold hover:bg-teal-500"
                      >
                        {t('centerManagement.saveSection')}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              {s4ShowCreate ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
                  <div className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl p-6 max-w-lg w-full space-y-3 max-h-[90vh] overflow-y-auto">
                    <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-4 tracking-wide">
                      {t('centerManagement.section4.createInvoice')}
                    </h3>
                    {s4CreateError ? <p className="text-red-400 text-sm">{s4CreateError}</p> : null}
                    <div>
                      <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                        {t('centerManagement.section4.invoiceType')}
                      </label>
                      <select
                        value={s4CreateType}
                        onChange={(e) => setS4CreateType(e.target.value)}
                        className="w-full bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-3 py-2 text-sm"
                      >
                        {CREATE_INVOICE_TYPES.map((ty) => (
                          <option key={ty} value={ty}>
                            {ty}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                        {t('centerManagement.section4.totalAmount')}
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={s4CreateAmount}
                        onChange={(e) => setS4CreateAmount(e.target.value)}
                        className="w-full bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-3 py-2 text-sm"
                        dir="ltr"
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                          {t('centerManagement.section4.periodStart')}
                        </label>
                        <AdminDatePicker
                          value={s4CreatePeriodStart}
                          onChange={setS4CreatePeriodStart}
                          placeholder="YYYY-MM-DD"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                          {t('centerManagement.section4.periodEnd')}
                        </label>
                        <AdminDatePicker
                          value={s4CreatePeriodEnd}
                          onChange={setS4CreatePeriodEnd}
                          placeholder="YYYY-MM-DD"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                        {t('centerManagement.section4.dueDate')}
                      </label>
                      <AdminDatePicker value={s4CreateDueDate} onChange={setS4CreateDueDate} placeholder="YYYY-MM-DD" />
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setS4ShowCreate(false)}
                        className="px-4 py-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700"
                      >
                        {tCommon('cancel')}
                      </button>
                      <button
                        type="button"
                        disabled={s4CreateSaving}
                        onClick={() => void submitCreateInvoice()}
                        className="px-4 py-2 rounded-lg bg-teal-600 text-white font-semibold hover:bg-teal-500 disabled:opacity-50"
                      >
                        {s4CreateSaving ? t('centerManagement.saving') : t('centerManagement.saveSection')}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              <section className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl p-6 mb-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                  <h2 className="text-base font-semibold text-slate-900 dark:text-white mb-4 tracking-wide">{t('centerManagement.section5.title')}</h2>
                  <button
                    type="button"
                    onClick={() => openRecordModal()}
                    className="rounded-lg bg-teal-600 text-white px-4 py-2 text-sm font-semibold hover:bg-teal-500 shrink-0"
                  >
                    {t('centerManagement.section5.recordPayment')}
                  </button>
                </div>
                {s5History.length === 0 ? (
                  <p className="text-slate-500 dark:text-slate-400">{t('centerManagement.section5.noPayments')}</p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-gray-300 dark:border-slate-600">
                    <table className="w-full text-sm text-slate-800 dark:text-slate-200 min-w-[640px]">
                      <thead className="bg-[var(--color-surface-0)] text-slate-500 dark:text-slate-400">
                        <tr>
                          <th className="text-start p-2 font-medium">{t('centerManagement.section5.date')}</th>
                          <th className="text-start p-2 font-medium">{t('centerManagement.section5.amount')}</th>
                          <th className="text-start p-2 font-medium">{t('centerManagement.section5.method')}</th>
                          <th className="text-start p-2 font-medium">{t('centerManagement.section5.recordedBy')}</th>
                          <th className="text-start p-2 font-medium">{t('centerManagement.section4.notes')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s5History.map((row, idx) => {
                          const rk = String(row.id ?? `rh-${idx}`);
                          const ap = row.amount_paid;
                          const amt =
                            ap != null && !isNaN(Number(ap))
                              ? `${Number(ap).toLocaleString('en-US')} ${tCommon('egp')}`
                              : `${(0).toLocaleString('en-US')} ${tCommon('egp')}`;
                          return (
                            <tr key={rk} className="border-t border-gray-200 dark:border-t-slate-700">
                              <td className="p-2 whitespace-nowrap">
                                {row.renewal_date != null
                                  ? String(row.renewal_date).slice(0, 10)
                                  : tCommon('notSet')}
                              </td>
                              <td className="p-2 tabular-nums">{amt}</td>
                              <td className="p-2">{String(row.payment_method ?? tCommon('notSet'))}</td>
                              <td className="p-2">{getRecordedByName(row.recorded_by)}</td>
                              <td className="p-2 max-w-xs truncate" title={String(row.notes ?? '')}>
                                {row.notes != null ? String(row.notes) : tCommon('notSet')}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {s5ShowModal ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
                  <div className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl p-6 max-w-md w-full space-y-3">
                    <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-4 tracking-wide">
                      {t('centerManagement.section5.recordPayment')}
                    </h3>
                    {s5AmountError ? <p className="text-red-400 text-sm">{s5AmountError}</p> : null}
                    <div>
                      <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                        {t('centerManagement.section5.paymentDate')}
                      </label>
                      <AdminDatePicker value={s5Date} onChange={setS5Date} />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                        {t('centerManagement.section5.amountPaid')}
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={s5Amount}
                        onChange={(e) => setS5Amount(e.target.value)}
                        className="w-full bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-3 py-2 text-sm"
                        dir="ltr"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                        {t('centerManagement.section5.paymentMethod')}
                      </label>
                      <select
                        value={s5Method}
                        onChange={(e) => setS5Method(e.target.value)}
                        className="w-full bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-3 py-2 text-sm"
                      >
                        <option value="cash">cash</option>
                        <option value="bank_transfer">bank_transfer</option>
                        <option value="card">card</option>
                        <option value="other">other</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                        {t('centerManagement.section4.notes')}
                      </label>
                      <textarea
                        rows={3}
                        value={s5Notes}
                        onChange={(e) => setS5Notes(e.target.value)}
                        className="w-full bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-3 py-2 text-sm resize-none"
                      />
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setS5ShowModal(false)}
                        className="px-4 py-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700"
                      >
                        {tCommon('cancel')}
                      </button>
                      <button
                        type="button"
                        disabled={s5Saving}
                        onClick={() => void submitRecordPayment()}
                        className="px-4 py-2 rounded-lg bg-teal-600 text-white font-semibold hover:bg-teal-500 disabled:opacity-50"
                      >
                        {s5Saving ? t('centerManagement.saving') : t('centerManagement.saveSection')}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              <section className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl p-6 mb-6">
                <h2 className="text-base font-semibold text-slate-900 dark:text-white mb-4 tracking-wide">{t('centerManagement.section6.title')}</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4 text-sm text-slate-500 dark:text-slate-400">
                  <div>
                    <span className="text-slate-500 dark:text-slate-500">{t('centerManagement.section6.packApprovedAt')}: </span>
                    <span className="text-slate-800 dark:text-slate-200">
                      {data.center.pack_approved_at != null
                        ? String(data.center.pack_approved_at).slice(0, 19)
                        : tCommon('notSet')}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-slate-500">{t('centerManagement.section6.packRequestedAt')}: </span>
                    <span className="text-slate-800 dark:text-slate-200">
                      {data.center.pack_requested_at != null
                        ? String(data.center.pack_requested_at).slice(0, 19)
                        : tCommon('notSet')}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-slate-500">{t('centerManagement.section6.packDisabledAt')}: </span>
                    <span className="text-slate-800 dark:text-slate-200">
                      {data.center.pack_disabled_at != null
                        ? String(data.center.pack_disabled_at).slice(0, 19)
                        : tCommon('notSet')}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-slate-500">{t('centerManagement.section6.activeParents')}: </span>
                    <span className="text-slate-800 dark:text-slate-200">
                      {data.center.parent_pack_active_parents != null
                        ? String(data.center.parent_pack_active_parents)
                        : tCommon('notSet')}
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <Toggle
                      checked={s6PackEnabled}
                      onChange={setS6PackEnabled}
                      label={t('centerManagement.section6.packEnabled')}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm text-slate-600 dark:text-slate-300 mb-1">
                      {t('centerManagement.section6.packRequestStatus')}
                    </label>
                    <select
                      value={s6PackRequestStatus}
                      onChange={(e) => setS6PackRequestStatus(e.target.value)}
                      className="w-full bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="none">none</option>
                      <option value="requested">requested</option>
                      <option value="approved">approved</option>
                      <option value="rejected">rejected</option>
                      <option value="suspended">suspended</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-slate-600 dark:text-slate-300 mb-1">
                      {t('centerManagement.section6.packPrice')}
                    </label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={s6PackPrice}
                      onChange={(e) => setS6PackPrice(e.target.value)}
                      className="w-full bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-3 py-2 text-sm"
                      dir="ltr"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-slate-600 dark:text-slate-300 mb-1">
                      {t('centerManagement.section6.packCustomMin')}
                    </label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={s6PackCustomMin}
                      onChange={(e) => setS6PackCustomMin(e.target.value)}
                      className="w-full bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-3 py-2 text-sm"
                      dir="ltr"
                    />
                    {s2Plan === 'top_centers' ? (
                      <p className="text-xs text-amber-400/90 mt-1">
                        {t('centerManagement.section6.packCustomMinRequired')}
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <label className="block text-sm text-slate-600 dark:text-slate-300 mb-1">
                      {t('centerManagement.section6.packPendingBalance')}
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={s6PackPendingBalance}
                      onChange={(e) => setS6PackPendingBalance(e.target.value)}
                      className="w-full bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-3 py-2 text-sm"
                      dir="ltr"
                    />
                    <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">{t('centerManagement.section6.packBalanceNote')}</p>
                  </div>
                  <div>
                    <label className="block text-sm text-slate-600 dark:text-slate-300 mb-1">
                      {t('centerManagement.section6.packMonths')}
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={s6PackMonthsNoInvoice}
                      onChange={(e) => setS6PackMonthsNoInvoice(e.target.value)}
                      className="w-full bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-3 py-2 text-sm"
                      dir="ltr"
                    />
                  </div>
                  {s6PackRequestStatus === 'rejected' ? (
                    <div className="md:col-span-2">
                      <label className="block text-sm text-slate-600 dark:text-slate-300 mb-1">
                        {t('centerManagement.section6.packRejectionReason')}
                      </label>
                      <textarea
                        rows={3}
                        value={s6PackRejectionReason}
                        onChange={(e) => setS6PackRejectionReason(e.target.value)}
                        className="w-full bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-3 py-2 text-sm resize-none"
                      />
                    </div>
                  ) : null}
                </div>
                <div className="mt-6 flex justify-end">
                  <button
                    type="button"
                    disabled={s6Saving}
                    onClick={() => void saveSection6()}
                    className="rounded-lg bg-teal-600 text-white px-5 py-2.5 text-sm font-semibold hover:bg-teal-500 disabled:opacity-50"
                  >
                    {s6Saving ? t('centerManagement.saving') : t('centerManagement.saveSection')}
                  </button>
                </div>
              </section>

              <section className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl p-6 mb-6">
                <h2 className="text-base font-semibold text-slate-900 dark:text-white mb-4 tracking-wide">{t('centerManagement.section7.title')}</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-sm text-slate-600 dark:text-slate-300 mb-1">
                      {t('centerManagement.section7.balance')}
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={s7Balance}
                      onChange={(e) => setS7Balance(e.target.value)}
                      className="w-full bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-3 py-2 text-sm"
                      dir="ltr"
                    />
                    <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">{t('centerManagement.section7.balanceNote')}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      {t('centerManagement.section7.balanceUpdated')}:{' '}
                      {data.center.announcement_balance_updated_at != null
                        ? String(data.center.announcement_balance_updated_at).slice(0, 19)
                        : tCommon('notSet')}
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm text-slate-600 dark:text-slate-300 mb-1">
                      {t('centerManagement.section7.pricePerBlast')}
                    </label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={s7PricePerBlast}
                      onChange={(e) => setS7PricePerBlast(e.target.value)}
                      className="w-full bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-3 py-2 text-sm"
                      dir="ltr"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-slate-600 dark:text-slate-300 mb-1">{t('centerManagement.section7.cap')}</label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={s7Cap}
                      onChange={(e) => setS7Cap(e.target.value)}
                      className="w-full bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-3 py-2 text-sm"
                      dir="ltr"
                    />
                  </div>
                </div>
                <div className="mt-6 flex justify-end">
                  <button
                    type="button"
                    disabled={s7Saving}
                    onClick={() => void saveSection7()}
                    className="rounded-lg bg-teal-600 text-white px-5 py-2.5 text-sm font-semibold hover:bg-teal-500 disabled:opacity-50"
                  >
                    {s7Saving ? t('centerManagement.saving') : t('centerManagement.saveSection')}
                  </button>
                </div>
              </section>

              <section className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl p-6 mb-6">
                <h2 className="text-base font-semibold text-slate-900 dark:text-white mb-4 tracking-wide">{t('centerManagement.section8.title')}</h2>
                {s8ScheduleError ? <p className="text-red-400 text-sm mb-3">{s8ScheduleError}</p> : null}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2 flex flex-col gap-3">
                    <Toggle
                      checked={s8IndividualAlerts}
                      onChange={setS8IndividualAlerts}
                      label={t('centerManagement.section8.individualAlerts')}
                    />
                    <Toggle
                      checked={s8DailySummary}
                      onChange={setS8DailySummary}
                      label={t('centerManagement.section8.dailySummary')}
                    />
                    <Toggle
                      checked={s8SummerMode}
                      onChange={setS8SummerMode}
                      label={t('centerManagement.section8.summerMode')}
                    />
                    <Toggle
                      checked={s8WhatsappOptedIn}
                      onChange={setS8WhatsappOptedIn}
                      label={t('centerManagement.section8.whatsappOptedIn')}
                    />
                  </div>
                  <p className="md:col-span-2 text-xs text-amber-400/90">{t('centerManagement.section8.summerModeWarning')}</p>
                  <div>
                    <label className="block text-sm text-slate-600 dark:text-slate-300 mb-1">
                      {t('centerManagement.section8.scheduleStart')}
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={23}
                      value={s8ScheduleStart}
                      onChange={(e) => setS8ScheduleStart(e.target.value)}
                      className="w-full bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-3 py-2 text-sm"
                      dir="ltr"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-slate-600 dark:text-slate-300 mb-1">
                      {t('centerManagement.section8.scheduleEnd')}
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={23}
                      value={s8ScheduleEnd}
                      onChange={(e) => setS8ScheduleEnd(e.target.value)}
                      className="w-full bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-3 py-2 text-sm"
                      dir="ltr"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm text-slate-600 dark:text-slate-300 mb-1">
                      {t('centerManagement.section8.instapayNumber')}
                    </label>
                    <input
                      type="tel"
                      value={s8InstapayNumber}
                      onChange={(e) => setS8InstapayNumber(e.target.value)}
                      className="bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-3 py-2 text-sm w-full"
                      placeholder="01XXXXXXXXX"
                      dir="ltr"
                    />
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t('centerManagement.section8.instapayNote')}</p>
                  </div>
                </div>
                <div className="mt-6 flex justify-end">
                  <button
                    type="button"
                    disabled={s8Saving}
                    onClick={() => void saveSection8()}
                    className="rounded-lg bg-teal-600 text-white px-5 py-2.5 text-sm font-semibold hover:bg-teal-500 disabled:opacity-50"
                  >
                    {s8Saving ? t('centerManagement.saving') : t('centerManagement.saveSection')}
                  </button>
                </div>
              </section>

              <section className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl p-6 mb-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                  <h2 className="text-base font-semibold text-slate-900 dark:text-white mb-4 tracking-wide">{t('centerManagement.section9.title')}</h2>
                  <button
                    type="button"
                    onClick={() => openOverrideModal()}
                    className="rounded-lg border border-amber-600/50 text-amber-300 px-4 py-2 text-sm font-semibold hover:bg-amber-900/20 shrink-0"
                  >
                    {t('centerManagement.section9.overridePlan')}
                  </button>
                </div>
                <p className="text-xs text-amber-400/80 mb-4">{t('centerManagement.section9.overrideWarning')}</p>
                {s9Requests.length === 0 ? (
                  <p className="text-slate-500 dark:text-slate-400">{t('centerManagement.section9.noRequests')}</p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-gray-300 dark:border-slate-600">
                    <table className="w-full text-sm text-slate-800 dark:text-slate-200 min-w-[800px]">
                      <thead className="bg-[var(--color-surface-0)] text-slate-500 dark:text-slate-400">
                        <tr>
                          <th className="text-start p-2 font-medium">{t('centerManagement.section9.currentPlan')}</th>
                          <th className="text-start p-2 font-medium">{t('centerManagement.section9.requestedPlan')}</th>
                          <th className="text-start p-2 font-medium">{t('centerManagement.section4.status')}</th>
                          <th className="text-start p-2 font-medium">{t('requestedAt')}</th>
                          <th className="text-start p-2 font-medium">{t('centerManagement.section4.notes')}</th>
                          <th className="text-start p-2 font-medium">{tCommon('actions')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s9Requests.map((req, i) => {
                          const rid = String(req.id ?? `pr-${i}`);
                          const st = String(req.status ?? '');
                          const canAct = st === 'pending' || st === 'pending_payment';
                          return (
                            <tr key={rid} className="border-t border-gray-200 dark:border-t-slate-700">
                              <td className="p-2">{String(data.center.plan ?? tCommon('notSet'))}</td>
                              <td className="p-2">{String(req.requested_plan ?? tCommon('notSet'))}</td>
                              <td className="p-2 capitalize">{st || tCommon('notSet')}</td>
                              <td className="p-2 whitespace-nowrap text-xs">
                                {formatDate(req.requested_at)}
                              </td>
                              <td className="p-2 max-w-[200px] truncate" title={String(req.notes ?? '')}>
                                {req.notes != null ? String(req.notes) : tCommon('notSet')}
                              </td>
                              <td className="p-2 flex flex-wrap gap-1">
                                {canAct ? (
                                  <>
                                    <button
                                      type="button"
                                      disabled={s9ActionLoading}
                                      onClick={() => openApproveModal(req)}
                                      className="rounded bg-teal-700 text-white px-2 py-1 text-xs disabled:opacity-50"
                                    >
                                      {t('centerManagement.section9.approve')}
                                    </button>
                                    <button
                                      type="button"
                                      disabled={s9ActionLoading}
                                      onClick={() => {
                                        setS9RejectId(String(req.id ?? ''));
                                        setS9RejectNotes('');
                                        setS9RejectNotesError('');
                                      }}
                                      className="rounded bg-red-900/80 text-white px-2 py-1 text-xs disabled:opacity-50"
                                    >
                                      {t('centerManagement.section9.reject')}
                                    </button>
                                  </>
                                ) : (
                                  <span className="text-slate-600 text-xs" aria-hidden>
                                    -
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {s9ApproveId ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
                  <div className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl p-6 max-w-md w-full space-y-3">
                    <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-4 tracking-wide">{t('centerManagement.section9.approve')}</h3>
                    <div>
                      <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">{t('centerManagement.section2.plan')}</label>
                      <select
                        value={s9ApprovePlan}
                        onChange={(e) => handleApprovePlanChange(e.target.value)}
                        className="w-full bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-3 py-2 text-sm"
                      >
                        {(data.pricingPlans ?? []).map((p) => (
                          <option key={String(p.plan_key)} value={String(p.plan_key)}>
                            {String(p.plan_key)}
                          </option>
                        ))}
                        {(data.pricingPlans ?? []).every((p) => p.plan_key !== 'top_centers') ? (
                          <option value="top_centers">top_centers</option>
                        ) : null}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                        {t('centerManagement.section9.newBillingAmount')}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={s9ApproveBilling}
                        onChange={(e) => setS9ApproveBilling(e.target.value)}
                        className="w-full bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-3 py-2 text-sm"
                        dir="ltr"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                        {t('centerManagement.section9.newAllInPrice')}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={s9ApproveAllIn}
                        onChange={(e) => setS9ApproveAllIn(e.target.value)}
                        className="w-full bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-3 py-2 text-sm"
                        dir="ltr"
                      />
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setS9ApproveId(null)}
                        className="px-4 py-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700"
                      >
                        {tCommon('cancel')}
                      </button>
                      <button
                        type="button"
                        disabled={s9ActionLoading}
                        onClick={() => void confirmApprovePlanRequest()}
                        className="px-4 py-2 rounded-lg bg-teal-600 text-white font-semibold disabled:opacity-50"
                      >
                        {t('centerManagement.section9.approve')}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              {s9RejectId ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
                  <div className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl p-6 max-w-md w-full space-y-3">
                    <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-4 tracking-wide">{t('centerManagement.section9.reject')}</h3>
                    {s9RejectNotesError ? <p className="text-red-400 text-sm">{s9RejectNotesError}</p> : null}
                    <div>
                      <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                        {t('centerManagement.section9.rejectNotes')}
                      </label>
                      <textarea
                        rows={4}
                        value={s9RejectNotes}
                        onChange={(e) => setS9RejectNotes(e.target.value)}
                        className="w-full bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-3 py-2 text-sm resize-none"
                      />
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setS9RejectId(null)}
                        className="px-4 py-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700"
                      >
                        {tCommon('cancel')}
                      </button>
                      <button
                        type="button"
                        disabled={s9ActionLoading}
                        onClick={() => void confirmRejectPlanRequest()}
                        className="px-4 py-2 rounded-lg bg-red-800 text-white font-semibold disabled:opacity-50"
                      >
                        {t('centerManagement.section9.reject')}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              {s9ShowOverride ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
                  <div className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl p-6 max-w-md w-full space-y-3">
                    <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-4 tracking-wide">{t('centerManagement.section9.overridePlan')}</h3>
                    <div>
                      <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">{t('centerManagement.section2.plan')}</label>
                      <select
                        value={s9OverridePlan}
                        onChange={(e) => handleOverridePlanChange(e.target.value)}
                        className="w-full bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-3 py-2 text-sm"
                      >
                        {(data.pricingPlans ?? []).map((p) => (
                          <option key={String(p.plan_key)} value={String(p.plan_key)}>
                            {String(p.plan_key)}
                          </option>
                        ))}
                        {(data.pricingPlans ?? []).every((p) => p.plan_key !== 'top_centers') ? (
                          <option value="top_centers">top_centers</option>
                        ) : null}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                        {t('centerManagement.section9.newBillingAmount')}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={s9OverrideBilling}
                        onChange={(e) => setS9OverrideBilling(e.target.value)}
                        className="w-full bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-3 py-2 text-sm"
                        dir="ltr"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                        {t('centerManagement.section9.newAllInPrice')}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={s9OverrideAllIn}
                        onChange={(e) => setS9OverrideAllIn(e.target.value)}
                        className="w-full bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-3 py-2 text-sm"
                        dir="ltr"
                      />
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setS9ShowOverride(false)}
                        className="px-4 py-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700"
                      >
                        {tCommon('cancel')}
                      </button>
                      <button
                        type="button"
                        disabled={s9ActionLoading}
                        onClick={() => void confirmOverridePlan()}
                        className="px-4 py-2 rounded-lg bg-amber-700 text-white font-semibold disabled:opacity-50"
                      >
                        {t('centerManagement.saveSection')}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              <section className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl p-6 mb-6">
                <h2 className="text-base font-semibold text-slate-900 dark:text-white mb-4 tracking-wide">{t('centerManagement.section10.title')}</h2>
                <div className="flex flex-wrap items-center gap-3 mb-4">
                  <span className="text-sm text-slate-500 dark:text-slate-400">{t('centerManagement.section10.referralCode')}:</span>
                  <code className="text-teal-300 font-mono text-sm">
                    {String(data.center.referral_code ?? tCommon('notSet'))}
                  </code>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard
                        .writeText((data?.center?.referral_code as string) ?? '')
                        .then(() => {
                          setS10CopiedCode(true);
                          setTimeout(() => setS10CopiedCode(false), 2000);
                        })
                        .catch(() => {});
                    }}
                    className="rounded-lg bg-gray-200 text-slate-900 dark:bg-slate-700 dark:text-white px-3 py-1.5 text-xs font-semibold hover:bg-gray-300 dark:hover:bg-slate-600"
                  >
                    {s10CopiedCode ? t('centerManagement.section10.copied') : t('centerManagement.section10.copy')}
                  </button>
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-2">
                  {t('centerManagement.section10.referredBy')}:{' '}
                  <span className="text-slate-800 dark:text-slate-200">{shortUuid(data.center.referred_by)}</span>
                </p>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                  {(data.referralsMade ?? []).length} {t('centerManagement.section10.centersReferred')}
                </p>
                {(data.referralsMade ?? []).length === 0 ? (
                  <p className="text-slate-500 dark:text-slate-500 text-sm mb-6">{t('centerManagement.section10.noReferrals')}</p>
                ) : (
                  <ul className="list-disc list-inside text-slate-600 dark:text-slate-300 text-sm mb-6 space-y-1">
                    {(data.referralsMade ?? []).map((ref, j) => (
                      <li key={String(ref.id ?? j)}>
                        {String((ref as { name?: string }).name ?? tCommon('notAvailable'))}{' '}
                        <span className="text-slate-500">·</span>{' '}
                        {String((ref as { plan?: string }).plan ?? '')}
                      </li>
                    ))}
                  </ul>
                )}
                <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-4 tracking-wide">{t('centerManagement.section10.commissions')}</h3>
                {s10Commissions.length === 0 ? (
                  <p className="text-slate-500 dark:text-slate-500 text-sm mb-4">{t('centerManagement.section10.noCommissions')}</p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-gray-300 dark:border-slate-600 mb-4">
                    <table className="w-full text-sm text-slate-800 dark:text-slate-200 min-w-[360px]">
                      <thead className="bg-[var(--color-surface-0)] text-slate-500 dark:text-slate-400">
                        <tr>
                          <th className="text-start p-2 font-medium">{t('centerManagement.section4.amount')}</th>
                          <th className="text-start p-2 font-medium">{t('centerManagement.section4.status')}</th>
                          <th className="text-start p-2 font-medium">{tCommon('actions')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s10Commissions.map((com, k) => {
                          const cid = String(com.id ?? k);
                          const cst = String(com.status ?? '');
                          const amt =
                            com.amount != null
                              ? String(com.amount)
                              : com.commission_amount != null
                                ? String(com.commission_amount)
                                : `${(0).toLocaleString('en-US')} ${tCommon('egp')}`;
                          return (
                            <tr key={cid} className="border-t border-gray-200 dark:border-t-slate-700">
                              <td className="p-2 tabular-nums">{amt}</td>
                              <td className="p-2 capitalize">{cst}</td>
                              <td className="p-2">
                                {cst !== 'paid' ? (
                                  <button
                                    type="button"
                                    disabled={s10CommLoadingId === cid}
                                    onClick={() => void markCommissionPaidHandler(com)}
                                    className="rounded bg-teal-700 text-white px-2 py-1 text-xs disabled:opacity-50"
                                  >
                                    {t('centerManagement.section10.markPaid')}
                                  </button>
                                ) : (
                                  <span className="text-slate-600 text-xs" aria-hidden>
                                    -
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-sm text-slate-600 dark:text-slate-300 mb-1">
                      {t('centerManagement.section10.rewardStatus')}
                    </label>
                    <select
                      value={s10RewardStatus}
                      onChange={(e) => setS10RewardStatus(e.target.value)}
                      className="w-full bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="pending">pending</option>
                      <option value="paid">paid</option>
                      <option value="cancelled">cancelled</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-slate-600 dark:text-slate-300 mb-1">
                      {t('centerManagement.section10.rewardAmount')}
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={s10RewardAmount}
                      onChange={(e) => setS10RewardAmount(e.target.value)}
                      className="w-full bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-3 py-2 text-sm"
                      dir="ltr"
                    />
                  </div>
                </div>
                <button
                  type="button"
                  disabled={s10Saving}
                  onClick={() => void saveReferralRewardsSection10()}
                  className="rounded-lg bg-teal-600 text-white px-5 py-2 text-sm font-semibold hover:bg-teal-500 disabled:opacity-50 mb-6"
                >
                  {s10Saving ? t('centerManagement.saving') : t('centerManagement.saveSection')}
                </button>
                <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-4 tracking-wide">{t('centerManagement.section10.payoutRequests')}</h3>
                {(data.payoutRequests ?? []).length === 0 ? (
                  <p className="text-slate-500 dark:text-slate-500 text-sm">{t('centerManagement.section10.noPayouts')}</p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-gray-300 dark:border-slate-600">
                    <table className="w-full text-sm text-slate-800 dark:text-slate-200">
                      <thead className="bg-[var(--color-surface-0)] text-slate-500 dark:text-slate-400">
                        <tr>
                          <th className="text-start p-2 font-medium">ID</th>
                          <th className="text-start p-2 font-medium">{t('centerManagement.section4.status')}</th>
                          <th className="text-start p-2 font-medium">{t('centerManagement.section4.amount')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(data.payoutRequests ?? []).map((p, m) => {
                          const pr = p as { id?: string; status?: string; amount?: unknown };
                          const amtNum = Number(pr.amount);
                          const payoutAmt =
                            pr.amount != null && !Number.isNaN(amtNum)
                              ? `${amtNum.toLocaleString('en-US')} ${tCommon('egp')}`
                              : `${(0).toLocaleString('en-US')} ${tCommon('egp')}`;
                          return (
                            <tr key={String(pr.id ?? m)} className="border-t border-gray-200 dark:border-t-slate-700">
                              <td className="p-2 font-mono text-xs">{shortUuid(pr.id)}</td>
                              <td className="p-2">{String(pr.status ?? tCommon('notSet'))}</td>
                              <td className="p-2 tabular-nums">{payoutAmt}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl p-6 mb-6">
                <h2 className="text-base font-semibold text-slate-900 dark:text-white mb-4 tracking-wide">{t('centerManagement.section11.title')}</h2>
                {data.center.is_blacklisted ? (
                  <div className="rounded-lg border border-red-800 bg-red-950/40 p-4 mb-4">
                    <p className="text-red-200 font-medium mb-2">{t('centerManagement.section11.isBlacklisted')}</p>
                    <p className="text-red-200/80 text-sm mb-3">{t('centerManagement.section11.unblacklistWarning')}</p>
                    <button
                      type="button"
                      disabled={s11Loading}
                      onClick={() => setS11ShowUnblacklist(true)}
                      className="rounded-lg bg-gray-200 text-slate-900 dark:bg-slate-700 dark:text-white px-4 py-2 text-sm font-semibold hover:bg-gray-300 dark:hover:bg-slate-600 disabled:opacity-50"
                    >
                      {t('centerManagement.section11.unblacklistBtn')}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setS11Reason('');
                      setS11ReasonError('');
                      setS11ShowBlacklist(true);
                    }}
                    className="rounded-lg bg-red-800 text-white px-4 py-2 text-sm font-semibold hover:bg-red-700"
                  >
                    {t('centerManagement.section11.blacklistBtn')}
                  </button>
                )}
                <p className="text-xs text-red-400/80 mt-3">{t('centerManagement.section11.blacklistWarning')}</p>
              </section>

              {s11ShowBlacklist ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
                  <div className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl p-6 max-w-md w-full space-y-3">
                    <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-4 tracking-wide">{t('centerManagement.section11.confirmBlacklist')}</h3>
                    {s11ReasonError ? <p className="text-red-400 text-sm">{s11ReasonError}</p> : null}
                    <div>
                      <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                        {t('centerManagement.section11.reasonLabel')}
                      </label>
                      <textarea
                        rows={4}
                        value={s11Reason}
                        onChange={(e) => setS11Reason(e.target.value)}
                        className="w-full bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-3 py-2 text-sm resize-none"
                      />
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setS11ShowBlacklist(false)}
                        className="px-4 py-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700"
                      >
                        {tCommon('cancel')}
                      </button>
                      <button
                        type="button"
                        disabled={s11Loading}
                        onClick={() => void confirmBlacklist()}
                        className="px-4 py-2 rounded-lg bg-red-700 text-white font-semibold disabled:opacity-50"
                      >
                        {t('centerManagement.section11.confirmBlacklist')}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              {s11ShowUnblacklist ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
                  <div className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl p-6 max-w-md w-full space-y-3">
                    <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-4 tracking-wide">{t('centerManagement.section11.confirmRemove')}</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400">{t('centerManagement.section11.unblacklistWarning')}</p>
                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setS11ShowUnblacklist(false)}
                        className="px-4 py-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700"
                      >
                        {tCommon('cancel')}
                      </button>
                      <button
                        type="button"
                        disabled={s11Loading}
                        onClick={() => void confirmUnblacklist()}
                        className="px-4 py-2 rounded-lg bg-teal-700 text-white font-semibold disabled:opacity-50"
                      >
                        {t('centerManagement.section11.confirmRemove')}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              <section className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl p-6 mb-6">
                <h2 className="text-base font-semibold text-slate-900 dark:text-white mb-4 tracking-wide">{t('centerNotes.title')}</h2>
                {opsNotesLoading ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">{t('centerManagement.loading')}</p>
                ) : opsNotes.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">{t('centerNotes.no_notes')}</p>
                ) : (
                  <ul className="space-y-3 mb-4">
                    {opsNotes.map((note) => {
                      const nid = String(note.id ?? '');
                      const pinned = Boolean(note.is_pinned);
                      const author = note.author as { name?: string } | null | undefined;
                      const authorName = author?.name ?? tCommon('notAvailable');
                      return (
                        <li
                          key={nid}
                          className="rounded-lg border border-gray-200 dark:border-slate-600 p-3 bg-gray-50 dark:bg-[var(--color-surface-2)]"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2 mb-1">
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                              <span className="font-medium text-slate-700 dark:text-slate-200">{authorName}</span>
                              {' · '}
                              {note.created_at
                                ? new Date(String(note.created_at)).toLocaleString('en-US', {
                                    dateStyle: 'medium',
                                    timeStyle: 'short',
                                  })
                                : tCommon('notSet')}
                              {pinned ? (
                                <span className="ms-2 text-amber-600 dark:text-amber-400 font-medium">
                                  {t('centerNotes.pinned_badge')}
                                </span>
                              ) : null}
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                disabled={opsPinBusyId === nid}
                                onClick={() => {
                                  void (async () => {
                                    const headers = await getAuthHeaders();
                                    if (!headers) return;
                                    setOpsPinBusyId(nid);
                                    try {
                                      const res = await fetch(`/api/admin/centers/${centerId}/notes`, {
                                        method: 'PATCH',
                                        headers,
                                        body: JSON.stringify({ note_id: nid, is_pinned: !pinned }),
                                      });
                                      const j = await res.json().catch(() => ({}));
                                      if (!res.ok) {
                                        showApiError(j as Record<string, unknown>);
                                        return;
                                      }
                                      await refreshOpsPanels();
                                    } finally {
                                      setOpsPinBusyId(null);
                                    }
                                  })();
                                }}
                                className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-700 disabled:opacity-50"
                                aria-label={pinned ? t('centerNotes.unpin') : t('centerNotes.pin')}
                                title={pinned ? t('centerNotes.unpin') : t('centerNotes.pin')}
                              >
                                <Pin className={`w-4 h-4 ${pinned ? 'text-amber-500 fill-amber-500/30' : ''}`} />
                              </button>
                              <button
                                type="button"
                                disabled={opsDeleteBusyId === nid}
                                onClick={() => {
                                  void (async () => {
                                    const headers = await getAuthHeaders();
                                    if (!headers) return;
                                    setOpsDeleteBusyId(nid);
                                    try {
                                      const res = await fetch(`/api/admin/centers/${centerId}/notes`, {
                                        method: 'DELETE',
                                        headers,
                                        body: JSON.stringify({ note_id: nid }),
                                      });
                                      const j = await res.json().catch(() => ({}));
                                      if (!res.ok) {
                                        showApiError(j as Record<string, unknown>);
                                        return;
                                      }
                                      toast.success(t('centerNotes.deletedToast'));
                                      await refreshOpsPanels();
                                    } finally {
                                      setOpsDeleteBusyId(null);
                                    }
                                  })();
                                }}
                                className="p-2 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                                aria-label={t('centerNotes.delete')}
                                title={t('centerNotes.delete')}
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                          <p className="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{String(note.body ?? '')}</p>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <div className="space-y-2">
                  <textarea
                    rows={3}
                    value={opsNewNote}
                    onChange={(e) => setOpsNewNote(e.target.value)}
                    placeholder={t('centerNotes.placeholder')}
                    className="w-full bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-3 py-2 text-sm resize-none"
                  />
                  <button
                    type="button"
                    disabled={opsAddingNote || !opsNewNote.trim()}
                    onClick={() => {
                      void (async () => {
                        const headers = await getAuthHeaders();
                        if (!headers) return;
                        setOpsAddingNote(true);
                        try {
                          const res = await fetch(`/api/admin/centers/${centerId}/notes`, {
                            method: 'POST',
                            headers,
                            body: JSON.stringify({ body: opsNewNote.trim(), is_pinned: false }),
                          });
                          const j = await res.json().catch(() => ({}));
                          if (!res.ok) {
                            showApiError(j as Record<string, unknown>);
                            return;
                          }
                          setOpsNewNote('');
                          await refreshOpsPanels();
                        } finally {
                          setOpsAddingNote(false);
                        }
                      })();
                    }}
                    className="rounded-lg bg-teal-700 text-white px-4 py-2 text-sm font-semibold hover:bg-teal-600 disabled:opacity-50"
                  >
                    {opsAddingNote ? t('centerNotes.adding') : t('centerNotes.add')}
                  </button>
                </div>
              </section>

              <section className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl p-6 mb-6">
                <h2 className="text-base font-semibold text-slate-900 dark:text-white mb-4 tracking-wide">{t('manualWA.title')}</h2>
                <textarea
                  rows={4}
                  value={opsWaText}
                  onChange={(e) => setOpsWaText(e.target.value)}
                  placeholder={t('manualWA.placeholder')}
                  className="w-full bg-gray-100 border border-gray-300 text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white rounded-lg px-3 py-2 text-sm resize-none mb-2"
                />
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                  {t('manualWA.char_count', { count: opsWaText.length.toLocaleString('en-US') })}
                </p>
                <button
                  type="button"
                  disabled={opsSendingWa || opsWaText.trim().length < 5}
                  onClick={() => {
                    void (async () => {
                      const headers = await getAuthHeaders();
                      if (!headers) return;
                      setOpsSendingWa(true);
                      try {
                        const res = await fetch(`/api/admin/centers/${centerId}/send-wa`, {
                          method: 'POST',
                          headers,
                          body: JSON.stringify({ message: opsWaText.trim() }),
                        });
                        const j = (await res.json().catch(() => ({}))) as {
                          error?: string;
                          errorKey?: string;
                          errorDetail?: string;
                          center_name?: string;
                          sent_to?: string;
                        };
                        if (!res.ok) {
                          showApiError(j as Record<string, unknown>);
                          return;
                        }
                        toast.success(
                          t('manualWA.success', {
                            name: j.center_name ?? '',
                            phone: j.sent_to ?? '',
                          }),
                        );
                        setOpsWaText('');
                        await refreshOpsPanels();
                      } finally {
                        setOpsSendingWa(false);
                      }
                    })();
                  }}
                  className="rounded-lg bg-[#25D366] text-white px-4 py-2 text-sm font-semibold hover:opacity-90 disabled:opacity-50"
                >
                  {opsSendingWa ? t('manualWA.sending') : t('manualWA.send')}
                </button>
              </section>

              <section className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl p-6 mb-6">
                <h2 className="text-base font-semibold text-slate-900 dark:text-white mb-4 tracking-wide">{t('auditLog.title')}</h2>
                {opsAuditLoading ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">{t('centerManagement.loading')}</p>
                ) : opsAuditLogs.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">{t('auditLog.no_logs')}</p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-gray-300 dark:border-slate-600">
                    <table className="w-full text-sm text-slate-800 dark:text-slate-200 min-w-[640px]">
                      <thead className="bg-[var(--color-surface-0)] text-slate-500 dark:text-slate-400">
                        <tr>
                          <th className="text-start p-2 font-medium">{t('auditLog.col_date')}</th>
                          <th className="text-start p-2 font-medium">{t('auditLog.col_action')}</th>
                          <th className="text-start p-2 font-medium">{t('auditLog.col_user')}</th>
                          <th className="text-start p-2 font-medium">{t('auditLog.col_details')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {opsAuditLogs.map((log) => (
                          <tr key={String(log.id)} className="border-t border-gray-200 dark:border-t-slate-700">
                            <td className="p-2 whitespace-nowrap tabular-nums">
                              {log.created_at
                                ? new Date(String(log.created_at)).toLocaleString('en-US', {
                                    dateStyle: 'medium',
                                    timeStyle: 'short',
                                  })
                                : tCommon('notSet')}
                            </td>
                            <td className="p-2 font-mono text-xs">
                              {log.action != null && String(log.action) !== ''
                                ? String(log.action)
                                : (
                                    <span className="text-slate-600 text-xs" aria-hidden>
                                      -
                                    </span>
                                  )}
                            </td>
                            <td className="p-2">
                              {log.actor_label != null && String(log.actor_label) !== ''
                                ? String(log.actor_label)
                                : (
                                    <span className="text-slate-600 text-xs" aria-hidden>
                                      -
                                    </span>
                                  )}
                            </td>
                            <td className="p-2 text-xs break-all max-w-md">
                              {(() => {
                                const raw = log.details;
                                const d =
                                  raw &&
                                  typeof raw === 'object' &&
                                  !Array.isArray(raw) &&
                                  raw !== null
                                    ? (raw as Record<string, unknown>)
                                    : null;
                                if (!d || Object.keys(d).length === 0) {
                                  return (
                                    <span className="text-slate-600 text-xs" aria-hidden>
                                      -
                                    </span>
                                  );
                                }
                                return (
                                  <div className="text-xs text-slate-400 space-y-0.5">
                                    {Object.entries(d).map(([k, v]) => (
                                      <div key={k}>
                                        <span className="text-slate-500">{k}:</span>{' '}
                                        <span className="text-slate-300">{String(v)}</span>
                                      </div>
                                    ))}
                                  </div>
                                );
                              })()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl p-6 mb-6">
                <h2 className="text-base font-semibold text-slate-900 dark:text-white mb-4 tracking-wide">{t('centerManagement.section12.title')}</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">{t('centerManagement.section12.id')}</div>
                    <div className="text-sm font-medium text-slate-900 dark:text-slate-900 dark:text-white font-mono">{shortUuid(data?.center?.id)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">{t('centerManagement.section12.createdAt')}</div>
                    <div className="text-sm font-medium text-slate-900 dark:text-white">{formatDate(data?.center?.created_at)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">{t('centerManagement.section12.approvedAt')}</div>
                    <div className="text-sm font-medium text-slate-900 dark:text-white">{formatDate(data?.center?.approved_at)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">{t('centerManagement.section12.approvedBy')}</div>
                    <div className="text-sm font-medium text-slate-900 dark:text-white">{getAdminName(data?.center?.approved_by)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">{t('centerManagement.section12.healthScore')}</div>
                    <div className="text-sm font-medium text-slate-900 dark:text-white">
                      {data.center.health_score != null && !isNaN(Number(data.center.health_score))
                        ? Number(data.center.health_score).toLocaleString('en-US')
                        : tCommon('notSet')}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">{t('centerManagement.section12.healthBand')}</div>
                    <div className="text-sm font-medium text-slate-900 dark:text-white">
                      {data.center.health_score_band != null
                        ? String(data.center.health_score_band)
                        : tCommon('notSet')}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">{t('centerManagement.section12.onboardingStep')}</div>
                    <div className="text-sm font-medium text-slate-900 dark:text-white">
                      {data.center.onboarding_step != null
                        ? String(data.center.onboarding_step)
                        : tCommon('notSet')}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">{t('centerManagement.section12.onboardingCompleted')}</div>
                    <div className="text-sm font-medium text-slate-900 dark:text-white">
                      {data.center.onboarding_completed === true
                        ? '✅'
                        : data.center.onboarding_completed === false
                          ? '❌'
                          : tCommon('notSet')}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">{t('centerManagement.section12.onboardingStarted')}</div>
                    <div className="text-sm font-medium text-slate-900 dark:text-white">{formatDate(data?.center?.onboarding_started_at)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">{t('centerManagement.section12.lastPayment')}</div>
                    <div className="text-sm font-medium text-slate-900 dark:text-white">{formatDate(data?.center?.last_payment_date)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">{t('centerManagement.section12.studentSequence')}</div>
                    <div className="text-sm font-medium text-slate-900 dark:text-white">
                      {data.center.student_sequence != null && !isNaN(Number(data.center.student_sequence))
                        ? Number(data.center.student_sequence).toLocaleString('en-US')
                        : tCommon('notSet')}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">{t('centerManagement.section12.packActivatedAt')}</div>
                    <div className="text-sm font-medium text-slate-900 dark:text-white">{formatDate(data?.center?.parent_pack_activated_at)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">{t('centerManagement.section12.packDisabledAt')}</div>
                    <div className="text-sm font-medium text-slate-900 dark:text-white">{formatDate(data?.center?.pack_disabled_at)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">{t('centerManagement.section12.renewalReminder')}</div>
                    <div className="text-sm font-medium text-slate-900 dark:text-white">{formatDate(data?.center?.renewal_reminder_sent_at)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">{t('centerManagement.section12.overdueReminder')}</div>
                    <div className="text-sm font-medium text-slate-900 dark:text-white">{formatDate(data?.center?.overdue_reminder_sent_at)}</div>
                  </div>
                </div>
              </section>
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}
