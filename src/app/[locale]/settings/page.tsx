'use client';

import Image from 'next/image';
import { useState, useEffect, useMemo, useCallback, useRef, Suspense } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useRouter } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { dbSelect, dbInsert, dbUpdate, dbDelete, auditLog } from '@/lib/db-proxy';
import { useUser } from '@/contexts/UserContext';
import { Link } from '@/i18n/routing';
import { PageHeader, RoleBadge, PlanBadge } from '@/components/shared';
import PasswordConfirmModal from '@/components/PasswordConfirmModal';
import { Building2, BookOpen, Users, QrCode, Gift, CreditCard, MessageCircle, Shield, Camera, ChevronRight, Copy, KeyRound, LogOut, UserPlus, Pencil, UserX, X, Upload, LayoutDashboard, Loader2, FileText, Calendar } from 'lucide-react';
import { getPlanLevel } from '@/lib/plans';
import { FEATURES } from '@/lib/features';
import {
  PLANS,
  getPlanPrice,
  getQuarterlyCharge,
  getAnnualMonthlyEquivalent,
  getPerStudentWeeklyCost,
  getChargeFromQuarterlyAllIn,
  formatPrice,
  normalizeBillingPeriod,
  isPlanKey,
  type BillingPeriod,
  type PlanKey,
} from '@/lib/pricing';

type TabType = 'general' | 'billing' | 'team';

// ========== Types ==========
interface Subject {
  id: string;
  name: string;
  monthly_fee?: number;
}

interface CenterInfo {
  id: string;
  name: string;
  logo_url: string | null;
  scanner_default_mode: string;
  phone?: string | null;
  district?: string | null;
  max_teachers?: number;
  daily_summary_enabled?: boolean;
  summer_mode?: boolean;
}

interface TeamMember {
  id: string;
  name: string | null;
  phone: string;
  role: string;
  is_active?: boolean;
  can_scan?: boolean;
  can_view_payments?: boolean;
  can_record_payments?: boolean;
  can_view_dashboard?: boolean;
  can_view_revenue?: boolean;
  can_manage_students?: boolean;
  can_manage_groups?: boolean;
  can_allow_late_entry?: boolean;
  can_manage_rooms?: boolean;
  can_view_schedule?: boolean;
  can_view_settings?: boolean;
}

interface PendingInvite {
  id?: string;
  phone: string;
  role: string;
  status: string;
}

interface PricingPlan {
  id: string;
  name_en: string;
  name_ar: string;
  students_per_week_limit: number;
  monthly_fee: number;
  per_student_at_capacity_egp: number;
  setup_fee_egp: number;
  is_custom: boolean;
}

interface PaygRate {
  min_students_per_week: number;
  max_students_per_week: number;
  rate_per_student_egp: number;
}

// ========== Constants ==========
const PLAN_DISPLAY_NAMES: Record<string, string> = {
  nano: PLANS.nano.arabicName,
  starter: PLANS.starter.arabicName,
  pro: PLANS.pro.arabicName,
  business: PLANS.business.arabicName,
  enterprise: PLANS.enterprise.arabicName,
  top_centers: PLANS.top_centers.arabicName,
};

const SETUP_FEE_BY_PLAN: Record<string, number> = {
  nano: 500, starter: 1000, pro: 2000, business: 3000, enterprise: 5000, top_centers: 0,
};

const FALLBACK_PLAN_KEYS: PlanKey[] = ['nano', 'starter', 'pro', 'business', 'enterprise', 'top_centers'];

const FALLBACK_PLANS: PricingPlan[] = FALLBACK_PLAN_KEYS.map((id) => {
  const p = PLANS[id];
  const w = getPerStudentWeeklyCost(id);
  return {
    id,
    name_en: p.englishName,
    name_ar: p.arabicName,
    students_per_week_limit: p.weeklyStudentLimit ?? 999999,
    monthly_fee: p.quarterlyAllIn,
    per_student_at_capacity_egp: w ?? 0,
    setup_fee_egp: SETUP_FEE_BY_PLAN[id] ?? 0,
    is_custom: id === 'top_centers',
  };
});

const FALLBACK_PAYG: PaygRate[] = [
  { min_students_per_week: 0, max_students_per_week: 150, rate_per_student_egp: 4 },
  { min_students_per_week: 151, max_students_per_week: 500, rate_per_student_egp: 3 },
  { min_students_per_week: 501, max_students_per_week: 1000, rate_per_student_egp: 2.5 },
  { min_students_per_week: 1001, max_students_per_week: 2000, rate_per_student_egp: 2 },
  { min_students_per_week: 2001, max_students_per_week: 10000, rate_per_student_egp: 1.75 },
];

const MONTHLY_MULTIPLIER = 4.333;
const ADMIN_NOTIFICATION_PHONE = '201220601410';
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

const LOGO_MAX_SIZE = 2 * 1024 * 1024; // 2MB
const LOGO_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const PERMISSION_KEYS: { key: string; labelKey: string }[] = [
  { key: 'can_scan', labelKey: 'canScan' },
  { key: 'can_view_payments', labelKey: 'canViewPayments' },
  { key: 'can_record_payments', labelKey: 'canRecordPayments' },
  { key: 'can_view_dashboard', labelKey: 'canViewDashboard' },
  { key: 'can_view_revenue', labelKey: 'canViewRevenue' },
  { key: 'can_manage_students', labelKey: 'canManageStudents' },
  { key: 'can_manage_groups', labelKey: 'canManageGroups' },
  { key: 'can_allow_late_entry', labelKey: 'canAllowLateEntry' },
  { key: 'can_manage_rooms', labelKey: 'canManageRooms' },
  { key: 'can_view_schedule', labelKey: 'canViewSchedule' },
  { key: 'can_view_settings', labelKey: 'canViewSettings' },
];

// ========== Helpers ==========
function getBracketRate(students: number): number {
  if (students <= 150) return 4;
  if (students <= 500) return 3;
  if (students <= 1000) return 2.5;
  if (students <= 2000) return 2;
  return 1.75;
}

function calculatePaygCost(_rates: PaygRate[], students: number) {
  const rate = getBracketRate(students);
  const weeklyCost = students * rate;
  const monthly = Math.round(weeklyCost * MONTHLY_MULTIPLIER);
  const breakdown = students > 0 ? [{ from: 1, to: students, count: students, rate, cost: weeklyCost }] : [];
  return { weekly: weeklyCost, monthly, effectiveRate: rate, breakdown };
}

function getFixedPlanComparison(students: number) {
  if (students <= 75) return { planName: PLANS.nano.englishName, planNameAr: PLANS.nano.arabicName, planFee: getPlanPrice('nano', 'monthly'), isCustom: false };
  if (students <= 150) return { planName: PLANS.starter.englishName, planNameAr: PLANS.starter.arabicName, planFee: getPlanPrice('starter', 'monthly'), isCustom: false };
  if (students <= 500) return { planName: PLANS.pro.englishName, planNameAr: PLANS.pro.arabicName, planFee: getPlanPrice('pro', 'monthly'), isCustom: false };
  if (students <= 1000) return { planName: PLANS.business.englishName, planNameAr: PLANS.business.arabicName, planFee: getPlanPrice('business', 'monthly'), isCustom: false };
  if (students <= 2000) return { planName: PLANS.enterprise.englishName, planNameAr: PLANS.enterprise.arabicName, planFee: getPlanPrice('enterprise', 'monthly'), isCustom: false };
  return { planName: PLANS.top_centers.englishName, planNameAr: PLANS.top_centers.arabicName, planFee: 0, isCustom: true };
}

// Filter out pro_plus and nascent (legacy)
function filterPlans(plans: PricingPlan[]): PricingPlan[] {
  return (plans ?? FALLBACK_PLANS).filter(p => p.id !== 'pro_plus' && p.id !== 'nascent');
}

function SettingsPageContent() {
  const t = useTranslations('settings');
  const tCommon = useTranslations('common');
  const tReferral = useTranslations('referral');
  const tBilling = useTranslations('billing');
  const tNav = useTranslations('nav');
  const router = useRouter();
  const searchParams = useSearchParams();
  const locale = useLocale();
  const { user: currentUser, hasPermission, refreshUser } = useUser();
  const isRTL = locale === 'ar';

  // Tab from URL or default
  const tabParam = searchParams?.get('tab') as TabType | null;
  const [activeTab, setActiveTab] = useState<TabType>(tabParam && ['general', 'billing', 'team'].includes(tabParam) ? tabParam : 'general');

  useEffect(() => {
    if (tabParam && ['general', 'billing', 'team'].includes(tabParam)) {
      setActiveTab(tabParam as TabType);
    }
  }, [tabParam]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.replace('/login');
  };

  // Shared state
  const [center, setCenter] = useState<CenterInfo | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [centerId, setCenterId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [savedMessage, setSavedMessage] = useState('');

  // General
  const [centerName, setCenterName] = useState('');
  const [centerPhone, setCenterPhone] = useState('');
  const [centerDistrict, setCenterDistrict] = useState('');
  const [newSubjectName, setNewSubjectName] = useState('');
  const [scannerMode, setScannerMode] = useState('camera');
  const [dailySummaryEnabled, setDailySummaryEnabled] = useState(true);
  const [summerModeEnabled, setSummerModeEnabled] = useState(false);
  const [editingSubject, setEditingSubject] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [referralData, setReferralData] = useState<{ referralCode: string; rewards: { id: string; referred_center_name: string; referred_center_plan: string; reward_amount: number; reward_status: string; created_at: string }[]; pending?: { referred_center_name: string; referred_center_plan: string; reward_status: string }[]; totalEarned: number } | null>(null);
  const [referralCopied, setReferralCopied] = useState(false);
  const [logoLoadFailed, setLogoLoadFailed] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoToast, setLogoToast] = useState<'success' | 'error' | null>(null);

  // Billing
  const [billingData, setBillingData] = useState<{
    plan: string;
    pricing_type: string;
    billing_type?: string;
    billing_period?: BillingPeriod;
    all_in_price?: number | null;
    weekly_student_limit: number;
    plans: PricingPlan[];
    payg_rates: PaygRate[];
    current_plan_details?: PricingPlan;
    is_early_adopter?: boolean;
    early_adopter_price?: number;
    center_name?: string;
    invoices?: { id?: string; invoice_number?: string; period_start?: string; period_end?: string; total_amount?: number; payment_amount?: number; payment_reference?: string; payment_proof_url?: string; status: string; paid_at?: string; created_at?: string }[];
  } | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [paygSlider, setPaygSlider] = useState(200);
  const [changePlanSelect, setChangePlanSelect] = useState('');
  const [showPlanRequestModal, setShowPlanRequestModal] = useState(false);
  const [proofAmount, setProofAmount] = useState('');
  const [proofReference, setProofReference] = useState('');
  const [proofPaymentMethod, setProofPaymentMethod] = useState('instapay');
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);
  const [proofUploading, setProofUploading] = useState(false);
  const [billingSaving, setBillingSaving] = useState(false);
  const [selectedBillingPeriod, setSelectedBillingPeriod] = useState<BillingPeriod>('quarterly');
  const [planRequests, setPlanRequests] = useState<Array<{ id: string; current_plan: string; requested_plan: string; status: string; requested_at?: string }>>([]);
  const [payNowLoading, setPayNowLoading] = useState(false);

  // Team
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [limits, setLimits] = useState<{ maxTeachers: number; canAddTeacher: boolean } | null>(null);
  const [assistantPermissions, setAssistantPermissions] = useState<Record<string, Record<string, boolean>>>({});
  const [editingPermissionsId, setEditingPermissionsId] = useState<string | null>(null);
  const [permissionPrompt, setPermissionPrompt] = useState<{ targetId: string; key: string; enabled: boolean } | null>(null);
  const [permissionPromptError, setPermissionPromptError] = useState('');
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [invitePhone, setInvitePhone] = useState('');
  const [inviteRole, setInviteRole] = useState<'assistant' | 'teacher'>('assistant');
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [lastInvitePassword, setLastInvitePassword] = useState<string | null>(null);
  const [invitePerms, setInvitePerms] = useState<Record<string, boolean>>({
    can_scan: true, can_view_payments: true, can_view_dashboard: true,
    can_manage_students: false, can_manage_groups: false, can_view_settings: false,
  });
  const [inviteTeacherGroupIds, setInviteTeacherGroupIds] = useState<string[]>([]);
  const [inviteGroups, setInviteGroups] = useState<{ id: string; name: string; subject?: string }[]>([]);

  // Redirect assistants/teachers without can_view_settings
  useEffect(() => {
    if (currentUser && (currentUser.role === 'assistant' || currentUser.role === 'teacher') && !hasPermission('can_view_settings')) {
      router.replace('/dashboard');
    }
  }, [currentUser, hasPermission, router]);

  // Load groups when invite modal opens (for teacher Assign Groups)
  useEffect(() => {
    if (!showInviteModal || !centerId) return;
    const load = async () => {
      const { data } = await dbSelect({
        table: 'student_groups',
        select: 'id, name, subject',
        filters: [{ column: 'center_id', op: 'eq', value: centerId }],
        order: { column: 'name' },
      });
      setInviteGroups((data as { id: string; name: string; subject?: string }[]) ?? []);
    };
    load();
  }, [showInviteModal, centerId]);

  // Load general + center data
  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      setUserId(session.user.id);

      const meRes = await fetch('/api/me', { headers: { 'Authorization': `Bearer ${session.access_token}` } });
      const meData = await meRes.json();
      if (!meData?.user?.center_id) return;
      setCenterId(meData.user.center_id);
      const userCenterId = meData.user.center_id;

      const { data: centerData } = await dbSelect({
        table: 'centers',
        select: '*',
        filters: [{ column: 'id', op: 'eq', value: userCenterId }],
        single: true,
      });
      if (centerData) {
        const c = centerData as CenterInfo;
        setCenter(c);
        setCenterName(c.name || '');
        setCenterPhone(c.phone || '');
        setCenterDistrict(c.district || '');
        setScannerMode(c.scanner_default_mode || 'camera');
        setDailySummaryEnabled(c.daily_summary_enabled !== false);
        setSummerModeEnabled(c.summer_mode === true);
        setLogoUrl(c.logo_url ?? null);
        setLogoLoadFailed(false);
      }

      const { data: subjectsData } = await dbSelect({
        table: 'subjects',
        select: '*',
        filters: [{ column: 'center_id', op: 'eq', value: userCenterId }],
        order: { column: 'name' },
      });
      if (subjectsData) setSubjects(subjectsData as Subject[]);

      setIsLoading(false);
    };
    load();
  }, []);

  // Load referral
  useEffect(() => {
    const fetchReferral = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || !centerId) return;
      try {
        const res = await fetch('/api/referral', { headers: { 'Authorization': `Bearer ${session.access_token}` } });
        if (res.ok) setReferralData(await res.json());
      } catch (err) { console.error('Referral fetch error:', err); }
    };
    if (centerId) fetchReferral();
  }, [centerId]);

  // Load billing when tab is billing
  const fetchBilling = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    setBillingLoading(true);
    try {
      const res = await fetch('/api/settings/billing', { headers: { Authorization: `Bearer ${session.access_token}` } });
      if (!res.ok) {
        setBillingData({
          plan: 'starter',
          pricing_type: 'fixed',
          weekly_student_limit: 200,
          plans: FALLBACK_PLANS,
          payg_rates: FALLBACK_PAYG,
        });
      } else {
        const json = await res.json();
        const plans = (json.plans?.length ? json.plans : FALLBACK_PLANS) as PricingPlan[];
        const paygRates = (json.payg_rates?.length ? json.payg_rates : FALLBACK_PAYG) as PaygRate[];
        setBillingData({
          plan: json.plan || 'starter',
          pricing_type: json.pricing_type || json.billing_type || 'fixed',
          billing_type: json.billing_type || json.pricing_type,
          billing_period: normalizeBillingPeriod(json.billing_period),
          all_in_price: json.all_in_price != null ? Number(json.all_in_price) : null,
          weekly_student_limit: json.weekly_student_limit ?? 200,
          plans,
          payg_rates: paygRates,
          current_plan_details: json.current_plan_details,
          is_early_adopter: json.is_early_adopter,
          early_adopter_price: json.early_adopter_price,
          center_name: json.center_name,
          invoices: json.invoices || [],
        });
        setSelectedBillingPeriod(normalizeBillingPeriod(json.billing_period));
        setPaygSlider(json.weekly_student_limit ?? 200);
      }
      // Fetch plan requests for this center
      if (centerId) {
        const { data: planReqs } = await supabase
          .from('plan_requests')
          .select('id, current_plan, requested_plan, status, requested_at')
          .eq('center_id', centerId)
          .order('requested_at', { ascending: false })
          .limit(10);
        setPlanRequests(planReqs ?? []);
      }
    } catch {
      setBillingData({
        plan: 'starter',
        pricing_type: 'fixed',
        weekly_student_limit: 200,
        plans: FALLBACK_PLANS,
        payg_rates: FALLBACK_PAYG,
      });
    } finally {
      setBillingLoading(false);
    }
  }, [centerId]);

  useEffect(() => {
    if (activeTab === 'billing') fetchBilling();
  }, [activeTab, fetchBilling]);

  // Load team when tab is team
  const loadTeamData = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session || !centerId) return;

    try {
      const limitsRes = await fetch('/api/settings/limits', { headers: { 'Authorization': `Bearer ${session.access_token}` } });
      if (limitsRes.ok) {
        const limitsData = await limitsRes.json();
        setLimits({ maxTeachers: limitsData.maxTeachers ?? 2, canAddTeacher: limitsData.canAddTeacher !== false });
      } else setLimits({ maxTeachers: 2, canAddTeacher: true });
    } catch { setLimits({ maxTeachers: 2, canAddTeacher: true }); }

    const { data: membersData } = await dbSelect({
      table: 'users',
      select: 'id, name, phone, role, is_active, can_scan, can_view_payments, can_record_payments, can_view_dashboard, can_view_revenue, can_manage_students, can_manage_groups, can_allow_late_entry, can_manage_rooms, can_view_schedule, can_view_settings',
      filters: [{ column: 'center_id', op: 'eq', value: centerId! }],
    });
    const permMap: Record<string, Record<string, boolean>> = {};
    if (membersData) {
      setTeamMembers((membersData as (TeamMember & Record<string, unknown>)[]).map(m => {
        permMap[m.id] = {
          can_scan: m.can_scan === true,
          can_view_payments: m.can_view_payments === true,
          can_record_payments: m.can_record_payments === true,
          can_view_dashboard: m.can_view_dashboard === true,
          can_view_revenue: m.can_view_revenue === true,
          can_manage_students: m.can_manage_students === true,
          can_manage_groups: m.can_manage_groups === true,
          can_allow_late_entry: m.can_allow_late_entry === true,
          can_manage_rooms: m.can_manage_rooms === true,
          can_view_schedule: m.can_view_schedule === true,
          can_view_settings: m.can_view_settings === true,
        };
        return { id: m.id, name: m.name ?? null, phone: m.phone, role: m.role, is_active: m.is_active };
      }));
    }
    setAssistantPermissions(permMap);

    const { data: invitesData } = await dbSelect({
      table: 'center_invites',
      select: 'phone, role, status',
      filters: [{ column: 'center_id', op: 'eq', value: centerId! }, { column: 'status', op: 'eq', value: 'pending' }],
    });
    if (invitesData) {
      setPendingInvites((invitesData as PendingInvite[]).map(inv => ({ phone: inv.phone, role: inv.role, status: inv.status })));
    }
  }, [centerId]);

  useEffect(() => {
    if (activeTab === 'team' && centerId) loadTeamData();
  }, [activeTab, centerId, loadTeamData]);

  const showSaved = () => {
    setSavedMessage(t('saved'));
    setTimeout(() => setSavedMessage(''), 2000);
  };

  // Center handlers
  const handleSaveCenterName = async () => {
    if (!centerId || !userId || !centerName.trim()) return;
    const { error } = await dbUpdate({
      table: 'centers',
      data: { name: centerName.trim() },
      filters: [{ column: 'id', op: 'eq', value: centerId }],
    });
    if (!error) {
      await auditLog({ centerId, userId, action: 'center_update', entityType: 'centers', details: { field: 'name', value: centerName.trim() } });
      showSaved();
    }
  };

  const handleSaveCenterPhone = async () => {
    if (!centerId || !userId) return;
    const { error } = await dbUpdate({
      table: 'centers',
      data: { phone: centerPhone.trim() || null },
      filters: [{ column: 'id', op: 'eq', value: centerId }],
    });
    if (!error) {
      await auditLog({ centerId, userId, action: 'center_update', entityType: 'centers', details: { field: 'phone' } });
      setCenter(prev => prev ? { ...prev, phone: centerPhone.trim() || null } : null);
      showSaved();
    }
  };

  const handleSaveCenterDistrict = async () => {
    if (!centerId || !userId) return;
    const val = centerDistrict.trim() || null;
    const { error } = await dbUpdate({
      table: 'centers',
      data: { district: val },
      filters: [{ column: 'id', op: 'eq', value: centerId }],
    });
    if (!error) {
      await auditLog({ centerId, userId, action: 'center_update', entityType: 'centers', details: { field: 'district' } });
      setCenter(prev => prev ? { ...prev, district: val } : null);
      showSaved();
    }
  };

  const showLogoToast = (type: 'success' | 'error') => {
    setLogoToast(type);
    setTimeout(() => setLogoToast(null), 3000);
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !centerId || !userId || !center?.id) return;

    if (!LOGO_ALLOWED_TYPES.includes(file.type)) {
      showLogoToast('error');
      return;
    }
    if (file.size > LOGO_MAX_SIZE) {
      showLogoToast('error');
      return;
    }

    setLogoUploading(true);
    setLogoToast(null);
    const ext = file.name.split('.').pop() || 'png';
    const path = `${centerId}/logo.${ext}`;

    try {
      const { error: uploadError } = await supabase.storage.from('center-logos').upload(path, file, { upsert: true });
      if (uploadError) {
        console.error('Logo upload error:', uploadError);
        setLogoUploading(false);
        showLogoToast('error');
        return;
      }
      const { data: publicData } = supabase.storage.from('center-logos').getPublicUrl(path);
      const cacheBustedUrl = publicData.publicUrl + '?t=' + Date.now();
      const { error } = await dbUpdate({ table: 'centers', data: { logo_url: cacheBustedUrl }, filters: [{ column: 'id', op: 'eq', value: centerId }] });
      if (error) {
        console.error('Logo dbUpdate error:', error);
        setLogoUploading(false);
        showLogoToast('error');
        return;
      }
      await auditLog({ centerId, userId, action: 'center_update', entityType: 'centers', details: { field: 'logo' } });
      setLogoUrl(cacheBustedUrl);
      setCenter(prev => prev ? { ...prev, logo_url: cacheBustedUrl } : null);
      setLogoLoadFailed(false);
      await refreshUser();
      showLogoToast('success');
    } catch (err) {
      console.error('Logo upload error:', err);
      showLogoToast('error');
    } finally {
      setLogoUploading(false);
    }
  };

  const handleAddSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!centerId || !userId || !newSubjectName.trim()) return;
    const { data, error } = await dbInsert({ table: 'subjects', data: { center_id: centerId, name: newSubjectName.trim() }, single: true });
    if (!error && data) {
      const subject = data as Subject;
      await auditLog({ centerId, userId, action: 'subject_create', entityType: 'subjects', entityId: subject.id, details: { name: subject.name } });
      setSubjects(prev => [...prev, { ...subject, monthly_fee: 0 }]);
      setNewSubjectName('');
      showSaved();
    }
  };

  const handleUpdateSubject = async (id: string) => {
    if (!centerId || !userId) return;
    const { error } = await dbUpdate({ table: 'subjects', data: { name: editName.trim() }, filters: [{ column: 'id', op: 'eq', value: id }] });
    if (!error) {
      await auditLog({ centerId, userId, action: 'subject_update', entityType: 'subjects', entityId: id, details: { name: editName.trim() } });
      setSubjects(prev => prev.map(s => s.id === id ? { ...s, name: editName.trim() } : s));
      setEditingSubject(null);
      showSaved();
    }
  };

  const handleDeleteSubject = async (id: string) => {
    if (!confirm(t('deleteConfirm')) || !centerId || !userId) return;
    const subj = subjects.find(s => s.id === id);
    const { data: studentsWithSubject } = await dbSelect({ table: 'students', select: 'id', filters: [{ column: 'subject', op: 'eq', value: subj?.name ?? '' }], limit: 1 });
    if (studentsWithSubject && (studentsWithSubject as unknown[]).length > 0) {
      alert(t('subjectInUse'));
      return;
    }
    const { error } = await dbDelete({ table: 'subjects', filters: [{ column: 'id', op: 'eq', value: id }] });
    if (!error) {
      await auditLog({ centerId, userId, action: 'subject_delete', entityType: 'subjects', entityId: id, details: { name: subj?.name } });
      setSubjects(prev => prev.filter(s => s.id !== id));
    }
  };

  const handleScannerMode = async (mode: string) => {
    if (!centerId || !userId) return;
    setScannerMode(mode);
    const { error } = await dbUpdate({ table: 'centers', data: { scanner_default_mode: mode }, filters: [{ column: 'id', op: 'eq', value: centerId }] });
    if (!error) {
      await auditLog({ centerId, userId, action: 'center_update', entityType: 'centers', details: { field: 'scanner_mode', value: mode } });
      showSaved();
    }
  };

  const handleDailySummaryToggle = async (enabled: boolean) => {
    if (!centerId || !userId) return;
    setDailySummaryEnabled(enabled);
    const { error } = await dbUpdate({
      table: 'centers',
      data: { daily_summary_enabled: enabled },
      filters: [{ column: 'id', op: 'eq', value: centerId }],
    });
    if (!error) {
      await auditLog({ centerId, userId, action: 'center_update', entityType: 'centers', details: { field: 'daily_summary_enabled', value: enabled } });
      setCenter((prev) => (prev ? { ...prev, daily_summary_enabled: enabled } : null));
      showSaved();
    } else {
      setDailySummaryEnabled(!enabled);
    }
  };

  const handleSummerModeToggle = async (enabled: boolean) => {
    if (!centerId || !userId) return;
    setSummerModeEnabled(enabled);
    const { error } = await dbUpdate({
      table: 'centers',
      data: { summer_mode: enabled },
      filters: [{ column: 'id', op: 'eq', value: centerId }],
    });
    if (!error) {
      await auditLog({ centerId, userId, action: 'center_update', entityType: 'centers', details: { field: 'summer_mode', value: enabled } });
      setCenter((prev) => (prev ? { ...prev, summer_mode: enabled } : null));
      showSaved();
    } else {
      setSummerModeEnabled(!enabled);
    }
  };

  // Billing handlers
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) { alert(locale === 'ar' ? 'الملف كبير جداً' : 'File too large'); e.target.value = ''; return; }
    if (!ALLOWED_TYPES.includes(file.type)) { alert(locale === 'ar' ? 'نوع ملف غير صالح' : 'Invalid file type'); e.target.value = ''; return; }
    setProofPreview(prev => { if (prev) URL.revokeObjectURL(prev); return file.type.startsWith('image/') ? URL.createObjectURL(file) : null; });
    setProofFile(file);
    e.target.value = '';
  };

  const uploadProof = async (file: File, cId: string): Promise<string> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('centerId', cId);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not authenticated');
    const { getCsrfHeaders } = await import('@/lib/csrf-client');
    const res = await fetch('/api/upload/payment-proof', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, ...await getCsrfHeaders(session.access_token) }, body: formData });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Upload failed');
    if (!json.url) throw new Error('No URL returned');
    return json.url;
  };

  const handleSubmitPaymentProof = async () => {
    const amount = parseFloat(proofAmount);
    if (isNaN(amount) || amount <= 0 || !proofReference.trim() || billingSaving) return;
    try {
      setBillingSaving(true);
      let proofUrl: string | null = null;
      if (proofFile && centerId) {
        setProofUploading(true);
        proofUrl = await uploadProof(proofFile, centerId);
        setProofUploading(false);
      }
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { getCsrfHeaders } = await import('@/lib/csrf-client');
      const res = await fetch('/api/settings/billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, ...await getCsrfHeaders(session.access_token) },
        body: JSON.stringify({ amount, reference: proofReference.trim(), proofUrl, paymentMethod: proofPaymentMethod }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { alert(json?.error || 'Failed'); return; }
      setSavedMessage(tBilling('paymentSubmittedForReview', { defaultValue: 'Payment submitted for review.' }));
      setProofAmount('');
      setProofReference('');
      setProofFile(null);
      setProofPreview(null);
      fetchBilling();
      setTimeout(() => setSavedMessage(''), 5000);
      const centerName = billingData?.center_name || currentUser?.name || 'Unknown';
      const message = encodeURIComponent(`🔔 إثبات دفع جديد - CenterHQ\n💰 المبلغ: ${amount} EGP\n📝 المرجع: ${proofReference.trim()}\n🏢 السنتر: ${centerName}\n📅 ${new Date().toLocaleDateString('ar-EG')}`);
      window.open(`https://wa.me/${ADMIN_NOTIFICATION_PHONE}?text=${message}`, '_blank');
    } catch (err) {
      alert(err instanceof Error ? err.message : tBilling('updateFailed'));
    } finally {
      setBillingSaving(false);
      setProofUploading(false);
    }
  };

  const handleRequestPlanChange = async () => {
    if (!changePlanSelect || billingSaving || currentUser?.role !== 'owner') return;
    try {
      setBillingSaving(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { getCsrfHeaders } = await import('@/lib/csrf-client');
      const res = await fetch('/api/settings/plan-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, ...await getCsrfHeaders(session.access_token) },
        body: JSON.stringify({ requested_plan: changePlanSelect }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      setSavedMessage(json.message || tBilling('requestSubmitted'));
      setChangePlanSelect('');
      setShowPlanRequestModal(false);
      setTimeout(() => setSavedMessage(''), 5000);
    } catch (err) {
      alert(err instanceof Error ? err.message : tBilling('updateFailed'));
    } finally {
      setBillingSaving(false);
    }
  };

  const handlePayNow = async () => {
    if (!FEATURES.PAYMOB_ENABLED || payNowLoading || currentUser?.role !== 'owner') return;
    try {
      setPayNowLoading(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch('/api/billing/initiate-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      if (json.payment_url) window.open(json.payment_url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      alert(err instanceof Error ? err.message : tBilling('updateFailed'));
    } finally {
      setPayNowLoading(false);
    }
  };

  // Team handlers
  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteError('');
    setLastInvitePassword(null);
    if (!centerId || !userId) return;
    let phone = invitePhone.trim().replace(/\D/g, '');
    if (phone.startsWith('0')) phone = phone.substring(1);
    if (phone.length !== 10 || !/^1[0125]\d{8}$/.test(phone)) { setInviteError(t('invalidPhone')); return; }
    const phoneToSend = '0' + phone;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setInviteError(tCommon('error')); return; }
    setInviteSubmitting(true);
    try {
      const { getCsrfHeaders } = await import('@/lib/csrf-client');
      const body: Record<string, unknown> = { name: inviteName.trim() || '', phone: phoneToSend, role: inviteRole };
      if (inviteRole === 'teacher' && inviteTeacherGroupIds.length) {
        body.teacher_group_ids = inviteTeacherGroupIds;
      }
      if (inviteRole === 'assistant') {
        body.permissions = invitePerms;
      }
      const res = await fetch('/api/invite-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, ...await getCsrfHeaders(session.access_token) },
        body: JSON.stringify(body),
      });
      const result = await res.json();
      if (!res.ok) {
        setInviteError(result.code === 'TEAM_LIMIT_REACHED' ? t('planLimitReached') : result.error || 'Failed');
        return;
      }
      if (result.success && result.member) {
        setTeamMembers(prev => [...prev, result.member]);
        setAssistantPermissions(prev => ({ ...prev, [result.member.id]: { ...invitePerms } }));
        setInviteName('');
        setInvitePhone('');
        setInviteRole('assistant');
        setInvitePerms({ can_scan: true, can_view_payments: true, can_view_dashboard: true, can_manage_students: false, can_manage_groups: false, can_view_settings: false });
        setLastInvitePassword(result.tempPassword ?? null);
        setShowInviteModal(false);
        showSaved();
      } else if (result.success && result.pendingInvite) {
        setInviteName('');
        setInvitePhone('');
        setInviteRole('assistant');
        setInviteTeacherGroupIds([]);
        setPendingInvites(prev => [...prev, { phone: phoneToSend, role: inviteRole, status: 'pending' }]);
        setShowInviteModal(false);
        setSavedMessage(result.message || t('inviteSuccess'));
        setTimeout(() => setSavedMessage(''), 5000);
      } else setInviteError(result.error || 'Failed');
    } catch { setInviteError(tCommon('error')); }
    finally { setInviteSubmitting(false); }
  };

  const handleRemoveMember = async (member: TeamMember) => {
    if (!centerId || !userId || member.id === userId) return;
    if (!confirm(t('confirmRemove', { name: member.name || member.phone || '?' }))) return;
    const { error } = await dbDelete({ table: 'users', filters: [{ column: 'id', op: 'eq', value: member.id }] });
    if (!error) {
      await auditLog({ centerId, userId, action: 'team_member_remove', entityType: 'users', entityId: member.id, details: { name: member.name, phone: member.phone, role: member.role } });
      setTeamMembers(prev => prev.filter(m => m.id !== member.id));
      setSavedMessage(t('memberRemoved'));
      setTimeout(() => setSavedMessage(''), 2000);
    }
  };

  const handleToggleActive = async (member: TeamMember) => {
    if (!centerId || !userId) return;
    const newStatus = member.is_active === false;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    try {
      const { getCsrfHeaders } = await import('@/lib/csrf-client');
      const res = await fetch('/api/permissions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, ...await getCsrfHeaders(session.access_token) },
        body: JSON.stringify({ targetUserId: member.id, permissions: { is_active: newStatus }, centerId }),
      });
      if (!res.ok) throw new Error('Failed');
      setTeamMembers(prev => prev.map(m => m.id === member.id ? { ...m, is_active: newStatus } : m));
      setSavedMessage(newStatus ? t('memberActivated') : t('memberDeactivated'));
      setTimeout(() => setSavedMessage(''), 2000);
    } catch { alert(tCommon('error')); }
  };

  const handlePermissionToggle = (targetId: string, key: string, enabled: boolean) => {
    setPermissionPromptError('');
    setPermissionPrompt({ targetId, key, enabled });
  };

  const confirmPermissionChange = async (password: string) => {
    if (!permissionPrompt || !centerId) return;
    const { targetId, key, enabled } = permissionPrompt;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    setAssistantPermissions(prev => ({ ...prev, [targetId]: { ...prev[targetId], [key]: enabled } }));
    try {
      const { getCsrfHeaders } = await import('@/lib/csrf-client');
      const res = await fetch('/api/permissions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, ...await getCsrfHeaders(session.access_token) },
        body: JSON.stringify({ targetUserId: targetId, permissionKey: key, enabled, centerId, password }),
      });
      if (res.ok) { setPermissionPrompt(null); showSaved(); }
      else {
        const data = await res.json();
        setPermissionPromptError(data.error || t('permissionUpdateFailed'));
        setAssistantPermissions(prev => ({ ...prev, [targetId]: { ...prev[targetId], [key]: !enabled } }));
      }
    } catch {
      setPermissionPromptError(t('permissionUpdateFailed'));
      setAssistantPermissions(prev => ({ ...prev, [targetId]: { ...prev[targetId], [key]: !enabled } }));
    }
  };

  const getRoleBadgeClass = (role: string) => {
    if (role === 'owner') return 'bg-purple-100 text-purple-800';
    if (role === 'admin') return 'bg-blue-100 text-blue-800';
    if (role === 'teacher') return 'bg-amber-100 text-amber-800';
    return 'bg-green-100 text-green-800';
  };

  const getRoleLabel = (role: string) => {
    if (role === 'owner') return tNav('roleOwner');
    if (role === 'admin') return t('admin');
    if (role === 'teacher') return tNav('roleTeacher');
    return t('assistant');
  };

  const isOwner = (member: TeamMember) => member.role === 'owner' || member.role === 'admin';
  const canEditPermissions = (member: TeamMember) => !isOwner(member) && member.id !== userId;

  const plans = filterPlans(billingData?.plans ?? FALLBACK_PLANS);
  const paygRates = billingData?.payg_rates ?? FALLBACK_PAYG;
  const currentPlanDetails = billingData?.current_plan_details ?? plans.find(p => p.id === billingData?.plan);
  const currentPlanKey: PlanKey = isPlanKey(billingData?.plan) ? (billingData!.plan as PlanKey) : 'starter';
  const quarterlyBaseForCurrentCenter = useMemo(() => {
    if (!billingData || currentPlanKey === 'top_centers') return 0;
    if (billingData.is_early_adopter && typeof billingData.early_adopter_price === 'number') {
      return billingData.early_adopter_price;
    }
    if (billingData.all_in_price != null && billingData.all_in_price > 0) return billingData.all_in_price;
    return PLANS[currentPlanKey].quarterlyAllIn;
  }, [billingData, currentPlanKey]);
  const currentDisplayPrice = useMemo(() => {
    if (!billingData || currentPlanKey === 'top_centers') return 0;
    const q = quarterlyBaseForCurrentCenter;
    if (q <= 0) return 0;
    if (selectedBillingPeriod === 'quarterly') return q;
    if (selectedBillingPeriod === 'monthly') return Math.round(q * 1.15);
    return Math.round(q * 12 * 0.85);
  }, [billingData, currentPlanKey, quarterlyBaseForCurrentCenter, selectedBillingPeriod]);
  const currentCycleCharge = useMemo(() => {
    if (!billingData || currentPlanKey === 'top_centers') return 0;
    return getChargeFromQuarterlyAllIn(quarterlyBaseForCurrentCenter, selectedBillingPeriod);
  }, [billingData, currentPlanKey, quarterlyBaseForCurrentCenter, selectedBillingPeriod]);
  const paygResult = useMemo(() => calculatePaygCost(paygRates, paygSlider), [paygRates, paygSlider]);
  const fixedComparison = useMemo(() => getFixedPlanComparison(paygSlider), [paygSlider]);
  const fixedSavesMoney = !fixedComparison.isCustom && fixedComparison.planFee < paygResult.monthly;
  const savingsAmount = fixedSavesMoney ? paygResult.monthly - fixedComparison.planFee : 0;

  const instapayNumber = '01001963432';

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[var(--color-surface-0)]">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
          <div className="h-8 bg-muted rounded-xl w-48 mb-6 animate-pulse" />
          <div className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 bg-[var(--color-surface-1)] rounded-xl animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--color-surface-0)] animate-fade-in" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <PageHeader title={t('title')} />

        {/* Tabs */}
        <div className="flex gap-1 p-1 rounded-xl border border-[var(--color-border-subtle)] w-fit mb-6 bg-[var(--color-surface-1)]">
          <button
            onClick={() => setActiveTab('general')}
            className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${activeTab === 'general' ? 'bg-teal-600 text-white shadow-sm' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}
          >
            {t('general')}
          </button>
          <button
            onClick={() => setActiveTab('billing')}
            className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${activeTab === 'billing' ? 'bg-teal-600 text-white shadow-sm' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}
          >
            {t('billing')}
          </button>
          <button
            onClick={() => setActiveTab('team')}
            className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${activeTab === 'team' ? 'bg-teal-600 text-white shadow-sm' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}
          >
            {t('teamMembers')}
          </button>
        </div>

        {savedMessage && (
          <div className="mb-4 p-3 bg-green-100 border border-green-500/30 text-green-700 rounded-xl text-sm text-center">
            {savedMessage}
          </div>
        )}

        {/* GENERAL TAB */}
        {activeTab === 'general' && (
          <div className="space-y-4 overflow-y-auto max-h-[calc(100vh-200px)] pb-4">
            {/* 1. Center Information */}
            <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm mb-4">
              <div className="flex items-center gap-4 p-6 border-b border-[var(--color-border-subtle)]">
                <div className="p-2.5 bg-teal-100 rounded-xl flex-shrink-0">
                  <Building2 className="w-5 h-5 text-teal-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-[var(--color-text-primary)]">{t('centerInfo')}</h3>
                  <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">{t('centerName')} · {t('centerPhone')}</p>
                </div>
              </div>
              <div className="p-6">
                <div className="flex items-start gap-6 flex-wrap">
                  <div className="relative w-24 h-24 flex-shrink-0">
                    <div className="w-24 h-24 rounded-full bg-[var(--color-surface-2)] border-2 border-[var(--color-border-subtle)] overflow-hidden flex items-center justify-center">
                      {logoUrl ? (
                        <img
                          src={logoUrl}
                          alt="Center logo"
                          className="w-full h-full object-cover"
                          onError={() => setLogoUrl(null)}
                        />
                      ) : (
                        <Building2 className="w-10 h-10 text-slate-400" />
                      )}
                    </div>
                    <label className="absolute bottom-0 end-0 w-8 h-8 bg-teal-600 rounded-full flex items-center justify-center shadow-md hover:bg-teal-700 cursor-pointer transition-colors">
                      {logoUploading ? (
                        <Loader2 className="w-4 h-4 text-white animate-spin" />
                      ) : (
                        <Camera className="w-4 h-4 text-white" />
                      )}
                      <input
                        ref={logoInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={handleLogoUpload}
                        disabled={logoUploading}
                      />
                    </label>
                    {logoToast === 'success' && (
                      <div className="absolute -bottom-1 start-0 end-0 text-center">
                        <span className="inline-block px-2 py-0.5 bg-green-600 text-white text-xs rounded-full">
                          تم رفع الشعار بنجاح
                        </span>
                      </div>
                    )}
                    {logoToast === 'error' && (
                      <div className="absolute -bottom-1 start-0 end-0 text-center">
                        <span className="inline-block px-2 py-0.5 bg-red-600 text-white text-xs rounded-full">
                          فشل رفع الشعار، حاول مرة أخرى
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-[200px] space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">{t('centerName')}</label>
                      <input type="text" value={centerName} onChange={(e) => setCenterName(e.target.value)} className="w-full px-3 py-2 border border-[var(--color-border-subtle)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-[var(--color-surface-1)]" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">{t('centerPhone')}</label>
                      <input type="tel" value={centerPhone} onChange={(e) => setCenterPhone(e.target.value)} dir="ltr" placeholder="01xxxxxxxxx" className="w-full px-3 py-2 border border-[var(--color-border-subtle)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-[var(--color-surface-1)]" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">{t('district')}</label>
                      <select value={centerDistrict} onChange={(e) => setCenterDistrict(e.target.value)} className="w-full px-3 py-2 border border-[var(--color-border-subtle)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-[var(--color-surface-1)]">
                        <option value="">—</option>
                        <option value="nasr_city">مدينة نصر</option>
                        <option value="maadi">المعادي</option>
                        <option value="dokki">الدقي</option>
                        <option value="heliopolis">هليوبوليس</option>
                        <option value="new_cairo">القاهرة الجديدة</option>
                        <option value="6th_october">السادس من أكتوبر</option>
                        <option value="giza">الجيزة</option>
                        <option value="zamalek">الزمالك</option>
                        <option value="mohandiseen">المهندسين</option>
                        <option value="other">أخرى</option>
                      </select>
                      <p className="text-xs text-[var(--color-text-secondary)] mt-1">{t('districtHint')}</p>
                    </div>
                    <div className="flex justify-end">
                      <button type="button" onClick={() => { handleSaveCenterName(); handleSaveCenterPhone(); handleSaveCenterDistrict(); }} className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-lg transition-colors">{tCommon('save')}</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 2. Subject Management */}
            <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm mb-4">
              <div className="flex items-center gap-4 p-6 border-b border-[var(--color-border-subtle)]">
                <div className="p-2.5 bg-blue-100 rounded-xl flex-shrink-0">
                  <BookOpen className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-[var(--color-text-primary)]">{t('subjects')}</h3>
                  <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">{t('subjectName')}</p>
                </div>
              </div>
              <div className="p-6">
                <div className="flex flex-wrap gap-2 mb-4">
                  {subjects.map((subject) => (
                    editingSubject === subject.id ? (
                      <div key={subject.id} className="flex items-center gap-2">
                        <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} className="px-3 py-1.5 border border-[var(--color-border-subtle)] rounded-lg text-sm bg-[var(--color-surface-1)]" />
                        <button type="button" onClick={() => handleUpdateSubject(subject.id)} className="text-teal-600 text-sm font-medium hover:underline">{tCommon('save')}</button>
                        <button type="button" onClick={() => setEditingSubject(null)} className="text-[var(--color-text-secondary)] text-sm hover:underline">{tCommon('cancel')}</button>
                      </div>
                    ) : (
                      <span key={subject.id} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[var(--color-surface-2)] text-[var(--color-text-primary)] rounded-full text-sm font-medium">
                        {subject.name}
                        <button type="button" onClick={() => { setEditingSubject(subject.id); setEditName(subject.name); }} className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">{tCommon('edit')}</button>
                        <button type="button" onClick={() => handleDeleteSubject(subject.id)} className="hover:text-red-500 transition-colors"><X className="w-3.5 h-3.5" /></button>
                      </span>
                    )
                  ))}
                </div>
                <form onSubmit={handleAddSubject} className="flex gap-2">
                  <input type="text" value={newSubjectName} onChange={(e) => setNewSubjectName(e.target.value)} placeholder={t('subjectName')} className="flex-1 px-3 py-2 border border-[var(--color-border-subtle)] rounded-lg text-sm bg-[var(--color-surface-1)] focus:outline-none focus:ring-2 focus:ring-teal-500" required />
                  <button type="submit" className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-lg transition-colors">{t('addSubject')}</button>
                </form>
              </div>
            </div>

            {/* 3. Team Members */}
            <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm mb-4">
              <div className="flex items-center gap-4 p-6 border-b border-[var(--color-border-subtle)]">
                <div className="p-2.5 bg-purple-100 rounded-xl flex-shrink-0">
                  <Users className="w-5 h-5 text-purple-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-[var(--color-text-primary)]">{t('teamMembers')}</h3>
                  <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">{t('manageTeamDesc')}</p>
                </div>
              </div>
              <div className="p-6">
                <button type="button" onClick={() => setActiveTab('team')} className="flex items-center gap-2 px-4 py-2 border border-slate-300 hover:bg-[var(--color-surface-0)] text-[var(--color-text-primary)] text-sm font-semibold rounded-lg transition-colors w-fit">
                  <Users className="w-4 h-4" /> {t('manageTeam')} <ChevronRight className="w-4 h-4 ms-1" />
                </button>
              </div>
            </div>

            {/* 4. Scanner Settings */}
            <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm mb-4">
              <div className="flex items-center gap-4 p-6 border-b border-[var(--color-border-subtle)]">
                <div className="p-2.5 bg-amber-100 rounded-xl flex-shrink-0">
                  <QrCode className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-[var(--color-text-primary)]">{t('scanner')}</h3>
                  <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">{t('defaultMode')}</p>
                </div>
              </div>
              <div className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-[var(--color-text-primary)]">{t('defaultMode')}</p>
                    <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">{t('defaultMode')}</p>
                  </div>
                  <div className="flex gap-1 bg-[var(--color-surface-2)] p-1 rounded-lg">
                    <button type="button" onClick={() => handleScannerMode('camera')} className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${scannerMode === 'camera' ? 'bg-[var(--color-surface-1)] shadow-sm text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}>{t('camera')}</button>
                    <button type="button" onClick={() => handleScannerMode('bluetooth')} className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${scannerMode === 'bluetooth' ? 'bg-[var(--color-surface-1)] shadow-sm text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}>{t('bluetooth')}</button>
                  </div>
                </div>
              </div>
            </div>

            {/* 4b. Daily WhatsApp Summary */}
            <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm mb-4">
              <div className="flex items-center gap-4 p-6 border-b border-[var(--color-border-subtle)]">
                <div className="p-2.5 bg-teal-100 rounded-xl flex-shrink-0">
                  <MessageCircle className="w-5 h-5 text-teal-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-[var(--color-text-primary)]">{t('dailySummary')}</h3>
                  <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">{t('dailySummaryDesc')}</p>
                </div>
              </div>
              <div className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-[var(--color-text-primary)]">{t('dailySummaryToggle')}</p>
                    <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">{t('dailySummaryDesc')}</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={dailySummaryEnabled}
                    onClick={() => handleDailySummaryToggle(!dailySummaryEnabled)}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 ${dailySummaryEnabled ? 'bg-teal-600' : 'bg-slate-200'}`}
                  >
                    <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-[var(--color-surface-1)] shadow ring-0 transition-transform ${dailySummaryEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
                  </button>
                </div>
              </div>
            </div>

            {/* 4c. Summer mode */}
            <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm mb-4">
              <div className="flex items-center gap-4 p-6 border-b border-[var(--color-border-subtle)]">
                <div className="p-2.5 bg-amber-100 rounded-xl flex-shrink-0">
                  <Calendar className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-[var(--color-text-primary)]">{t('summerMode')}</h3>
                  <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">{t('summerModeDesc')}</p>
                </div>
              </div>
              <div className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-[var(--color-text-primary)]">{t('summerModeToggle')}</p>
                    <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">{t('summerModeDesc')}</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={summerModeEnabled}
                    onClick={() => handleSummerModeToggle(!summerModeEnabled)}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 ${summerModeEnabled ? 'bg-teal-600' : 'bg-slate-200'}`}
                  >
                    <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-[var(--color-surface-1)] shadow ring-0 transition-transform ${summerModeEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
                  </button>
                </div>
              </div>
            </div>

            {/* 5. Referral Program */}
            <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm mb-4">
              <div className="flex items-center gap-4 p-6 border-b border-[var(--color-border-subtle)]">
                <div className="p-2.5 bg-green-100 rounded-xl flex-shrink-0">
                  <Gift className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-[var(--color-text-primary)]">{tReferral('title')}</h3>
                  <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">{tReferral('shareText')}</p>
                </div>
              </div>
              <div className="p-6">
              {referralData && (
                <>
                  <div className="flex items-center gap-3 p-4 bg-[var(--color-surface-0)] rounded-xl border border-[var(--color-border-subtle)] mb-4">
                    <div className="flex-1">
                      <p className="text-xs text-[var(--color-text-secondary)] mb-1">{tReferral('yourCode')}</p>
                      <p className="text-xl font-bold text-[var(--color-text-primary)] font-mono tracking-widest">{referralData.referralCode || '—'}</p>
                    </div>
                    <button type="button" onClick={async () => { if (referralData.referralCode) { await navigator.clipboard.writeText(referralData.referralCode); setReferralCopied(true); setTimeout(() => setReferralCopied(false), 2000); } }} className="flex items-center gap-2 px-4 py-2 border border-slate-300 hover:bg-[var(--color-surface-1)] text-[var(--color-text-primary)] text-sm font-semibold rounded-lg transition-colors">
                      <Copy className="w-4 h-4" /> {referralCopied ? tReferral('copied') : tReferral('copyCode')}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => router.push(`/${locale}/settings/referrals`)}
                    className="flex items-center gap-2 px-4 py-2 border border-teal-600 text-teal-600 rounded-lg text-sm hover:bg-teal-50 transition-colors"
                  >
                    {t('manageReferrals')}
                  </button>
                  <p className="text-sm text-[var(--color-text-secondary)] mb-2">{tReferral('referralRateDescription')}</p>
                  <p className="text-xs text-[var(--color-text-secondary)] mb-2">Total Referrals: {(referralData.rewards?.length ?? 0)} | Earned: EGP {Number(referralData.totalEarned || 0).toLocaleString('ar-EG')}</p>
                  <div>
                    <p className="text-sm font-medium text-[var(--color-text-primary)] mb-2">{tReferral('rewardsTable')}</p>
                    {(referralData.rewards?.length ?? 0) > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border">
                              <th className="text-start py-2 text-xs font-medium text-[var(--color-text-secondary)]">{tReferral('referredCenter')}</th>
                              <th className="text-start py-2 text-xs font-medium text-[var(--color-text-secondary)]">{tReferral('plan')}</th>
                              <th className="text-start py-2 text-xs font-medium text-[var(--color-text-secondary)]">{tReferral('rewardAmount')}</th>
                              <th className="text-start py-2 text-xs font-medium text-[var(--color-text-secondary)]">{tReferral('status')}</th>
                              <th className="text-start py-2 text-xs font-medium text-[var(--color-text-secondary)]">{tReferral('date')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(referralData.rewards ?? []).map((r) => (
                              <tr key={r.id || r.created_at + r.referred_center_name} className="border-b border-border">
                                <td className="py-2 text-[var(--color-text-primary)]">{r.referred_center_name}</td>
                                <td className="py-2 text-[var(--color-text-secondary)]">{r.referred_center_plan}</td>
                                <td className="py-2 font-mono text-[var(--color-text-primary)]">{Number(r.reward_amount).toLocaleString('ar-EG')} EGP</td>
                                <td className="py-2"><span className={`px-2 py-0.5 text-xs font-medium rounded-full ${r.reward_status === 'paid' ? 'badge-confirmed' : r.reward_status === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-muted text-[var(--color-text-secondary)]'}`}>{r.reward_status}</span></td>
                                <td className="py-2 text-[var(--color-text-secondary)]">{new Date(r.created_at).toLocaleDateString('ar-EG')}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-sm text-[var(--color-text-secondary)] py-4">{tReferral('noRewards')}</p>
                    )}
                  </div>
                </>
              )}
              {!referralData && <p className="text-sm text-[var(--color-text-secondary)]">{tCommon('loading')}</p>}
              </div>
            </div>

            {/* 6. Billing & Subscriptions */}
            <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm mb-4">
              <div className="flex items-center gap-4 p-6 border-b border-[var(--color-border-subtle)]">
                <div className="p-2.5 bg-indigo-100 rounded-xl flex-shrink-0">
                  <CreditCard className="w-5 h-5 text-indigo-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-[var(--color-text-primary)]">{t('billing')}</h3>
                  <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">{t('billingDesc')}</p>
                </div>
              </div>
              <div className="p-6">
                <button type="button" onClick={() => setActiveTab('billing')} className="flex items-center gap-2 px-4 py-2 border border-slate-300 hover:bg-[var(--color-surface-0)] text-[var(--color-text-primary)] text-sm font-semibold rounded-lg transition-colors w-fit">
                  <CreditCard className="w-4 h-4" /> {t('billingLink')} <ChevronRight className="w-4 h-4 ms-1" />
                </button>
              </div>
            </div>

            {/* 7. WhatsApp Support */}
            <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm mb-4">
              <div className="flex items-center gap-4 p-6 border-b border-[var(--color-border-subtle)]">
                <div className="p-2.5 bg-green-100 rounded-xl flex-shrink-0">
                  <MessageCircle className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-[var(--color-text-primary)]">{tBilling('whatsappSupport')}</h3>
                  <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">{tBilling('contactSupportViaWhatsapp')}</p>
                </div>
              </div>
              <div className="p-6">
                <p className="text-sm text-[var(--color-text-secondary)] mb-3" dir="ltr">Contact support: support@centerhq.com | WhatsApp: +20 122 060 1410</p>
                <a href={`https://wa.me/${ADMIN_NOTIFICATION_PHONE}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg transition-colors">
                  <MessageCircle className="w-4 h-4" /> Chat on WhatsApp
                </a>
              </div>
            </div>

            {/* 8. Account */}
            <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm mb-4">
              <div className="flex items-center gap-4 p-6 border-b border-[var(--color-border-subtle)]">
                <div className="p-2.5 bg-red-100 rounded-xl flex-shrink-0">
                  <Shield className="w-5 h-5 text-red-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-[var(--color-text-primary)]">{t('account')}</h3>
                  <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">{tBilling('securityAndSignOut')}</p>
                </div>
              </div>
              <div className="p-6">
                <div className="flex items-center gap-3">
                  <Link href="/settings/reset-password" className="flex items-center gap-2 px-4 py-2 border border-slate-300 hover:bg-[var(--color-surface-0)] text-[var(--color-text-primary)] text-sm font-semibold rounded-lg transition-colors">
                    <KeyRound className="w-4 h-4" /> {t('resetPassword')}
                  </Link>
                  <button type="button" onClick={handleLogout} className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg transition-colors">
                    <LogOut className="w-4 h-4" /> {t('logout')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* BILLING TAB */}
        {activeTab === 'billing' && (
          <div className="space-y-6 overflow-y-auto max-h-[calc(100vh-200px)] pb-4">
            {billingLoading ? (
              <div className="flex justify-center py-16"><div className="animate-spin h-8 w-8 border-2 border-teal-500 border-t-transparent rounded-full" /></div>
            ) : (
              <>
                {/* 1. Current Plan hero */}
                <div className="bg-gradient-to-br from-teal-600 to-slate-800 rounded-2xl p-6 text-white mb-6 shadow-lg">
                  <p className="text-teal-200 text-sm font-medium uppercase tracking-wider mb-3">{tBilling('currentPlan')}</p>
                  <div className="flex flex-wrap gap-2 mb-4">
                    {(['monthly', 'quarterly', 'annual'] as const).map((period) => (
                      <button
                        key={period}
                        type="button"
                        onClick={() => setSelectedBillingPeriod(period)}
                        className={`relative rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                          selectedBillingPeriod === period
                            ? 'bg-[var(--color-surface-1)] text-teal-800'
                            : 'bg-[var(--color-surface-1)]/15 text-teal-100 hover:bg-[var(--color-surface-1)]/25'
                        }`}
                      >
                        {tBilling(`period.${period}`)}
                        {period === 'quarterly' && (
                          <span className="absolute -top-2 start-2 bg-amber-400/90 text-teal-900 text-[10px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap">
                            {tBilling('period.recommended')}
                          </span>
                        )}
                        {period === 'monthly' && (
                          <span className="absolute -top-2 end-0 bg-[var(--color-surface-1)]/30 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap">
                            {tBilling('period.monthlyPremium')}
                          </span>
                        )}
                        {period === 'annual' && (
                          <span className="absolute -top-2 end-0 bg-amber-400/90 text-teal-900 text-[10px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap">
                            {tBilling('period.twoMonthsFree')}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                    <div>
                      <p className="text-4xl font-bold mt-1">
                        {currentPlanDetails?.is_custom
                          ? (tBilling(`planNames.${currentPlanKey}`) || currentPlanDetails?.name_ar || currentPlanDetails?.name_en)
                          : (tBilling(`planNames.${currentPlanKey}`) || (PLAN_DISPLAY_NAMES[billingData?.plan ?? 'starter'] ?? currentPlanDetails?.name_en))}
                      </p>
                      {currentPlanKey !== 'top_centers' && getPerStudentWeeklyCost(currentPlanKey) != null && (
                        <p className="text-teal-100 text-sm mt-2">
                          {tBilling('perStudentWeekly', { price: formatPrice(getPerStudentWeeklyCost(currentPlanKey)!) })}
                        </p>
                      )}
                      <p className="text-teal-200 text-sm mt-2">
                        {currentPlanDetails?.is_custom
                          ? tBilling('unlimitedStudents')
                          : tBilling('studentsLimit', { limit: formatPrice(currentPlanDetails?.students_per_week_limit ?? 0) })}
                      </p>
                    </div>
                    <div className="text-start sm:text-end">
                      {!currentPlanDetails?.is_custom && currentPlanKey !== 'top_centers' ? (
                        <>
                          <p className="text-3xl font-bold font-mono">
                            {formatPrice(currentDisplayPrice)} {tBilling('egp')}
                          </p>
                          {selectedBillingPeriod === 'annual' && (
                            <p className="text-teal-200 text-sm mt-1">
                              {tBilling('monthlyEquivShort', { amount: formatPrice(Math.round(quarterlyBaseForCurrentCenter * 0.85)) })}
                            </p>
                          )}
                          <p className="text-teal-300 text-xs mt-2 max-w-xs sm:ms-auto">{tBilling('priceLabel')}</p>
                          <p className="text-teal-100 text-sm font-mono mt-1">
                            {tBilling('quarterlyChargeLine', { amount: formatPrice(currentCycleCharge) })}
                          </p>
                        </>
                      ) : (
                        <p className="text-2xl font-bold">{tBilling('custom')}</p>
                      )}
                    </div>
                  </div>
                  <div className="mt-4 pt-4 border-t border-teal-500/40 flex items-center justify-between flex-wrap gap-2">
                    <p className="text-teal-200 text-sm">
                      {tBilling('nextBilling')}: <span className="text-white font-semibold">—</span>
                    </p>
                    <div className="flex items-center gap-2">
                      {FEATURES.PAYMOB_ENABLED && (
                        <button
                          type="button"
                          onClick={handlePayNow}
                          disabled={payNowLoading}
                          className="px-4 py-2 bg-[var(--color-surface-1)]/20 hover:bg-[var(--color-surface-1)]/30 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50"
                        >
                          {payNowLoading ? tCommon('loading') : tBilling('payNow')}
                        </button>
                      )}
                      <span className="px-3 py-1 bg-green-500/20 text-green-300 text-xs font-semibold rounded-full border border-green-500/30">{tBilling('active')}</span>
                    </div>
                  </div>
                </div>

                {/* 2. Fixed Plans grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                  {plans.map((plan) => {
                    const isCurrent = billingData?.plan === plan.id && billingData?.pricing_type === 'fixed';
                    const setupFee = plan.setup_fee_egp ?? SETUP_FEE_BY_PLAN[plan.id] ?? 0;
                    const pkCard = isPlanKey(plan.id) ? (plan.id as PlanKey) : 'starter';
                    const perStudentWeek = plan.is_custom ? null : getPerStudentWeeklyCost(pkCard);
                    const planName = tBilling(`planNames.${plan.id}`) || PLAN_DISPLAY_NAMES[plan.id] || plan.name_en || plan.name_ar;
                    const cardPrice = !plan.is_custom && isPlanKey(plan.id) ? getPlanPrice(plan.id as PlanKey, selectedBillingPeriod) : 0;
                    const goldBorder = plan.id === 'enterprise' || plan.is_custom;
                    const proRecommended = plan.id === 'pro';
                    return (
                      <div
                        key={plan.id}
                        className={[
                          'bg-[var(--color-surface-1)] rounded-xl border shadow-sm p-5 relative',
                          isCurrent ? 'border-2 border-teal-500 ring-2 ring-teal-500/20' : 'border-[var(--color-border-subtle)]',
                          !isCurrent && goldBorder ? 'border-[var(--color-gold-500)] ring-1 ring-[var(--color-gold-500)]' : '',
                        ].join(' ')}
                      >
                        {proRecommended && (
                          <span className="absolute -top-3 start-1/2 -translate-x-1/2 badge badge-brand text-xs whitespace-nowrap px-3 py-1">
                            {tBilling('period.recommended')}
                          </span>
                        )}
                        {isCurrent && (
                          <div className={`absolute ${proRecommended ? '-top-8' : '-top-3'} start-1/2 -translate-x-1/2`}>
                            <span className="px-3 py-1 bg-teal-600 text-white text-xs font-semibold rounded-full shadow">{tBilling('currentPlan')}</span>
                          </div>
                        )}
                        <h3 className="font-bold text-[var(--color-text-primary)] text-lg mt-2">{planName}</h3>
                        <ul className="text-sm text-[var(--color-text-secondary)] mt-1 space-y-0.5" dir={isRTL ? 'rtl' : 'ltr'}>
                          <li>
                            •{' '}
                            {plan.is_custom
                              ? tBilling('unlimitedStudents')
                              : tBilling('studentsLimit', { limit: formatPrice(plan.students_per_week_limit ?? 0) })}
                          </li>
                          {perStudentWeek != null && (
                            <li>• {tBilling('perStudentWeekly', { price: formatPrice(perStudentWeek) })}</li>
                          )}
                          {plan.is_custom && <li>• {tBilling('customPricingNote')}</li>}
                        </ul>
                        <p className="text-xs text-[var(--color-text-tertiary)] mt-2">{tBilling('priceLabel')}</p>
                        <div className="my-4">
                          <span className="text-3xl font-bold text-[var(--color-text-primary)] font-mono">
                            {plan.is_custom ? tBilling('custom') : formatPrice(cardPrice)}
                          </span>
                          {!plan.is_custom && (
                            <span className="text-base font-normal text-[var(--color-text-tertiary)] ms-1">
                              {selectedBillingPeriod === 'monthly'
                                ? `(${tBilling('period.monthly')})`
                                : selectedBillingPeriod === 'annual'
                                  ? `(${tBilling('annualTotalShort')})`
                                  : `(${tBilling('period.quarterly')})`}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[var(--color-text-tertiary)] mb-4">
                          {tBilling('setup')}: {tBilling('egp')}{' '}
                          {plan.is_custom ? '—' : formatPrice(setupFee)}
                        </p>
                        <button
                          type="button"
                          onClick={() => !isCurrent && (setChangePlanSelect(plan.id), setShowPlanRequestModal(true))}
                          className={
                            isCurrent
                              ? 'w-full py-2 rounded-lg text-sm font-semibold bg-[var(--color-surface-2)] text-teal-700 border border-[var(--color-border-subtle)] cursor-default'
                              : 'w-full py-2 rounded-lg text-sm font-semibold border border-[var(--color-border-subtle)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-0)] transition-colors'
                          }
                          disabled={isCurrent}
                        >
                          {isCurrent
                            ? tBilling('currentPlan')
                            : getPlanLevel(plan.id) > getPlanLevel(billingData?.plan)
                              ? tBilling('requestUpgrade')
                              : tBilling('requestDowngrade')}
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* 3. PAYG Calculator */}
                <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm p-6 mb-6">
                  <h3 className="font-semibold text-[var(--color-text-primary)] mb-1">{tBilling('paygTitle')}</h3>
                  <p className="text-sm text-[var(--color-text-secondary)] mb-4">{tBilling('paygSubtitle')}</p>
                  <div className="space-y-4">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-sm font-medium text-[var(--color-text-primary)]">{tBilling('studentsPerWeekSlider', { defaultValue: 'Students per week' })}</label>
                        <span className="text-lg font-bold text-teal-600 font-mono">{paygSlider}</span>
                      </div>
                      <input type="range" min={1} max={2000} value={paygSlider} onChange={(e) => setPaygSlider(Number(e.target.value))} className="w-full accent-teal-600" />
                    </div>
                    <div className="p-4 bg-teal-50 rounded-xl border border-teal-200">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs text-teal-600 font-medium">{tBilling('weeklyCost')}</p>
                          <p className="text-2xl font-bold text-teal-800 font-mono">{paygResult.weekly.toLocaleString('en-US')} {tBilling('egp')}</p>
                        </div>
                        <div className="text-end">
                          <p className="text-xs text-teal-600 font-medium">{tBilling('monthlyEst')}</p>
                          <p className="text-2xl font-bold text-teal-800 font-mono">{paygResult.monthly.toLocaleString('en-US')} {tBilling('egp')}</p>
                        </div>
                      </div>
                      <p className="text-xs text-teal-600 mt-2">Rate: {tBilling('egp')} {paygResult.effectiveRate}{tBilling('perStudentWeek', { defaultValue: '/student/week' })}</p>
                    </div>
                  </div>
                </div>

                {/* 4. Want to change your plan? */}
                {currentUser?.role === 'owner' && (
                  <section className="ch-card">
                    <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-4">{tBilling('changeQuestion')}</h2>
                    <div className="flex flex-wrap items-center gap-3">
                      <button onClick={() => setShowPlanRequestModal(true)} className="px-4 py-2.5 text-white text-sm font-semibold rounded-lg" style={{ background: 'hsl(var(--primary))' }}>{tBilling('requestPlanChange')}</button>
                      <a href={`https://wa.me/201001963432?text=${encodeURIComponent(`مرحباً، أريد تغيير خطة سنتر ${billingData?.center_name || ''}`)}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80 text-sm font-medium">{tBilling('requestViaWhatsapp')}</a>
                    </div>
                  </section>
                )}

                {/* 4. Invoice History */}
                <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm overflow-hidden mb-6">
                  <div className="p-6 border-b border-[var(--color-border-subtle)]">
                    <h3 className="font-semibold text-[var(--color-text-primary)]">{tBilling('invoiceHistory')}</h3>
                  </div>
                  {(billingData?.invoices?.length ?? 0) > 0 ? (
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-0)]">
                          <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">Date</th>
                          <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">Reference</th>
                          <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">Amount</th>
                          <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">Period</th>
                          <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {billingData?.invoices?.map((inv) => {
                          const status = inv.status?.toLowerCase?.() ?? '';
                          const statusClass = status === 'paid' || status === 'approved' ? 'bg-green-100 text-green-700' : status === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700';
                          return (
                            <tr key={inv.id || inv.invoice_number || String(inv.created_at)}>
                              <td className="py-3 px-4 text-sm text-[var(--color-text-primary)]">{inv.created_at ? new Date(inv.created_at).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-GB') : inv.period_start && inv.period_end ? `${inv.period_start} – ${inv.period_end}` : '—'}</td>
                              <td className="py-3 px-4 text-sm text-[var(--color-text-primary)] font-mono">{inv.payment_reference || inv.invoice_number || '—'}</td>
                              <td className="py-3 px-4 text-sm font-mono text-[var(--color-text-primary)]">{Number(inv.payment_amount ?? inv.total_amount ?? 0).toLocaleString('en-US')} {tBilling('egp')}</td>
                              <td className="py-3 px-4 text-sm text-[var(--color-text-secondary)]">{inv.period_start && inv.period_end ? `${inv.period_start} – ${inv.period_end}` : '—'}</td>
                              <td className="py-3 px-4"><span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${statusClass}`}>{inv.status}</span></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : <p className="p-8 text-center text-[var(--color-text-secondary)]">{tBilling('noInvoices')}</p>}
                </div>

                {/* Plan Change Requests */}
                <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm overflow-hidden mb-6">
                  <div className="p-6 border-b border-[var(--color-border-subtle)]">
                    <h3 className="font-semibold text-[var(--color-text-primary)]">Plan Change Requests</h3>
                    <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">History of your plan upgrade/downgrade requests</p>
                  </div>
                  {planRequests.length === 0 ? (
                    <div className="text-center py-10">
                      <FileText className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                      <p className="text-[var(--color-text-secondary)] text-sm">No plan change requests yet</p>
                    </div>
                  ) : (
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-0)]">
                          <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">Date</th>
                          <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">From</th>
                          <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">To</th>
                          <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {planRequests.map(req => (
                          <tr key={req.id} className="hover:bg-[var(--color-surface-0)] transition-colors">
                            <td className="py-3.5 px-4 text-sm text-[var(--color-text-secondary)]">
                              {new Date(req.requested_at || 0).toLocaleDateString()}
                            </td>
                            <td className="py-3.5 px-4">
                              <PlanBadge plan={req.current_plan} />
                            </td>
                            <td className="py-3.5 px-4">
                              <PlanBadge plan={req.requested_plan} />
                            </td>
                            <td className="py-3.5 px-4">
                              <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${req.status === 'approved' ? 'bg-green-100 text-green-700' : req.status === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                                {req.status === 'approved' ? '✓ Approved' :
                                 req.status === 'rejected' ? '✗ Rejected' : '⏳ Pending'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* 5. Submit Payment Proof */}
                <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm p-6">
                  <h3 className="font-semibold text-[var(--color-text-primary)] mb-1">{tBilling('submitProofTitle')}</h3>
                  <p className="text-sm text-[var(--color-text-secondary)] mb-4">{tBilling('uploadProof')}</p>
                  <div className="flex items-center gap-3 p-4 bg-blue-50 rounded-xl border border-blue-200 mb-4">
                    <div className="p-2 bg-blue-100 rounded-lg"><CreditCard className="w-5 h-5 text-blue-600" /></div>
                    <div className="flex-1">
                      <p className="text-xs text-blue-600 font-medium">{tBilling('instaPayNumber')}</p>
                      <p className="text-lg font-bold text-blue-800 font-mono">{instapayNumber}</p>
                    </div>
                    <button type="button" onClick={() => { navigator.clipboard.writeText(instapayNumber); setSavedMessage(tCommon('copy')); setTimeout(() => setSavedMessage(''), 2000); }} className="p-2 hover:bg-blue-100 rounded-lg transition-colors text-blue-600"><Copy className="w-4 h-4" /></button>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">{tBilling('transferAmountLabel')}</label>
                      <input type="number" min="0" step="0.01" value={proofAmount} onChange={(e) => setProofAmount(e.target.value)} placeholder={tBilling('transferAmountPlaceholder')} className="w-full px-3 py-2 border border-[var(--color-border-subtle)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-[var(--color-surface-1)]" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">{tBilling('instapayRefLabel')}</label>
                      <input type="text" value={proofReference} onChange={(e) => setProofReference(e.target.value)} placeholder={tBilling('instapayRef')} className="w-full px-3 py-2 border border-[var(--color-border-subtle)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-[var(--color-surface-1)]" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">{tBilling('proofLabel')}</label>
                      <div className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center hover:border-teal-400 transition-colors cursor-pointer" onClick={() => document.getElementById('proof-file-input')?.click()}>
                        <input id="proof-file-input" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={handleFileChange} className="hidden" />
                        {proofPreview ? <img src={proofPreview} alt="Preview" className="mx-auto mb-2 max-h-24 rounded-lg" /> : <Upload className="w-8 h-8 text-slate-400 mx-auto mb-2" />}
                        <p className="text-sm font-medium text-[var(--color-text-secondary)]">{proofFile ? proofFile.name : 'Drop screenshot here or click to upload'}</p>
                        <p className="text-xs text-slate-400 mt-1">PNG, JPG up to 5MB</p>
                      </div>
                    </div>
                    <button type="button" onClick={handleSubmitPaymentProof} disabled={billingSaving || proofUploading || !proofAmount || parseFloat(proofAmount) <= 0 || !proofReference.trim()} className="w-full py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded-lg transition-colors disabled:opacity-50">{proofUploading ? tCommon('loading') : tBilling('submitPaymentProof')}</button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* TEAM TAB */}
        {activeTab === 'team' && (
          <div className="space-y-4 overflow-y-auto max-h-[calc(100vh-200px)] pb-4">
            {(currentUser?.role === 'assistant' || currentUser?.role === 'teacher') ? (
              <p className="text-[var(--color-text-secondary)]">{tBilling('onlyOwnersCanManageTeam')}</p>
            ) : (
              <>
                <div className="flex items-center justify-between flex-wrap gap-2 mb-6">
                  <div>
                    <h2 className="text-2xl font-bold text-[var(--color-text-primary)]">{t('teamMembers')}</h2>
                    {limits && <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">{t('teamMembersCount', { current: teamMembers.length, max: limits.maxTeachers })}</p>}
                  </div>
                  <button onClick={() => { setInviteRole('assistant'); setInviteTeacherGroupIds([]); setInvitePerms({ can_scan: true, can_view_payments: true, can_view_dashboard: true, can_manage_students: false, can_manage_groups: false, can_view_settings: false }); setShowInviteModal(true); }} disabled={limits ? !limits.canAddTeacher : false} className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors"><UserPlus className="w-4 h-4" /> {t('inviteMemberPlus')}</button>
                </div>

                {lastInvitePassword && <div className="p-4 bg-green-100 rounded-xl border border-green-500/30 text-sm text-green-700 mb-4"><p className="font-medium">{t('inviteSuccess')}</p><p className="mt-1">{t('passwordIs', { password: lastInvitePassword })}</p></div>}

                <div className="bg-[var(--color-surface-1)] rounded-xl overflow-hidden border border-[var(--color-border-subtle)] shadow-sm">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-0)]">
                          <th className="px-4 py-3 text-start text-xs font-semibold text-[var(--color-text-secondary)] uppercase">{t('inviteName')}</th>
                          <th className="px-4 py-3 text-start text-xs font-semibold text-[var(--color-text-secondary)] uppercase">{t('invitePhone')}</th>
                          <th className="px-4 py-3 text-start text-xs font-semibold text-[var(--color-text-secondary)] uppercase">{t('role')}</th>
                          <th className="px-4 py-3 text-start text-xs font-semibold text-[var(--color-text-secondary)] uppercase">{t('permissions')}</th>
                          <th className="px-4 py-3 text-start text-xs font-semibold text-[var(--color-text-secondary)] uppercase">{t('status')}</th>
                          <th className="px-4 py-3 text-start text-xs font-semibold text-[var(--color-text-secondary)] uppercase">{tCommon('actions')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {teamMembers.map((member) => {
                          const isSelf = member.id === userId;
                          const isPermReadOnly = isOwner(member) || isSelf;
                          const permChecked = (k: string) => isOwner(member) ? true : (assistantPermissions[member.id]?.[k] ?? false);
                          const PERM_CHIPS = [
                            { key: 'can_scan', emoji: '📷', title: 'Scanner' },
                            { key: 'can_view_payments', emoji: '💳', title: 'Payments' },
                            { key: 'can_view_dashboard', emoji: '📊', title: 'Dashboard' },
                            { key: 'can_manage_students', emoji: '👥', title: 'Students' },
                            { key: 'can_manage_groups', emoji: '📚', title: 'Groups' },
                            { key: 'can_view_settings', emoji: '⚙️', title: 'Settings' },
                          ];
                          return (
                            <tr key={member.id} className={member.is_active === false ? 'opacity-60' : ''}>
                              <td className="px-4 py-3 font-medium text-[var(--color-text-primary)]">{member.name || '—'}{isSelf && <span className="text-xs text-[var(--color-text-secondary)] ms-1">({t('you')})</span>}</td>
                              <td className="px-4 py-3 text-[var(--color-text-secondary)] font-mono" dir="ltr">{member.phone}</td>
                              <td className="px-4 py-3"><RoleBadge role={member.role} /></td>
                              <td className="px-4 py-3">
                                {editingPermissionsId === member.id ? (
                                  <div className="space-y-2">
                                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                                      {PERMISSION_KEYS.map(({ key, labelKey }) => (
                                        <label key={key} className={`flex items-center gap-1.5 text-xs select-none ${isPermReadOnly ? 'cursor-default opacity-75' : 'cursor-pointer text-[var(--color-text-primary)]'}`}>
                                          <input type="checkbox" checked={permChecked(key)} onChange={(e) => !isPermReadOnly && handlePermissionToggle(member.id, key, e.target.checked)} disabled={isPermReadOnly} className="w-3.5 h-3.5 rounded accent-teal-600" />
                                          {t(labelKey)}
                                        </label>
                                      ))}
                                    </div>
                                    <button type="button" onClick={() => setEditingPermissionsId(null)} className="text-xs text-teal-600 hover:underline">{tCommon('cancel')}</button>
                                  </div>
                                ) : (
                                  <div className="flex flex-wrap gap-1">
                                    {PERM_CHIPS.map(({ key, emoji, title }) => (
                                      <span key={key} className={`px-1.5 py-0.5 rounded text-xs font-medium ${permChecked(key) ? 'bg-green-100 text-green-700' : 'bg-[var(--color-surface-2)] text-slate-400'}`} title={title}>{emoji}</span>
                                    ))}
                                    {canEditPermissions(member) && <button type="button" onClick={() => setEditingPermissionsId(member.id)} className="text-teal-600 hover:underline text-xs ms-1">{t('editPermissions')}</button>}
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${member.is_active !== false ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                  {member.is_active !== false ? t('activeStatus') : t('deactivatedStatus')}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                {!isSelf && !isOwner(member) && (
                                  <div className="flex items-center gap-1">
                                    <button type="button" onClick={() => setEditingPermissionsId(member.id)} className="p-1.5 hover:bg-[var(--color-surface-2)] rounded-lg transition-colors text-[var(--color-text-secondary)]" title={t('editPermissions')}><Pencil className="w-4 h-4" /></button>
                                    <button type="button" onClick={() => handleToggleActive(member)} className="p-1.5 hover:bg-red-50 rounded-lg transition-colors text-[var(--color-text-secondary)] hover:text-red-600" title={member.is_active !== false ? t('deactivate') : t('activate')}><UserX className="w-4 h-4" /></button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                        {pendingInvites.map((inv, idx) => (
                          <tr key={`pending-${idx}`} className="border-b border-[var(--color-border-subtle)]">
                            <td className="px-4 py-3 text-[var(--color-text-secondary)]">—</td>
                            <td className="px-4 py-3 font-mono text-[var(--color-text-secondary)]" dir="ltr">{inv.phone}</td>
                            <td className="px-4 py-3"><RoleBadge role={inv.role} /></td>
                            <td className="px-4 py-3">—</td>
                            <td className="px-4 py-3"><span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">{t('pendingInvite')}</span></td>
                            <td className="px-4 py-3">—</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {teamMembers.length === 0 && pendingInvites.length === 0 && <p className="p-8 text-center text-[var(--color-text-secondary)]">{t('noTeamMembers')}</p>}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Plan Request Modal */}
        {showPlanRequestModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowPlanRequestModal(false)}>
            <div className="bg-[var(--color-surface-1)] rounded-2xl shadow-xl max-w-md w-full p-6 border border-border" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">{tBilling('requestPlanChange')}</h3>
              <p className="text-sm text-[var(--color-text-secondary)] mb-4">{tBilling('selectPlan')}</p>
              <div className="space-y-2 mb-6">
                {plans.filter(p => p.id !== 'top_centers').map(p => (
                  <button key={p.id} type="button" onClick={() => setChangePlanSelect(p.id)} className={`w-full px-4 py-2.5 text-left rounded-xl border ${changePlanSelect === p.id ? 'border-primary bg-primary/20 text-[var(--color-text-primary)]' : 'border-border bg-[var(--color-surface-1)] text-[var(--color-text-primary)] hover:bg-muted'}`}>{PLAN_DISPLAY_NAMES[p.id] ?? p.name_en} — {p.monthly_fee > 0 && isPlanKey(p.id) ? `${formatPrice(getPlanPrice(p.id as PlanKey, selectedBillingPeriod))} ${tBilling('egp')} (${tBilling(`period.${selectedBillingPeriod}`)})` : tBilling('custom')}</button>
                ))}
                <button type="button" onClick={() => setChangePlanSelect('payg')} className={`w-full px-4 py-2.5 text-left rounded-xl border ${changePlanSelect === 'payg' ? 'border-primary bg-primary/20 text-[var(--color-text-primary)]' : 'border-border bg-[var(--color-surface-1)] text-[var(--color-text-primary)] hover:bg-muted'}`}>Pay-As-You-Go</button>
              </div>
              <div className="flex gap-2">
                <button onClick={handleRequestPlanChange} disabled={billingSaving || !changePlanSelect} className="flex-1 px-4 py-2.5 disabled:opacity-50 text-white rounded-xl font-semibold" style={{ background: 'hsl(var(--primary))' }}>{billingSaving ? tBilling('saving') : tBilling('submitRequest')}</button>
                <button onClick={() => { setShowPlanRequestModal(false); setChangePlanSelect(''); }} className="px-4 py-2.5 bg-muted rounded-xl text-[var(--color-text-primary)]">{tCommon('cancel')}</button>
              </div>
            </div>
          </div>
        )}

        {/* Invite Modal */}
        {showInviteModal && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowInviteModal(false)}>
            <div className="bg-[var(--color-surface-1)] rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between p-6 border-b border-[var(--color-border-subtle)]">
                <h2 className="text-lg font-bold text-[var(--color-text-primary)]">{t('inviteMember')}</h2>
                <button type="button" onClick={() => setShowInviteModal(false)} className="p-2 hover:bg-[var(--color-surface-2)] rounded-lg"><X className="w-5 h-5 text-[var(--color-text-secondary)]" /></button>
              </div>
              <form onSubmit={handleInvite} className="p-6 space-y-4">
                {inviteError && <p className="text-sm text-red-500">{inviteError}</p>}
                <div><label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">{t('inviteName')}</label><input type="text" value={inviteName} onChange={(e) => setInviteName(e.target.value)} placeholder={t('inviteName')} className="w-full px-3 py-2 border border-[var(--color-border-subtle)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-[var(--color-surface-1)]" /></div>
                <div><label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">{t('invitePhone')}</label><input type="tel" value={invitePhone} onChange={(e) => { let v = e.target.value.replace(/\D/g, ''); if (v.startsWith('0') && v.length > 1) v = v.substring(1); setInvitePhone(v); setInviteError(''); }} placeholder="01220601310" dir="ltr" className="w-full px-3 py-2 border border-[var(--color-border-subtle)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-[var(--color-surface-1)]" required /></div>
                <div><label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">{t('role')}</label><select value={inviteRole} onChange={(e) => { const v = e.target.value; if (v === 'assistant' || v === 'teacher') setInviteRole(v); }} className="w-full px-3 py-2 border border-[var(--color-border-subtle)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-[var(--color-surface-1)]"><option value="assistant">{t('assistant')}</option><option value="teacher">{tNav('roleTeacher')}</option></select></div>
                {inviteRole === 'teacher' ? (
                  <>
                    <p className="text-sm text-[var(--color-text-secondary)] bg-[var(--color-surface-0)] rounded-lg p-3 border border-[var(--color-border-subtle)]">{t('teacherAccessInfo')}</p>
                    <div>
                      <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">{t('assignGroups')}</label>
                      <div className="mt-1 max-h-32 overflow-y-auto border border-[var(--color-border-subtle)] rounded-lg p-2 space-y-1">
                        {inviteGroups.length === 0 ? <p className="text-sm text-[var(--color-text-secondary)] py-2">{tCommon('noData')}</p> : inviteGroups.map((g) => (
                          <label key={g.id} className="flex items-center gap-2 py-1.5 cursor-pointer hover:bg-[var(--color-surface-0)] rounded px-2">
                            <input type="checkbox" checked={inviteTeacherGroupIds.includes(g.id)} onChange={(e) => setInviteTeacherGroupIds(prev => e.target.checked ? [...prev, g.id] : prev.filter(id => id !== g.id))} className="rounded border-slate-300 text-teal-600 focus:ring-teal-500" />
                            <span className="text-sm text-[var(--color-text-primary)]">{g.name}{g.subject ? ` (${g.subject})` : ''}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm font-semibold text-[var(--color-text-primary)]">{t('permissions')}</p>
                    {[{ key: 'can_scan', labelKey: 'canScan', Icon: Camera }, { key: 'can_view_payments', labelKey: 'canViewPayments', Icon: CreditCard }, { key: 'can_view_dashboard', labelKey: 'canViewDashboard', Icon: LayoutDashboard }, { key: 'can_manage_students', labelKey: 'canManageStudents', Icon: Users }, { key: 'can_manage_groups', labelKey: 'canManageGroups', Icon: BookOpen }, { key: 'can_view_settings', labelKey: 'canViewSettings', Icon: Shield }].map(({ key, labelKey, Icon }) => (
                      <div key={key} className="flex items-center justify-between py-2 border-b border-[var(--color-border-subtle)]">
                        <div className="flex items-center gap-2">
                          <Icon className="w-4 h-4 text-slate-400" />
                          <span className="text-sm text-[var(--color-text-primary)]">{t(labelKey)}</span>
                        </div>
                        <button type="button" role="switch" aria-checked={invitePerms[key] ?? false} onClick={() => setInvitePerms(p => ({ ...p, [key]: !(p[key] ?? false) }))} className={`relative w-10 h-5 rounded-full transition-colors ${invitePerms[key] ?? false ? 'bg-teal-600' : 'bg-slate-200'}`}>
                          <span className={`absolute top-0.5 w-4 h-4 bg-[var(--color-surface-1)] rounded-full shadow transition-all ${invitePerms[key] ?? false ? 'start-5' : 'start-0.5'}`} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex justify-end gap-3 pt-4">
                  <button type="button" onClick={() => setShowInviteModal(false)} className="px-4 py-2 border border-slate-300 hover:bg-[var(--color-surface-0)] text-[var(--color-text-primary)] text-sm font-semibold rounded-lg">{tCommon('cancel')}</button>
                  <button type="submit" disabled={inviteSubmitting || !invitePhone.trim()} className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50">{inviteSubmitting ? tCommon('loading') : t('invite')}</button>
                </div>
              </form>
            </div>
          </div>
        )}

        <PasswordConfirmModal isOpen={!!permissionPrompt} onClose={() => { setPermissionPrompt(null); setPermissionPromptError(''); }} title={t('confirmPermissionChange')} message={t('enterPasswordToConfirm')} error={permissionPromptError} onConfirm={confirmPermissionChange} />
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" /></div>}>
      <SettingsPageContent />
    </Suspense>
  );
}
