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
import PasswordConfirmModal from '@/components/PasswordConfirmModal';

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
  max_teachers?: number;
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
const FALLBACK_PLANS: PricingPlan[] = [
  { id: 'starter', name_en: 'Starter', name_ar: 'أساسي', students_per_week_limit: 150, monthly_fee: 2000, per_student_at_capacity_egp: 13.33, setup_fee_egp: 1000, is_custom: false },
  { id: 'pro', name_en: 'Pro', name_ar: 'محترف', students_per_week_limit: 500, monthly_fee: 4500, per_student_at_capacity_egp: 9, setup_fee_egp: 2000, is_custom: false },
  { id: 'business', name_en: 'Business', name_ar: 'أعمال', students_per_week_limit: 1000, monthly_fee: 6500, per_student_at_capacity_egp: 6.5, setup_fee_egp: 3000, is_custom: false },
  { id: 'enterprise', name_en: 'Enterprise', name_ar: 'مؤسسات', students_per_week_limit: 2000, monthly_fee: 9000, per_student_at_capacity_egp: 4.5, setup_fee_egp: 5000, is_custom: false },
  { id: 'top_centers', name_en: 'Top Centers', name_ar: 'كبار السناتر', students_per_week_limit: 999999, monthly_fee: 0, per_student_at_capacity_egp: 0, setup_fee_egp: 0, is_custom: true },
];

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

function getFixedPlanComparison(plans: PricingPlan[], students: number) {
  const starter = plans.find(p => p.id === 'starter');
  const pro = plans.find(p => p.id === 'pro');
  const business = plans.find(p => p.id === 'business');
  const enterprise = plans.find(p => p.id === 'enterprise');
  const top = plans.find(p => p.id === 'top_centers');
  if (students <= 150) return { planName: starter?.name_en ?? 'Starter', planNameAr: starter?.name_ar ?? 'أساسي', planFee: starter?.monthly_fee ?? 2000, isCustom: false };
  if (students <= 500) return { planName: pro?.name_en ?? 'Pro', planNameAr: pro?.name_ar ?? 'محترف', planFee: pro?.monthly_fee ?? 4500, isCustom: false };
  if (students <= 1000) return { planName: business?.name_en ?? 'Business', planNameAr: business?.name_ar ?? 'أعمال', planFee: business?.monthly_fee ?? 6500, isCustom: false };
  if (students <= 2000) return { planName: enterprise?.name_en ?? 'Enterprise', planNameAr: enterprise?.name_ar ?? 'مؤسسات', planFee: enterprise?.monthly_fee ?? 9000, isCustom: false };
  return { planName: top?.name_en ?? 'Top Centers', planNameAr: top?.name_ar ?? 'كبار السناتر', planFee: 0, isCustom: true };
}

// Filter out pro_plus if it exists
function filterPlans(plans: PricingPlan[]): PricingPlan[] {
  return (plans ?? FALLBACK_PLANS).filter(p => p.id !== 'pro_plus');
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
  const { user: currentUser, hasPermission } = useUser();
  const isRTL = locale === 'ar';

  // Tab from URL or default
  const tabParam = searchParams.get('tab') as TabType | null;
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
  const [newSubjectName, setNewSubjectName] = useState('');
  const [scannerMode, setScannerMode] = useState('camera');
  const [editingSubject, setEditingSubject] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [referralData, setReferralData] = useState<{ referralCode: string; rewards: { id: string; referred_center_name: string; referred_center_plan: string; reward_amount: number; reward_status: string; created_at: string }[]; pending?: { referred_center_name: string; referred_center_plan: string; reward_status: string }[]; totalEarned: number } | null>(null);
  const [referralCopied, setReferralCopied] = useState(false);
  const [logoLoadFailed, setLogoLoadFailed] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Billing
  const [billingData, setBillingData] = useState<{
    plan: string;
    pricing_type: string;
    billing_type?: string;
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

  // Redirect assistants/teachers without can_view_settings
  useEffect(() => {
    if (currentUser && (currentUser.role === 'assistant' || currentUser.role === 'teacher') && !hasPermission('can_view_settings')) {
      router.replace('/dashboard');
    }
  }, [currentUser, hasPermission, router]);

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
        setScannerMode(c.scanner_default_mode || 'camera');
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
        return;
      }
      const json = await res.json();
      const plans = (json.plans?.length ? json.plans : FALLBACK_PLANS) as PricingPlan[];
      const paygRates = (json.payg_rates?.length ? json.payg_rates : FALLBACK_PAYG) as PaygRate[];
      setBillingData({
        plan: json.plan || 'starter',
        pricing_type: json.pricing_type || json.billing_type || 'fixed',
        billing_type: json.billing_type || json.pricing_type,
        weekly_student_limit: json.weekly_student_limit ?? 200,
        plans,
        payg_rates: paygRates,
        current_plan_details: json.current_plan_details,
        is_early_adopter: json.is_early_adopter,
        early_adopter_price: json.early_adopter_price,
        center_name: json.center_name,
        invoices: json.invoices || [],
      });
      setPaygSlider(json.weekly_student_limit ?? 200);
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
  }, []);

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

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !centerId || !userId) return;
    const ext = file.name.split('.').pop();
    const path = `${centerId}/logo.${ext}`;
    const { error: uploadError } = await supabase.storage.from('center-logos').upload(path, file, { upsert: true });
    if (uploadError) { console.error('Logo upload error:', uploadError); return; }
    const { data: publicData } = supabase.storage.from('center-logos').getPublicUrl(path);
    const cacheBustedUrl = publicData.publicUrl + '?t=' + Date.now();
    const { error } = await dbUpdate({ table: 'centers', data: { logo_url: cacheBustedUrl }, filters: [{ column: 'id', op: 'eq', value: centerId }] });
    if (error) {
      console.error('Logo dbUpdate error:', error);
      return;
    }
    await auditLog({ centerId, userId, action: 'center_update', entityType: 'centers', details: { field: 'logo' } });
    setCenter(prev => prev ? { ...prev, logo_url: cacheBustedUrl } : null);
    setLogoLoadFailed(false);
    showSaved();
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
      const res = await fetch('/api/invite-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, ...await getCsrfHeaders(session.access_token) },
        body: JSON.stringify({ name: inviteName.trim() || '', phone: phoneToSend, role: inviteRole }),
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
  const paygResult = useMemo(() => calculatePaygCost(paygRates, paygSlider), [paygRates, paygSlider]);
  const fixedComparison = useMemo(() => getFixedPlanComparison(plans, paygSlider), [plans, paygSlider]);
  const fixedSavesMoney = !fixedComparison.isCustom && fixedComparison.planFee < paygResult.monthly;
  const savingsAmount = fixedSavesMoney ? paygResult.monthly - fixedComparison.planFee : 0;

  const instapayNumber = '01001963432';

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
          <div className="h-8 bg-muted rounded-xl w-48 mb-6 animate-pulse" />
          <div className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 bg-card rounded-xl animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background animate-fade-in" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <h1 className="text-2xl font-bold text-foreground mb-6">{t('title')}</h1>

        {/* Tabs */}
        <div className="flex gap-1 p-1 rounded-xl border border-border w-fit mb-6" style={{ background: 'hsl(var(--muted))' }}>
          <button
            onClick={() => setActiveTab('general')}
            className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
              activeTab === 'general' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
            }`}
          >
            {t('general')}
          </button>
          <button
            onClick={() => setActiveTab('billing')}
            className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
              activeTab === 'billing' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
            }`}
          >
            {t('billing')}
          </button>
          <button
            onClick={() => setActiveTab('team')}
            className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
              activeTab === 'team' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
            }`}
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
            <section className="ch-card">
              <h2 className="text-base font-semibold text-foreground mb-4">{t('centerInfo')}</h2>
              <div className="flex items-start gap-6 flex-wrap">
                <div className="flex flex-col items-center gap-3">
                  {center?.logo_url && !logoLoadFailed ? (
                    <img src={center.logo_url} alt="Logo" className="w-20 h-20 rounded-full object-cover border-2 border-border" onError={() => setLogoLoadFailed(true)} />
                  ) : (
                    <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center overflow-hidden">
                      <Image src="/logo-icon.png" alt="CenterHQ" width={40} height={40} className="object-contain opacity-80" />
                    </div>
                  )}
                  <label className="cursor-pointer px-4 py-2 text-sm font-medium text-primary hover:text-primary/80 border border-primary/50 rounded-lg hover:bg-primary/10 transition-colors">
                    {(center?.logo_url && !logoLoadFailed) ? t('logoChange') : t('logoUpload')}
                    <input ref={logoInputRef} type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
                  </label>
                </div>
                <div className="flex-1 min-w-[200px] space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-muted-foreground mb-1.5">{t('centerName')}</label>
                    <div className="flex gap-2">
                      <input type="text" value={centerName} onChange={(e) => setCenterName(e.target.value)} className="flex-1 px-4 py-2.5 rounded-lg border border-input bg-background text-foreground text-sm focus:ring-2 focus:ring-ring" />
                      <button onClick={handleSaveCenterName} className="px-4 py-2.5 text-white text-sm font-semibold rounded-lg transition-colors shrink-0" style={{ background: 'hsl(var(--primary))' }}>{tCommon('save')}</button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-muted-foreground mb-1.5">{t('centerPhone')}</label>
                    <div className="flex gap-2">
                      <input type="tel" value={centerPhone} onChange={(e) => setCenterPhone(e.target.value)} dir="ltr" className="flex-1 px-4 py-2.5 rounded-lg border border-input bg-background text-foreground text-sm focus:ring-2 focus:ring-ring" placeholder="01xxxxxxxxx" />
                      <button type="button" onClick={handleSaveCenterPhone} className="px-4 py-2.5 text-white text-sm font-semibold rounded-lg shrink-0" style={{ background: 'hsl(var(--primary))' }}>{tCommon('save')}</button>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* 2. Subject Management */}
            <section className="ch-card">
              <h2 className="text-base font-semibold text-foreground mb-4">{t('subjects')}</h2>
              <div className="space-y-2 mb-4">
                {subjects.map((subject) => (
                  <div key={subject.id} className="flex items-center gap-3 p-3 bg-muted rounded-lg">
                    {editingSubject === subject.id ? (
                      <>
                        <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} className="flex-1 px-3 py-2 rounded-lg border border-input bg-background text-foreground text-sm" />
                        <button onClick={() => handleUpdateSubject(subject.id)} className="text-primary text-sm font-medium hover:underline">{tCommon('save')}</button>
                        <button onClick={() => setEditingSubject(null)} className="text-muted-foreground text-sm hover:underline">{tCommon('cancel')}</button>
                      </>
                    ) : (
                      <>
                        <span className="flex-1 text-sm text-foreground font-medium">{subject.name}</span>
                        <button onClick={() => { setEditingSubject(subject.id); setEditName(subject.name); }} className="text-primary text-sm hover:underline">{tCommon('edit')}</button>
                        <button onClick={() => handleDeleteSubject(subject.id)} className="text-red-400 text-sm hover:underline">{tCommon('delete')}</button>
                      </>
                    )}
                  </div>
                ))}
              </div>
              <form onSubmit={handleAddSubject} className="flex gap-2">
                <input type="text" value={newSubjectName} onChange={(e) => setNewSubjectName(e.target.value)} placeholder={t('subjectName')} className="flex-1 px-4 py-2.5 rounded-lg border border-input bg-background text-foreground text-sm placeholder-muted-foreground" required />
                <button type="submit" className="px-4 py-2.5 text-white text-sm font-semibold rounded-lg transition-colors whitespace-nowrap" style={{ background: 'hsl(var(--primary))' }}>{t('addSubject')}</button>
              </form>
            </section>

            {/* 3. Team Members (compact) */}
            <section className="ch-card">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-foreground">{t('teamMembers')}</h2>
                <button onClick={() => setActiveTab('team')} className="px-4 py-2 text-white text-sm font-semibold rounded-lg transition-colors" style={{ background: 'hsl(var(--primary))' }}>{t('manageTeam')} →</button>
              </div>
            </section>

            {/* 4. Scanner Settings */}
            <section className="ch-card">
              <h2 className="text-base font-semibold text-foreground mb-1">{t('scanner')}</h2>
              <p className="text-sm text-muted-foreground mb-3">{t('defaultMode')}</p>
              <div className="inline-flex rounded-lg overflow-hidden border border-border">
                <button onClick={() => handleScannerMode('camera')} className={`px-5 py-2.5 text-sm font-medium transition-colors ${scannerMode === 'camera' ? 'text-white' : 'bg-card text-muted-foreground hover:bg-muted'}`} style={scannerMode === 'camera' ? { background: 'hsl(var(--primary))' } : {}}>{t('camera')}</button>
                <button onClick={() => handleScannerMode('bluetooth')} className={`px-5 py-2.5 text-sm font-medium transition-colors ${scannerMode === 'bluetooth' ? 'text-white' : 'bg-card text-muted-foreground hover:bg-muted'}`} style={scannerMode === 'bluetooth' ? { background: 'hsl(var(--primary))' } : {}}>{t('bluetooth')}</button>
              </div>
            </section>

            {/* 5. Referral Program */}
            <section className="ch-card">
              <h2 className="text-base font-semibold text-foreground mb-2">{tReferral('title')}</h2>
              <p className="text-sm text-muted-foreground mb-4">{tReferral('shareText')}</p>
              {referralData && (
                <>
                  <div className="flex items-center gap-3 mb-4 flex-wrap">
                    <code className="text-lg font-mono font-bold text-foreground bg-background px-4 py-3 rounded-lg tracking-[0.2em] border border-border">{referralData.referralCode || '—'}</code>
                    <button type="button" onClick={async () => { if (referralData.referralCode) { await navigator.clipboard.writeText(referralData.referralCode); setReferralCopied(true); setTimeout(() => setReferralCopied(false), 2000); } }} className="px-4 py-2.5 text-white text-sm font-semibold rounded-lg" style={{ background: 'hsl(var(--primary))' }}>{referralCopied ? tReferral('copied') : tReferral('copyCode')}</button>
                  </div>
                  <div className="mb-4 p-4 bg-green-100 rounded-xl border border-green-500/30">
                    <p className="text-sm font-medium text-green-700">{tReferral('totalEarned')}: {Number(referralData.totalEarned || 0).toLocaleString('ar-EG')} EGP</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-2">{tReferral('rewardsTable')}</p>
                    {(referralData.rewards?.length ?? 0) > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border">
                              <th className="text-start py-2 text-xs font-medium text-muted-foreground">{tReferral('referredCenter')}</th>
                              <th className="text-start py-2 text-xs font-medium text-muted-foreground">{tReferral('plan')}</th>
                              <th className="text-start py-2 text-xs font-medium text-muted-foreground">{tReferral('rewardAmount')}</th>
                              <th className="text-start py-2 text-xs font-medium text-muted-foreground">{tReferral('status')}</th>
                              <th className="text-start py-2 text-xs font-medium text-muted-foreground">{tReferral('date')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(referralData.rewards ?? []).map((r) => (
                              <tr key={r.id || r.created_at + r.referred_center_name} className="border-b border-border">
                                <td className="py-2 text-foreground">{r.referred_center_name}</td>
                                <td className="py-2 text-muted-foreground">{r.referred_center_plan}</td>
                                <td className="py-2 font-mono text-foreground">{Number(r.reward_amount).toLocaleString('ar-EG')} EGP</td>
                                <td className="py-2"><span className={`px-2 py-0.5 text-xs font-medium rounded-full ${r.reward_status === 'paid' ? 'badge-confirmed' : r.reward_status === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-muted text-muted-foreground'}`}>{r.reward_status}</span></td>
                                <td className="py-2 text-muted-foreground">{new Date(r.created_at).toLocaleDateString('ar-EG')}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground py-4">{tReferral('noRewards')}</p>
                    )}
                  </div>
                </>
              )}
              {!referralData && <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>}
            </section>

            {/* 6. Billing & Subscriptions (compact) */}
            <section className="ch-card">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-foreground">{t('billing')}</h2>
                <button onClick={() => setActiveTab('billing')} className="px-4 py-2 text-white text-sm font-semibold rounded-lg transition-colors" style={{ background: 'hsl(var(--primary))' }}>{t('billingLink')} →</button>
              </div>
            </section>

            {/* 7. WhatsApp Support - primary left border */}
            <section className="ch-card border-l-4 border-l-primary">
              <h2 className="text-base font-semibold text-foreground mb-2">WhatsApp Support</h2>
              <p className="text-sm text-muted-foreground" dir="ltr">Contact support: support@centerhq.com | WhatsApp: +20 122 060 1410</p>
              <p className="text-sm text-muted-foreground mt-2" dir="rtl">للدعم والتواصل: support@centerhq.com | واتساب: 01220601410</p>
            </section>

            {/* 8. Account */}
            <section className="ch-card">
              <h2 className="text-base font-semibold text-foreground mb-4">{t('account')}</h2>
              <div className="flex flex-wrap gap-3">
                <Link href="/settings/reset-password" className="px-4 py-2.5 border border-border text-foreground rounded-lg text-sm font-medium hover:bg-muted transition-colors">{t('resetPassword')}</Link>
                <button onClick={handleLogout} className="px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg transition-colors">{t('logout')}</button>
              </div>
            </section>
          </div>
        )}

        {/* BILLING TAB */}
        {activeTab === 'billing' && (
          <div className="space-y-6 overflow-y-auto max-h-[calc(100vh-200px)] pb-4">
            {billingLoading ? (
              <div className="flex justify-center py-16"><div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" /></div>
            ) : (
              <>
                {/* 1. Current Plan - primary left border, primary badge */}
                <section className="ch-card border-l-4 border-l-primary">
                  <span className="inline-block px-2.5 py-0.5 text-xs font-semibold rounded text-white mb-4" style={{ background: 'hsl(var(--primary))' }}>{tBilling('currentPlan')}</span>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div><span className="text-xs text-muted-foreground block mb-0.5">{tBilling('plan')}</span><p className="font-semibold text-foreground">{currentPlanDetails?.name_en ?? billingData?.plan} / {currentPlanDetails?.name_ar ?? ''}</p></div>
                    <div><span className="text-xs text-muted-foreground block mb-0.5">{tBilling('monthlyFeeLabel')}</span><p className="font-semibold text-foreground">{currentPlanDetails?.is_custom ? tBilling('custom') : `${Number(billingData?.is_early_adopter && typeof billingData?.early_adopter_price === 'number' ? billingData.early_adopter_price : currentPlanDetails?.monthly_fee ?? 0).toLocaleString('ar-EG')} ${tBilling('egp')}`}</p></div>
                    <div><span className="text-xs text-muted-foreground block mb-0.5">{tBilling('studentsPerWeek')}</span><p className="font-semibold text-foreground">{currentPlanDetails?.is_custom ? '2,000+' : `≤${currentPlanDetails?.students_per_week_limit?.toLocaleString('ar-EG') ?? 0}`}</p></div>
                    <div><span className="text-xs text-muted-foreground block mb-0.5">{tBilling('costPerStudent')}</span><p className="font-semibold text-foreground">{currentPlanDetails?.is_custom ? tBilling('negotiated') : `${Number(currentPlanDetails?.per_student_at_capacity_egp ?? 0).toLocaleString('ar-EG')} ${tBilling('egp')}`}</p></div>
                  </div>
                </section>

                {/* 2. Fixed Monthly Plans - 5 cards in a row */}
                <section>
                  <h2 className="text-base font-semibold text-foreground mb-4">{tBilling('fixedPlans')}</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                    {plans.map((plan) => {
                      const isCurrent = billingData?.plan === plan.id && billingData?.pricing_type === 'fixed';
                      const isBestValue = plan.id === 'enterprise';
                      const isTopCenters = plan.id === 'top_centers';
                      const setupFees: Record<string, number> = { starter: 1000, pro: 2000, business: 3000, enterprise: 5000, top_centers: 0 };
                      const setupFee = plan.setup_fee_egp ?? setupFees[plan.id] ?? 0;
                      return (
                        <div key={plan.id} className={`relative rounded-xl p-4 border ${isCurrent ? 'border-primary bg-primary/10' : 'border-border bg-card'}`}>
                          {isBestValue && !isTopCenters && <span className="absolute -top-2 left-1/2 -translate-x-1/2 px-2 py-0.5 text-[10px] font-bold rounded-full bg-amber-500 text-white">{tBilling('bestValue')}</span>}
                          <h3 className="text-base font-bold text-foreground">{plan.name_en}</h3>
                          <p className="text-xs text-muted-foreground">{plan.name_ar}</p>
                          <div className="mt-3 space-y-1.5 text-sm">
                            <div className="flex justify-between"><span className="text-muted-foreground">{tBilling('monthlyFeeLabel')}</span><span className="font-medium text-foreground">{plan.is_custom ? tBilling('custom') : `${Number(plan.monthly_fee).toLocaleString('ar-EG')} ${tBilling('egp')}`}</span></div>
                            <div className="flex justify-between"><span className="text-muted-foreground">{tBilling('studentsPerWeek')}</span><span className="font-medium text-foreground">{plan.is_custom ? '2,000+' : `≤${plan.students_per_week_limit.toLocaleString('ar-EG')}`}</span></div>
                            <div className="flex justify-between"><span className="text-muted-foreground">{tBilling('setup')}</span><span className="font-medium text-foreground">{plan.is_custom ? '—' : `${Number(setupFee).toLocaleString('ar-EG')} ${tBilling('egp')}`}</span></div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>

                {/* 3. Pay-As-You-Go - slider 0-2500 */}
                <section className="ch-card">
                  <h2 className="text-base font-semibold text-foreground mb-1">{tBilling('paygTitle')}</h2>
                  <p className="text-sm text-muted-foreground mb-4">{tBilling('paygSubtitle')}</p>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm text-muted-foreground mb-2">{tBilling('studentsPerWeekSlider')}: <strong className="text-foreground">{paygSlider.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-EG')}</strong></label>
                      <input type="range" min={0} max={2500} step={10} value={paygSlider} onChange={(e) => setPaygSlider(Number(e.target.value))} className="w-full h-2.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary" />
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 rounded-xl" style={{ background: 'hsl(var(--muted))' }}>
                      <div><span className="text-xs text-muted-foreground block">{tBilling('weeklyCost')}</span><p className="font-bold text-foreground text-sm">{paygResult.weekly.toLocaleString('ar-EG')} {tBilling('egp')}/week</p></div>
                      <div><span className="text-xs text-muted-foreground block">{tBilling('monthlyFeeLabel')}</span><p className="font-semibold text-foreground text-sm">{paygResult.monthly.toLocaleString('ar-EG')} {tBilling('egp')}/month</p></div>
                      <div><span className="text-xs text-muted-foreground block">{tBilling('rateTier')}</span><p className="font-semibold text-foreground text-sm">{paygResult.effectiveRate > 0 ? `${Number(paygResult.effectiveRate).toLocaleString('ar-EG')} ${tBilling('egp')}/${tBilling('perStudent')}` : '—'}</p></div>
                      <div><span className="text-xs text-muted-foreground block">{tBilling('premiumVsFixed')}</span><p className={`font-semibold text-sm ${fixedSavesMoney ? 'text-green-700' : fixedComparison.isCustom ? 'text-muted-foreground' : 'text-amber-400'}`}>{fixedComparison.isCustom ? tBilling('contactUs') : fixedSavesMoney ? tBilling('fixedPlanBetter') : tBilling('paygCostsMore', { amount: `${savingsAmount.toLocaleString('ar-EG')} ${tBilling('egp')}` })}</p></div>
                    </div>
                    {paygResult.breakdown.length > 0 && (
                      <div className="p-4 rounded-xl text-sm" style={{ background: 'hsl(var(--muted))' }}>
                        <span className="text-xs text-muted-foreground block mb-2">Tier breakdown (0-150=4 EGP, 151-500=3, 501-1000=2.50, 1001-2000=2, 2001+=1.75)</span>
                        {paygResult.breakdown.map((tier, i) => (
                          <div key={i} className="flex justify-between text-foreground"><span>{tier.count.toLocaleString('ar-EG')} × {Number(tier.rate).toLocaleString('ar-EG')} {tBilling('egp')} =</span><span>{Number(tier.cost).toLocaleString('ar-EG')} {tBilling('egp')}</span></div>
                        ))}
                      </div>
                    )}
                    {fixedSavesMoney && (
                      <div className="p-4 bg-green-100 rounded-xl border border-green-500/30">
                        <p className="text-sm font-medium text-green-700">{tBilling('fixedPlanBetter')} Fixed plan: {fixedComparison.planFee?.toLocaleString('ar-EG')} {tBilling('egp')}/mo</p>
                      </div>
                    )}
                  </div>
                </section>

                {/* 4. Want to change your plan? */}
                {currentUser?.role === 'owner' && (
                  <section className="ch-card">
                    <h2 className="text-base font-semibold text-foreground mb-4">{tBilling('changeQuestion')}</h2>
                    <div className="flex flex-wrap items-center gap-3">
                      <button onClick={() => setShowPlanRequestModal(true)} className="px-4 py-2.5 text-white text-sm font-semibold rounded-lg" style={{ background: 'hsl(var(--primary))' }}>{tBilling('requestPlanChange')}</button>
                      <a href={`https://wa.me/201001963432?text=${encodeURIComponent(`مرحباً، أريد تغيير خطة سنتر ${billingData?.center_name || ''}`)}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80 text-sm font-medium">{tBilling('requestViaWhatsapp')}</a>
                    </div>
                  </section>
                )}

                {/* 5. Invoice History */}
                <section className="ch-card">
                  <h2 className="text-base font-semibold text-foreground mb-4">{tBilling('invoiceHistory')}</h2>
                  {(billingData?.invoices?.length ?? 0) > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border">
                            <th className="text-start py-2 text-xs font-medium text-muted-foreground">{tBilling('invoiceNumber')}</th>
                            <th className="text-start py-2 text-xs font-medium text-muted-foreground">{tBilling('date')}</th>
                            <th className="text-start py-2 text-xs font-medium text-muted-foreground">{tBilling('amount')}</th>
                            <th className="text-start py-2 text-xs font-medium text-muted-foreground">{tBilling('reference')}</th>
                            <th className="text-start py-2 text-xs font-medium text-muted-foreground">{tBilling('status')}</th>
                            <th className="text-start py-2 text-xs font-medium text-muted-foreground">{tBilling('proof')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {billingData?.invoices?.map((inv) => {
                            const status = inv.status?.toLowerCase?.() ?? '';
                            const statusClass = status === 'paid' || status === 'approved' ? 'badge-confirmed' : status === 'rejected' ? 'badge-late' : 'bg-amber-100 text-amber-700';
                            return (
                              <tr key={inv.id || inv.invoice_number || String(inv.created_at)} className="border-b border-border">
                                <td className="py-2 text-foreground">{inv.invoice_number || '—'}</td>
                                <td className="py-2 text-muted-foreground">{inv.created_at ? new Date(inv.created_at).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-GB') : inv.period_start && inv.period_end ? `${inv.period_start} – ${inv.period_end}` : '—'}</td>
                                <td className="py-2 font-mono text-foreground">{Number(inv.payment_amount ?? inv.total_amount ?? 0).toLocaleString('ar-EG')} {tBilling('egp')}</td>
                                <td className="py-2 text-muted-foreground">{inv.payment_reference || '—'}</td>
                                <td className="py-2"><span className={`px-2 py-0.5 rounded text-xs font-medium ${statusClass}`}>{inv.status}</span></td>
                                <td className="py-2">{inv.payment_proof_url ? <a href={inv.payment_proof_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{tBilling('viewProof')}</a> : '—'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : <p className="text-muted-foreground py-4">{tBilling('noInvoices')}</p>}
                </section>

                {/* 6. Payment Methods + 7. Submit Payment Proof */}
                <section className="ch-card">
                  <h2 className="text-base font-semibold text-foreground mb-4">{tBilling('paymentMethods')}</h2>
                  <div className="flex items-center gap-2 mb-4">
                    <span className="font-mono text-lg font-bold text-primary">{instapayNumber}</span>
                    <button type="button" onClick={() => { navigator.clipboard.writeText(instapayNumber); setSavedMessage(tCommon('copy')); setTimeout(() => setSavedMessage(''), 2000); }} className="px-3 py-1.5 text-sm bg-muted rounded-lg hover:bg-muted/80 text-foreground">{tCommon('copy')}</button>
                  </div>
                  <p className="text-sm text-muted-foreground mb-6">{tBilling('bankTransfer')}: {tBilling('bankTransferComingSoon')}</p>

                  <h3 className="text-base font-semibold text-foreground mb-4">{tBilling('submitProofTitle')}</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-muted-foreground mb-1">{tBilling('transferAmountLabel')}</label>
                      <input type="number" min="0" step="0.01" value={proofAmount} onChange={(e) => setProofAmount(e.target.value)} placeholder={tBilling('transferAmountPlaceholder')} className="w-full px-4 py-2.5 rounded-lg border border-input bg-background text-foreground focus:ring-2 focus:ring-ring" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-muted-foreground mb-1">{tBilling('instapayRefLabel')}</label>
                      <input type="text" value={proofReference} onChange={(e) => setProofReference(e.target.value)} placeholder={tBilling('instapayRef')} className="w-full px-4 py-2.5 rounded-lg border border-input bg-background text-foreground focus:ring-2 focus:ring-ring" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-muted-foreground mb-1">{tBilling('proofLabel')}</label>
                      <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={handleFileChange} className="w-full text-sm text-muted-foreground file:me-2 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-primary/20 file:text-primary file:font-medium hover:file:bg-primary/30" />
                      {proofPreview && <img src={proofPreview} alt="Preview" className="mt-2 max-h-32 rounded-lg border border-border" />}
                    </div>
                    <button onClick={handleSubmitPaymentProof} disabled={billingSaving || proofUploading || !proofAmount || parseFloat(proofAmount) <= 0 || !proofReference.trim()} className="w-full py-3 disabled:opacity-50 text-white font-semibold rounded-xl" style={{ background: 'hsl(var(--primary))' }}>{proofUploading ? tCommon('loading') : tBilling('submitPaymentProof')}</button>
                    <p className="text-xs text-muted-foreground">{tBilling('paymentProofWhatsappNote')}</p>
                  </div>
                </section>
              </>
            )}
          </div>
        )}

        {/* TEAM TAB */}
        {activeTab === 'team' && (
          <div className="space-y-4 overflow-y-auto max-h-[calc(100vh-200px)] pb-4">
            {(currentUser?.role === 'assistant' || currentUser?.role === 'teacher') ? (
              <p className="text-muted-foreground">Only owners and admins can manage team members.</p>
            ) : (
              <>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <h2 className="text-lg font-bold text-foreground">{t('teamMembers')}</h2>
                    {limits && <p className="text-sm text-muted-foreground">{t('teamMembersCount', { current: teamMembers.length, max: limits.maxTeachers })}</p>}
                  </div>
                  <button onClick={() => setShowInviteModal(true)} disabled={limits ? !limits.canAddTeacher : false} className="px-4 py-2.5 disabled:opacity-50 text-white text-sm font-semibold rounded-lg" style={{ background: 'hsl(var(--primary))' }}>{t('inviteMemberPlus')}</button>
                </div>

                {lastInvitePassword && <div className="p-4 bg-green-100 rounded-xl border border-green-500/30 text-sm text-green-700"><p className="font-medium">{t('inviteSuccess')}</p><p className="mt-1">{t('passwordIs', { password: lastInvitePassword })}</p></div>}

                <div className="bg-card rounded-xl overflow-hidden border border-border">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="px-4 py-3 text-start text-xs font-medium text-muted-foreground">{t('inviteName')}</th>
                          <th className="px-4 py-3 text-start text-xs font-medium text-muted-foreground">{t('invitePhone')}</th>
                          <th className="px-4 py-3 text-start text-xs font-medium text-muted-foreground">{t('role')}</th>
                          <th className="px-4 py-3 text-start text-xs font-medium text-muted-foreground">{t('status')}</th>
                          <th className="px-4 py-3 text-start text-xs font-medium text-muted-foreground">{t('permissions')}</th>
                          <th className="px-4 py-3 text-start text-xs font-medium text-muted-foreground">{tCommon('actions')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {teamMembers.map((member) => {
                          const isSelf = member.id === userId;
                          const isPermReadOnly = isOwner(member) || isSelf;
                          const permChecked = (k: string) => isOwner(member) ? true : (assistantPermissions[member.id]?.[k] ?? false);
                          const permBadges = [
                            { key: 'can_scan', label: t('canScan') },
                            { key: 'can_view_payments', label: t('canViewPayments') },
                            { key: 'can_view_dashboard', label: t('canViewDashboard') },
                          ];
                          return (
                            <tr key={member.id} className={`border-b border-border ${member.is_active === false ? 'opacity-60' : ''}`}>
                              <td className="px-4 py-3 font-medium text-foreground">{member.name || '—'}{isSelf && <span className="text-xs text-muted-foreground ms-1">({t('you')})</span>}</td>
                              <td className="px-4 py-3 text-muted-foreground font-mono" dir="ltr">{member.phone}</td>
                              <td className="px-4 py-3"><span className={`px-2 py-0.5 text-xs font-medium rounded-full ${getRoleBadgeClass(member.role)}`}>{getRoleLabel(member.role)}</span></td>
                              <td className="px-4 py-3">
                                {member.is_active === false ? <span className="px-2 py-0.5 text-xs font-medium rounded-full badge-late">{t('deactivatedStatus')}</span> : <span className="px-2 py-0.5 text-xs font-medium rounded-full badge-confirmed">{t('activeStatus')}</span>}
                              </td>
                              <td className="px-4 py-3">
                                {editingPermissionsId === member.id ? (
                                  <div className="space-y-2">
                                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                                      {PERMISSION_KEYS.map(({ key, labelKey }) => (
                                        <label key={key} className={`flex items-center gap-1.5 text-xs select-none ${isPermReadOnly ? 'cursor-default opacity-75' : 'cursor-pointer text-foreground'}`}>
                                          <input type="checkbox" checked={permChecked(key)} onChange={(e) => !isPermReadOnly && handlePermissionToggle(member.id, key, e.target.checked)} disabled={isPermReadOnly} className="w-3.5 h-3.5 rounded accent-primary" />
                                          {t(labelKey)}
                                        </label>
                                      ))}
                                    </div>
                                    <button type="button" onClick={() => setEditingPermissionsId(null)} className="text-xs text-primary hover:underline">{tCommon('cancel')}</button>
                                  </div>
                                ) : (
                                  <div className="flex flex-wrap gap-1">
                                    {permBadges.map(({ key, label }) => (permChecked(key) ? <span key={key} className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-muted text-foreground">{label}</span> : null))}
                                    {permBadges.every(p => !permChecked(p.key)) && <span className="text-muted-foreground text-xs">—</span>}
                                    {canEditPermissions(member) && <button type="button" onClick={() => setEditingPermissionsId(member.id)} className="text-primary hover:underline text-xs ms-1">{t('editPermissions')}</button>}
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                {!isSelf && !isOwner(member) && (
                                  <div className="flex flex-col gap-1">
                                    <button onClick={() => handleToggleActive(member)} className={`text-xs hover:underline text-start ${member.is_active === false ? 'text-green-700' : 'text-amber-400'}`}>{member.is_active === false ? t('activate') : t('deactivate')}</button>
                                    <button onClick={() => handleRemoveMember(member)} className="text-red-400 hover:underline text-xs text-start">{t('removeMember')}</button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                        {pendingInvites.map((inv, idx) => (
                          <tr key={`pending-${idx}`} className="border-b border-border">
                            <td className="px-4 py-3 text-muted-foreground">—</td>
                            <td className="px-4 py-3 font-mono text-muted-foreground" dir="ltr">{inv.phone}</td>
                            <td className="px-4 py-3"><span className={`px-2 py-0.5 text-xs font-medium rounded-full ${getRoleBadgeClass(inv.role)}`}>{getRoleLabel(inv.role)}</span></td>
                            <td className="px-4 py-3"><span className="px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-700">{t('pendingInvite')}</span></td>
                            <td className="px-4 py-3">—</td>
                            <td className="px-4 py-3">—</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {teamMembers.length === 0 && pendingInvites.length === 0 && <p className="p-8 text-center text-muted-foreground">{t('noTeamMembers')}</p>}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Plan Request Modal */}
        {showPlanRequestModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowPlanRequestModal(false)}>
            <div className="bg-card rounded-2xl shadow-xl max-w-md w-full p-6 border border-border" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-semibold text-foreground mb-4">{tBilling('requestPlanChange')}</h3>
              <p className="text-sm text-muted-foreground mb-4">{tBilling('selectPlan')}</p>
              <div className="space-y-2 mb-6">
                {plans.filter(p => p.id !== 'top_centers').map(p => (
                  <button key={p.id} type="button" onClick={() => setChangePlanSelect(p.id)} className={`w-full px-4 py-2.5 text-left rounded-xl border ${changePlanSelect === p.id ? 'border-primary bg-primary/20 text-foreground' : 'border-border bg-card text-foreground hover:bg-muted'}`}>{p.name_en} / {p.name_ar} — {p.monthly_fee > 0 ? `${Number(p.monthly_fee).toLocaleString('ar-EG')} ${tBilling('egp')}/mo` : tBilling('custom')}</button>
                ))}
                <button type="button" onClick={() => setChangePlanSelect('payg')} className={`w-full px-4 py-2.5 text-left rounded-xl border ${changePlanSelect === 'payg' ? 'border-primary bg-primary/20 text-foreground' : 'border-border bg-card text-foreground hover:bg-muted'}`}>Pay-As-You-Go</button>
              </div>
              <div className="flex gap-2">
                <button onClick={handleRequestPlanChange} disabled={billingSaving || !changePlanSelect} className="flex-1 px-4 py-2.5 disabled:opacity-50 text-white rounded-xl font-semibold" style={{ background: 'hsl(var(--primary))' }}>{billingSaving ? tBilling('saving') : tBilling('submitRequest')}</button>
                <button onClick={() => { setShowPlanRequestModal(false); setChangePlanSelect(''); }} className="px-4 py-2.5 bg-muted rounded-xl text-foreground">{tCommon('cancel')}</button>
              </div>
            </div>
          </div>
        )}

        {/* Invite Modal - Name, Phone, Role, Permission toggles */}
        {showInviteModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowInviteModal(false)}>
            <div className="bg-card rounded-2xl shadow-xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto border border-border" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-semibold text-foreground mb-4">{t('inviteMember')}</h3>
              {inviteError && <p className="text-sm text-red-400 mb-3">{inviteError}</p>}
              <form onSubmit={handleInvite} className="space-y-4">
                <div><label className="block text-sm font-medium text-muted-foreground mb-1">{t('inviteName')}</label><input type="text" value={inviteName} onChange={(e) => setInviteName(e.target.value)} placeholder={t('inviteName')} className="w-full px-4 py-2.5 rounded-lg border border-input bg-background text-foreground text-sm" /></div>
                <div><label className="block text-sm font-medium text-muted-foreground mb-1">{t('invitePhone')}</label><input type="tel" value={invitePhone} onChange={(e) => { let v = e.target.value.replace(/\D/g, ''); if (v.startsWith('0') && v.length > 1) v = v.substring(1); setInvitePhone(v); setInviteError(''); }} placeholder="01220601310" dir="ltr" className="w-full px-4 py-2.5 rounded-lg border border-input bg-background text-foreground text-sm" required /></div>
                <div><label className="block text-sm font-medium text-muted-foreground mb-1">{t('role')}</label><select value={inviteRole} onChange={(e) => { const v = e.target.value; if (v === 'assistant' || v === 'teacher') setInviteRole(v); }} className="w-full px-4 py-2.5 rounded-lg border border-input bg-background text-foreground text-sm"><option value="assistant">{t('assistant')}</option><option value="teacher">{tNav('roleTeacher')}</option></select></div>
                <div className="space-y-3"><label className="block text-sm font-medium text-muted-foreground">{t('permissions')}</label><div className="flex flex-wrap gap-x-4 gap-y-2">
                  {[{ key: 'can_scan', labelKey: 'canScan' }, { key: 'can_view_payments', labelKey: 'canViewPayments' }, { key: 'can_view_dashboard', labelKey: 'canViewDashboard' }, { key: 'can_manage_students', labelKey: 'canManageStudents' }, { key: 'can_manage_groups', labelKey: 'canManageGroups' }, { key: 'can_view_settings', labelKey: 'canViewSettings' }].map(({ key, labelKey }) => (
                    <label key={key} className="flex items-center gap-2 text-xs cursor-pointer text-foreground">
                      <input type="checkbox" checked={invitePerms[key] ?? false} onChange={(e) => setInvitePerms(p => ({ ...p, [key]: e.target.checked }))} className="w-4 h-4 rounded accent-primary" />
                      {t(labelKey)}
                    </label>
                  ))}
                </div></div>
                <div className="flex gap-2 pt-2"><button type="submit" disabled={inviteSubmitting || !invitePhone.trim()} className="flex-1 px-4 py-2.5 disabled:opacity-50 text-white text-sm font-semibold rounded-lg" style={{ background: 'hsl(var(--primary))' }}>{inviteSubmitting ? tCommon('loading') : t('invite')}</button><button type="button" onClick={() => setShowInviteModal(false)} className="px-4 py-2.5 bg-muted rounded-lg text-sm text-foreground">{tCommon('cancel')}</button></div>
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
