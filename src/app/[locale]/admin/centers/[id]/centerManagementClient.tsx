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

const GOVERNORATE_OPTIONS: { value: string; label: string }[] = [
  { value: 'cairo', label: 'Cairo — القاهرة' },
  { value: 'giza', label: 'Giza — الجيزة' },
  { value: 'alexandria', label: 'Alexandria — الإسكندرية' },
  { value: 'dakahlia', label: 'Dakahlia — الدقهلية' },
  { value: 'red_sea', label: 'Red Sea — البحر الأحمر' },
  { value: 'beheira', label: 'Beheira — البحيرة' },
  { value: 'fayoum', label: 'Fayoum — الفيوم' },
  { value: 'gharbia', label: 'Gharbia — الغربية' },
  { value: 'ismailia', label: 'Ismailia — الإسماعيلية' },
  { value: 'menofia', label: 'Menofia — المنوفية' },
  { value: 'minya', label: 'Minya — المنيا' },
  { value: 'qaliubiya', label: 'Qaliubiya — القليوبية' },
  { value: 'new_valley', label: 'New Valley — الوادي الجديد' },
  { value: 'suez', label: 'Suez — السويس' },
  { value: 'aswan', label: 'Aswan — أسوان' },
  { value: 'assiut', label: 'Assiut — أسيوط' },
  { value: 'beni_suef', label: 'Beni Suef — بني سويف' },
  { value: 'port_said', label: 'Port Said — بورسعيد' },
  { value: 'damietta', label: 'Damietta — دمياط' },
  { value: 'sharqia', label: 'Sharqia — الشرقية' },
  { value: 'south_sinai', label: 'South Sinai — جنوب سيناء' },
  { value: 'kafr_el_sheikh', label: 'Kafr El Sheikh — كفر الشيخ' },
  { value: 'matrouh', label: 'Matrouh — مطروح' },
  { value: 'luxor', label: 'Luxor — الأقصر' },
  { value: 'qena', label: 'Qena — قنا' },
  { value: 'north_sinai', label: 'North Sinai — شمال سيناء' },
  { value: 'sohag', label: 'Sohag — سوهاج' },
];

function statusBadgeClass(status: string | undefined): string {
  switch (status) {
    case 'active':
      return 'bg-teal-900 text-teal-300';
    case 'suspended':
      return 'bg-red-900 text-red-300';
    case 'pending':
      return 'bg-amber-900 text-amber-300';
    case 'rejected':
      return 'bg-slate-700 text-slate-400';
    default:
      return 'bg-slate-700 text-slate-400';
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
      return 'bg-slate-700 text-slate-400';
    case 'approved':
      return 'bg-teal-900 text-teal-300';
    case 'rejected':
    case 'failed':
      return 'bg-red-900 text-red-300';
    case 'chargeback':
      return 'bg-orange-900 text-orange-300';
    default:
      return 'bg-slate-700 text-slate-400';
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

  // Section 3 — MUST precede handlePlanChange (which calls setS3AllInPrice, setS3BillingAmount)
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
  const [s4CreateNotes, setS4CreateNotes] = useState('');
  const [s4CreateError, setS4CreateError] = useState('');
  const [s4CreateSaving, setS4CreateSaving] = useState(false);
  const [s4ActionLoadingId, setS4ActionLoadingId] = useState<string | null>(null);

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
    setS4CreateNotes('');
    setS4CreateError('');
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
  }, [data?.center?.id]);

  useEffect(() => {
    if (!data) return;
    setS4Invoices((data.invoices ?? []) as Record<string, unknown>[]);
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
          notes: s4CreateNotes || null,
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

  const billingNum = parseFloat(s3BillingAmount);
  const allInNum = parseFloat(s3AllInPrice);
  const effectiveMonthly = !isNaN(billingNum) ? billingNum / 3 : 0;
  const annualEquivalent = !isNaN(allInNum) ? allInNum * 12 * 0.85 : 0;

  return (
    <div
      className="flex flex-col min-h-screen bg-[var(--color-surface-0)]"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      <AdminHeader />
      <div className="flex flex-1 pt-14">
        <AdminSidebar activeRoute={`/admin/centers/${centerId}`} />
        <main className="flex-1 flex flex-col min-w-0 p-4 md:p-6 overflow-auto lg:ms-56">
          {loading ? (
            <div className="space-y-3 max-w-xl" aria-busy="true">
              <div className="h-4 bg-slate-700 rounded animate-pulse" />
              <div className="h-4 bg-slate-700 rounded animate-pulse w-5/6" />
              <div className="h-4 bg-slate-700 rounded animate-pulse w-4/6" />
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
                      {(data.center.name as string) ?? '—'}
                    </h1>
                    {data.center.center_code ? (
                      <span className="text-xs font-mono px-2 py-0.5 rounded-md bg-slate-800 text-slate-200 border border-slate-600">
                        {String(data.center.center_code)}
                      </span>
                    ) : null}
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-md capitalize ${statusBadgeClass(
                        data.center.status as string | undefined,
                      )}`}
                    >
                      {String(data.center.status ?? '—')}
                    </span>
                  </div>
                </div>
              </div>

              <section className="bg-slate-800 border border-slate-700 rounded-xl p-6 mb-6">
                <h2 className="text-lg font-semibold text-white mb-4">{t('centerManagement.section1.title')}</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-slate-300 mb-1">{t('centerManagement.section1.name')}</label>
                    <input
                      type="text"
                      value={s1Name}
                      onChange={(e) => setS1Name(e.target.value)}
                      className="w-full rounded-lg border border-slate-600 bg-slate-900 text-white px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-slate-300 mb-1">
                      {t('centerManagement.section1.ownerName')}
                    </label>
                    <input
                      type="text"
                      value={s1OwnerName}
                      onChange={(e) => setS1OwnerName(e.target.value)}
                      className="w-full rounded-lg border border-slate-600 bg-slate-900 text-white px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-slate-300 mb-1">{t('centerManagement.section1.phone')}</label>
                    <input
                      type="text"
                      value={s1Phone}
                      onChange={(e) => setS1Phone(e.target.value)}
                      className="w-full rounded-lg border border-slate-600 bg-slate-900 text-white px-3 py-2"
                      dir="ltr"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-slate-300 mb-1">{t('centerManagement.section1.email')}</label>
                    <input
                      type="email"
                      value={s1Email}
                      onChange={(e) => setS1Email(e.target.value)}
                      className="w-full rounded-lg border border-slate-600 bg-slate-900 text-white px-3 py-2"
                      dir="ltr"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-slate-300 mb-1">{t('centerManagement.section1.city')}</label>
                    <input
                      type="text"
                      value={s1City}
                      onChange={(e) => setS1City(e.target.value)}
                      className="w-full rounded-lg border border-slate-600 bg-slate-900 text-white px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-slate-300 mb-1">
                      {t('centerManagement.section1.district')}
                    </label>
                    <input
                      type="text"
                      value={s1District}
                      onChange={(e) => setS1District(e.target.value)}
                      className="w-full rounded-lg border border-slate-600 bg-slate-900 text-white px-3 py-2"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm text-slate-300 mb-1">
                      {t('centerManagement.section1.governorate')}
                    </label>
                    <select
                      value={s1Governorate}
                      onChange={(e) => setS1Governorate(e.target.value)}
                      className="w-full rounded-lg border border-slate-600 bg-slate-900 text-white px-3 py-2"
                    >
                      <option value="">— Select —</option>
                      {GOVERNORATE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm text-slate-300 mb-1">
                      {t('centerManagement.section1.centerCode')}
                    </label>
                    <input
                      type="text"
                      value={s1CenterCode}
                      onChange={(e) => setS1CenterCode(e.target.value)}
                      className="w-full rounded-lg border border-slate-600 bg-slate-900 text-white px-3 py-2 font-mono"
                      dir="ltr"
                    />
                    <p className="text-amber-400/90 text-sm mt-1">{t('centerManagement.section1.centerCodeWarning')}</p>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm text-slate-300 mb-1">
                      {t('centerManagement.section1.cardColor')}
                    </label>
                    <div className="flex items-center gap-3">
                      <input
                        type="color"
                        value={s1CardColor}
                        onChange={(e) => setS1CardColor(e.target.value)}
                        className="h-10 w-14 cursor-pointer rounded border border-slate-600 bg-transparent p-0"
                        aria-label={t('centerManagement.section1.cardColor')}
                      />
                      <span
                        className="h-8 w-8 min-h-[32px] min-w-[32px] rounded-full border-2 border-slate-500 shrink-0"
                        style={{ backgroundColor: s1CardColor }}
                        aria-hidden
                      />
                    </div>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm text-slate-300 mb-1">
                      {t('centerManagement.section1.signupNotes')}
                    </label>
                    <textarea
                      rows={5}
                      value={s1SignupNotes}
                      onChange={(e) => setS1SignupNotes(e.target.value)}
                      className="w-full rounded-lg border border-slate-600 bg-slate-900 text-white px-3 py-2 resize-y min-h-[120px]"
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

              <section className="bg-slate-800 border border-slate-700 rounded-xl p-6 mb-6">
                <h2 className="text-lg font-semibold text-white mb-4">{t('centerManagement.section2.title')}</h2>
                {s2PlanWarning ? (
                  <p className="text-amber-400/90 text-sm mb-4">{t('centerManagement.section2.planWarning')}</p>
                ) : null}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-slate-300 mb-1">{t('centerManagement.section2.status')}</label>
                    <select
                      value={s2Status}
                      onChange={(e) => setS2Status(e.target.value)}
                      className="w-full rounded-lg border border-slate-600 bg-slate-900 text-white px-3 py-2"
                    >
                      <option value="active">active</option>
                      <option value="suspended">suspended</option>
                      <option value="pending">pending</option>
                      <option value="rejected">rejected</option>
                      <option value="deleted">deleted</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-slate-300 mb-1">
                      {t('centerManagement.section2.subscriptionStatus')}
                    </label>
                    <select
                      value={s2SubscriptionStatus}
                      onChange={(e) => setS2SubscriptionStatus(e.target.value)}
                      className="w-full rounded-lg border border-slate-600 bg-slate-900 text-white px-3 py-2"
                    >
                      <option value="active">active</option>
                      <option value="suspended">suspended</option>
                      <option value="pending">pending</option>
                      <option value="trial">trial</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-slate-300 mb-1">
                      {t('centerManagement.section2.billingStatus')}
                    </label>
                    <select
                      value={s2BillingStatus}
                      onChange={(e) => setS2BillingStatus(e.target.value)}
                      className="w-full rounded-lg border border-slate-600 bg-slate-900 text-white px-3 py-2"
                    >
                      <option value="active">active</option>
                      <option value="suspended">suspended</option>
                      <option value="pending">pending</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-slate-300 mb-1">{t('centerManagement.section2.plan')}</label>
                    <select
                      value={s2Plan}
                      onChange={(e) => handlePlanChange(e.target.value)}
                      className="w-full rounded-lg border border-slate-600 bg-slate-900 text-white px-3 py-2"
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
                    <label className="block text-sm text-slate-300 mb-1">
                      {t('centerManagement.section2.pricingType')}
                    </label>
                    <select
                      value={s2PricingType}
                      onChange={(e) => setS2PricingType(e.target.value)}
                      className="w-full rounded-lg border border-slate-600 bg-slate-900 text-white px-3 py-2"
                    >
                      <option value="fixed">fixed</option>
                      <option value="payg">payg</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-slate-300 mb-1">
                      {t('centerManagement.section2.billingType')}
                    </label>
                    <select
                      value={s2BillingType}
                      onChange={(e) => setS2BillingType(e.target.value)}
                      className="w-full rounded-lg border border-slate-600 bg-slate-900 text-white px-3 py-2"
                    >
                      <option value="fixed">fixed</option>
                      <option value="subscription">subscription</option>
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm text-slate-300 mb-1">
                      {t('centerManagement.section2.billingPeriod')}
                    </label>
                    <select
                      value={s2SubBillingPeriod}
                      onChange={(e) => setS2SubBillingPeriod(e.target.value)}
                      className="w-full rounded-lg border border-slate-600 bg-slate-900 text-white px-3 py-2"
                    >
                      <option value="monthly">monthly</option>
                      <option value="quarterly">quarterly</option>
                      <option value="biannual">biannual</option>
                      <option value="yearly">yearly</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-slate-300 mb-1">
                      {t('centerManagement.section2.weeklyStudentLimit')}
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={s2WeeklyStudentLimit}
                      onChange={(e) => setS2WeeklyStudentLimit(e.target.value)}
                      className="w-full rounded-lg border border-slate-600 bg-slate-900 text-white px-3 py-2"
                      dir="ltr"
                    />
                  </div>
                  {s2PricingType === 'payg' ? (
                    <div>
                      <label className="block text-sm text-slate-300 mb-1">
                        {t('centerManagement.section2.paygRate')}
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={s2PaygRate}
                        onChange={(e) => setS2PaygRate(e.target.value)}
                        className="w-full rounded-lg border border-slate-600 bg-slate-900 text-white px-3 py-2"
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

              <section className="bg-slate-800 border border-slate-700 rounded-xl p-6 mb-6">
                <h2 className="text-lg font-semibold text-white mb-4">{t('centerManagement.section3.title')}</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4 text-sm text-slate-300">
                  <div>
                    {t('centerManagement.section3.effectiveMonthly')}:{' '}
                    <span className="text-white font-medium tabular-nums">
                      {!isNaN(billingNum) ? effectiveMonthly.toLocaleString(locale) : '—'}
                    </span>
                  </div>
                  <div>
                    {t('centerManagement.section3.annualEquivalent')}:{' '}
                    <span className="text-white font-medium tabular-nums">
                      {!isNaN(allInNum) ? Math.round(annualEquivalent).toLocaleString(locale) : '—'}
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-slate-300 mb-1">
                      {t('centerManagement.section3.billingAmount')}
                    </label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={s3BillingAmount}
                      onChange={(e) => setS3BillingAmount(e.target.value)}
                      className="w-full rounded-lg border border-slate-600 bg-slate-900 text-white px-3 py-2"
                      dir="ltr"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-slate-300 mb-1">
                      {t('centerManagement.section3.allInPrice')}
                    </label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={s3AllInPrice}
                      onChange={(e) => setS3AllInPrice(e.target.value)}
                      className="w-full rounded-lg border border-slate-600 bg-slate-900 text-white px-3 py-2"
                      dir="ltr"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-slate-300 mb-1">
                      {t('centerManagement.section3.nextPaymentDue')}
                    </label>
                    <input
                      type="text"
                      value={s3NextPaymentDue}
                      onChange={(e) => setS3NextPaymentDue(e.target.value)}
                      placeholder="YYYY-MM-DD"
                      className="w-full rounded-lg border border-slate-600 bg-slate-900 text-white px-3 py-2"
                      dir="ltr"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-slate-300 mb-1">
                      {t('centerManagement.section3.autoSuspendAt')}
                    </label>
                    <input
                      type="text"
                      value={s3AutoSuspendAt}
                      onChange={(e) => setS3AutoSuspendAt(e.target.value)}
                      className="w-full rounded-lg border border-slate-600 bg-slate-900 text-white px-3 py-2"
                      dir="ltr"
                    />
                    <p className="text-slate-400 text-xs mt-1">{t('centerManagement.section3.autoSuspendWarning')}</p>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm text-slate-300 mb-1">
                      {t('centerManagement.section3.subscriptionStartDate')}
                    </label>
                    <input
                      type="text"
                      value={s3SubStartDate}
                      onChange={(e) => setS3SubStartDate(e.target.value)}
                      placeholder="YYYY-MM-DD"
                      className="w-full rounded-lg border border-slate-600 bg-slate-900 text-white px-3 py-2 max-w-md"
                      dir="ltr"
                    />
                  </div>
                  <div className="md:col-span-2 flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="early-adopter"
                      checked={s3IsEarlyAdopter}
                      onChange={(e) => setS3IsEarlyAdopter(e.target.checked)}
                      className="rounded border-slate-600"
                    />
                    <label htmlFor="early-adopter" className="text-sm text-slate-300">
                      {t('centerManagement.section3.isEarlyAdopter')}
                    </label>
                  </div>
                  {s3IsEarlyAdopter ? (
                    <>
                      <div>
                        <label className="block text-sm text-slate-300 mb-1">
                          {t('centerManagement.section3.earlyAdopterPrice')}
                        </label>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={s3EarlyAdopterPrice}
                          onChange={(e) => setS3EarlyAdopterPrice(e.target.value)}
                          className="w-full rounded-lg border border-slate-600 bg-slate-900 text-white px-3 py-2"
                          dir="ltr"
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-slate-300 mb-1">
                          {t('centerManagement.section3.earlyAdopterNumber')}
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={s3EarlyAdopterNumber}
                          onChange={(e) => setS3EarlyAdopterNumber(e.target.value)}
                          className="w-full rounded-lg border border-slate-600 bg-slate-900 text-white px-3 py-2"
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

              <section className="bg-slate-800 border border-slate-700 rounded-xl p-6 mb-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                  <h2 className="text-lg font-semibold text-white">{t('centerManagement.section4.title')}</h2>
                  <button
                    type="button"
                    onClick={() => openCreateModal()}
                    className="rounded-lg bg-teal-600 text-white px-4 py-2 text-sm font-semibold hover:bg-teal-500 shrink-0"
                  >
                    {t('centerManagement.section4.createInvoice')}
                  </button>
                </div>
                {s4Invoices.length === 0 ? (
                  <p className="text-slate-400">{t('centerManagement.section4.noInvoices')}</p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-slate-600">
                    <table className="w-full text-sm text-left text-slate-200 min-w-[720px]">
                      <thead className="bg-slate-900 text-slate-400">
                        <tr>
                          <th className="p-2 font-medium">{t('centerManagement.section4.invoiceNumber')}</th>
                          <th className="p-2 font-medium">{t('centerManagement.section4.type')}</th>
                          <th className="p-2 font-medium">{t('centerManagement.section4.amount')}</th>
                          <th className="p-2 font-medium">{t('centerManagement.section4.status')}</th>
                          <th className="p-2 font-medium">{t('centerManagement.section4.dueDate')}</th>
                          <th className="p-2 font-medium">{t('centerManagement.section4.created')}</th>
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
                              <tr className="border-t border-slate-700 align-top">
                                <td className="p-2 font-mono text-xs">{String(inv.invoice_number ?? '—')}</td>
                                <td className="p-2">{String(inv.invoice_type ?? '—')}</td>
                                <td className="p-2 tabular-nums">
                                  {inv.total_amount != null ? String(inv.total_amount) : '—'}
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
                                  {inv.due_date != null ? String(inv.due_date).slice(0, 10) : '—'}
                                </td>
                                <td className="p-2 text-xs whitespace-nowrap">
                                  {inv.created_at != null ? String(inv.created_at).slice(0, 10) : '—'}
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
                                <tr className="bg-slate-900/80 border-t border-slate-700">
                                  <td colSpan={7} className="p-4 space-y-4">
                                    <div className="flex flex-wrap gap-3 items-end">
                                      <div>
                                        <label className="block text-xs text-slate-400 mb-1">
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
                                          className="rounded-lg border border-slate-600 bg-slate-900 text-white px-2 py-1.5 text-sm"
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
                                          <label className="block text-xs text-slate-400 mb-1">
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
                                            className="w-28 rounded-lg border border-slate-600 bg-slate-900 text-white px-2 py-1.5"
                                            dir="ltr"
                                          />
                                          <button
                                            type="button"
                                            disabled={busy}
                                            onClick={() => void saveInvoiceDiscount(invId)}
                                            className="ms-2 rounded bg-slate-600 text-white px-2 py-1.5 text-xs disabled:opacity-50"
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
                  <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 max-w-md w-full space-y-3">
                    <h3 className="text-lg font-semibold text-white">{t('centerManagement.section4.markPaid')}</h3>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">
                        {t('centerManagement.section4.paymentMethod')}
                      </label>
                      <select
                        value={s4MarkPaidMethod}
                        onChange={(e) => setS4MarkPaidMethod(e.target.value)}
                        className="w-full rounded-lg border border-slate-600 bg-slate-900 text-white px-3 py-2"
                      >
                        <option value="cash">cash</option>
                        <option value="bank_transfer">bank_transfer</option>
                        <option value="card">card</option>
                        <option value="other">other</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">
                        {t('centerManagement.section4.paymentReference')}
                      </label>
                      <input
                        type="text"
                        value={s4MarkPaidRef}
                        onChange={(e) => setS4MarkPaidRef(e.target.value)}
                        className="w-full rounded-lg border border-slate-600 bg-slate-900 text-white px-3 py-2"
                        dir="ltr"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">
                        {t('centerManagement.section4.paidAt')}
                      </label>
                      <input
                        type="date"
                        value={s4MarkPaidAt}
                        onChange={(e) => setS4MarkPaidAt(e.target.value)}
                        className="w-full rounded-lg border border-slate-600 bg-slate-900 text-white px-3 py-2"
                      />
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setS4MarkPaidId(null)}
                        className="px-4 py-2 rounded-lg text-slate-300 hover:bg-slate-700"
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
                  <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 max-w-lg w-full space-y-3 max-h-[90vh] overflow-y-auto">
                    <h3 className="text-lg font-semibold text-white">
                      {t('centerManagement.section4.createInvoice')}
                    </h3>
                    {s4CreateError ? <p className="text-red-400 text-sm">{s4CreateError}</p> : null}
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">
                        {t('centerManagement.section4.invoiceType')}
                      </label>
                      <select
                        value={s4CreateType}
                        onChange={(e) => setS4CreateType(e.target.value)}
                        className="w-full rounded-lg border border-slate-600 bg-slate-900 text-white px-3 py-2"
                      >
                        {CREATE_INVOICE_TYPES.map((ty) => (
                          <option key={ty} value={ty}>
                            {ty}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">
                        {t('centerManagement.section4.totalAmount')}
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={s4CreateAmount}
                        onChange={(e) => setS4CreateAmount(e.target.value)}
                        className="w-full rounded-lg border border-slate-600 bg-slate-900 text-white px-3 py-2"
                        dir="ltr"
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">
                          {t('centerManagement.section4.periodStart')}
                        </label>
                        <input
                          type="text"
                          value={s4CreatePeriodStart}
                          onChange={(e) => setS4CreatePeriodStart(e.target.value)}
                          placeholder="YYYY-MM-DD"
                          className="w-full rounded-lg border border-slate-600 bg-slate-900 text-white px-3 py-2"
                          dir="ltr"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">
                          {t('centerManagement.section4.periodEnd')}
                        </label>
                        <input
                          type="text"
                          value={s4CreatePeriodEnd}
                          onChange={(e) => setS4CreatePeriodEnd(e.target.value)}
                          placeholder="YYYY-MM-DD"
                          className="w-full rounded-lg border border-slate-600 bg-slate-900 text-white px-3 py-2"
                          dir="ltr"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">
                        {t('centerManagement.section4.dueDate')}
                      </label>
                      <input
                        type="text"
                        value={s4CreateDueDate}
                        onChange={(e) => setS4CreateDueDate(e.target.value)}
                        placeholder="YYYY-MM-DD"
                        className="w-full rounded-lg border border-slate-600 bg-slate-900 text-white px-3 py-2"
                        dir="ltr"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">
                        {t('centerManagement.section4.notes')}
                      </label>
                      <textarea
                        rows={3}
                        value={s4CreateNotes}
                        onChange={(e) => setS4CreateNotes(e.target.value)}
                        className="w-full rounded-lg border border-slate-600 bg-slate-900 text-white px-3 py-2"
                      />
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setS4ShowCreate(false)}
                        className="px-4 py-2 rounded-lg text-slate-300 hover:bg-slate-700"
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
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}
