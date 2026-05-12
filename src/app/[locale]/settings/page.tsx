'use client';

import { useState, useEffect, useCallback, useRef, Suspense, useId } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useRouter } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { dbSelect, dbInsert, dbUpdate, dbDelete, auditLog } from '@/lib/db-proxy';
import { useUser } from '@/contexts/UserContext';
import { Link } from '@/i18n/routing';
import { PageHeader, RoleBadge } from '@/components/shared';
import PasswordConfirmModal from '@/components/PasswordConfirmModal';
import { Building2, BookOpen, Users, QrCode, Gift, CreditCard, MessageCircle, Shield, Camera, ChevronRight, Copy, KeyRound, LogOut, UserPlus, Pencil, UserX, X, LayoutDashboard, Loader2, Calendar, Package, Wallet } from 'lucide-react';
import { DirectionalIcon } from '@/components/icons/DirectionalIcon';
import { SettingsSwitch } from '@/components/settings/SettingsSwitch';
import { StaffMemberCard, SIX_NEW_FLAGS } from '@/components/settings/StaffMemberCard';
import type { CenterPermission } from '@/lib/centerPermissions';
import { formatCurrency, formatDate, formatNumber } from '@/lib/formatNumber';
import { signOutToLogin } from '@/lib/auth/sign-out-client';
import { getSupportWhatsAppDisplayLabel, getSupportWhatsAppWaMeBase } from '@/lib/supportWhatsApp';

type TabType = 'general' | 'team';

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
  governorate?: string | null;
  max_teachers?: number;
  daily_summary_enabled?: boolean;
  summer_mode?: boolean;
  status?: string | null;
  instapay_number?: string | null;
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
  can_manage_billing?: boolean;
  can_edit_center_profile?: boolean;
  can_delete_students?: boolean;
  can_manage_academic_calendar?: boolean;
  can_place_card_orders?: boolean;
  can_request_referral_payouts?: boolean;
}

interface PendingInvite {
  id?: string;
  phone: string;
  role: string;
  status: string;
}

function maskInstapayDisplay(digits: string): string {
  const d = digits.replace(/\D/g, '');
  if (d.length !== 11) return '';
  return `${d.slice(0, 2)}XXXXXXXX${d.slice(-2)}`;
}

const LOGO_MAX_SIZE = 2 * 1024 * 1024; // 2MB
const LOGO_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const DISTRICT_VALUES = [
  'nasr_city',
  'maadi',
  'dokki',
  'heliopolis',
  'new_cairo',
  '6th_october',
  'giza',
  'zamalek',
  'mohandiseen',
  'other',
] as const;

/** Canonical keys aligned with Bosta shipping table — subset for settings UX */
const CENTER_GOVERNORATE_VALUES = [
  'cairo',
  'alexandria',
  'giza',
  'mansoura',
  'tanta',
  'ismailia',
  'port_said',
  'suez',
  'aswan',
  'luxor',
  'asyut',
  'hurghada',
  'other_upper_egypt',
] as const;

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

function SettingsPageContent() {
  const t = useTranslations('settings');
  const tCommon = useTranslations('common');
  const tReferral = useTranslations('referral');
  const tBilling = useTranslations('billing');
  const tNav = useTranslations('nav');
  const tCardOrders = useTranslations('cardOrders');
  const router = useRouter();
  const searchParams = useSearchParams();
  const locale = useLocale();
  const { user: currentUser, hasPermission, refreshUser } = useUser();
  const isRTL = locale === 'ar';
  const dailySummarySwitchId = useId();
  const summerSwitchId = useId();

  // Tab from URL or default
  const tabParam = searchParams?.get('tab');
  const [activeTab, setActiveTab] = useState<TabType>(
    tabParam === 'team' ? 'team' : 'general',
  );

  useEffect(() => {
    if (tabParam === 'billing') {
      router.replace('/settings/billing');
      return;
    }
    if (tabParam === 'general' || tabParam === 'team') {
      setActiveTab(tabParam);
    }
  }, [tabParam, router]);

  const handleLogout = async () => {
    await signOutToLogin(locale);
  };

  // Shared state
  const [center, setCenter] = useState<CenterInfo | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [centerId, setCenterId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  /** Platform admin (e.g. super_admin) with no center - center settings UI does not apply */
  const [isPlatformAdminNoCenter, setIsPlatformAdminNoCenter] = useState(false);
  const [savedMessage, setSavedMessage] = useState('');

  // General
  const [centerName, setCenterName] = useState('');
  const [centerPhone, setCenterPhone] = useState('');
  const [centerDistrict, setCenterDistrict] = useState('');
  const [centerGovernorate, setCenterGovernorate] = useState('');
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

  const [instapayStored, setInstapayStored] = useState<string | null>(null);
  const [instapayDraft, setInstapayDraft] = useState('');
  const [instapayEditing, setInstapayEditing] = useState(false);
  const [instapaySaving, setInstapaySaving] = useState(false);
  const [instapayError, setInstapayError] = useState('');

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
      setIsPlatformAdminNoCenter(false);

      if (!meData?.user?.center_id) {
        try {
          const adminRes = await fetch('/api/admin/check', {
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          const adminData = await adminRes.json();
          setIsPlatformAdminNoCenter(!!adminData?.isAdmin);
        } catch {
          setIsPlatformAdminNoCenter(false);
        }
        setIsLoading(false);
        return;
      }

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
        setCenterGovernorate(
          typeof (c as { governorate?: string | null }).governorate === 'string'
            ? (c as { governorate?: string | null }).governorate ?? ''
            : '',
        );
        setScannerMode(c.scanner_default_mode || 'camera');
        setDailySummaryEnabled(c.daily_summary_enabled !== false);
        setSummerModeEnabled(c.summer_mode === true);
        setLogoUrl(c.logo_url ?? null);
        setLogoLoadFailed(false);
        const ip = typeof c.instapay_number === 'string' ? c.instapay_number.replace(/\D/g, '') : '';
        setInstapayStored(ip.length === 11 ? ip : null);
        setInstapayDraft('');
        setInstapayEditing(false);
        setInstapayError('');
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
      select: 'id, name, phone, role, is_active, can_scan, can_view_payments, can_record_payments, can_view_dashboard, can_view_revenue, can_manage_students, can_manage_groups, can_allow_late_entry, can_manage_rooms, can_view_schedule, can_view_settings, can_manage_billing, can_edit_center_profile, can_delete_students, can_manage_academic_calendar, can_place_card_orders, can_request_referral_payouts',
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
          can_manage_billing: m.can_manage_billing === true,
          can_edit_center_profile: m.can_edit_center_profile === true,
          can_delete_students: m.can_delete_students === true,
          can_manage_academic_calendar: m.can_manage_academic_calendar === true,
          can_place_card_orders: m.can_place_card_orders === true,
          can_request_referral_payouts: m.can_request_referral_payouts === true,
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

  const handleSaveInstapay = async () => {
    setInstapayError('');
    const normalized = instapayDraft.replace(/\D/g, '');
    if (normalized.length !== 11 || !normalized.startsWith('01')) {
      setInstapayError(t('invalidPhone'));
      return;
    }
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    setInstapaySaving(true);
    try {
      const { getCsrfHeaders } = await import('@/lib/csrf-client');
      const res = await fetch('/api/settings/instapay', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          ...(await getCsrfHeaders(session.access_token)),
        },
        body: JSON.stringify({ instapay_number: normalized }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setInstapayError(typeof j.error === 'string' ? j.error : t('instapaySaveFailed'));
        return;
      }
      setInstapayStored(normalized);
      setInstapayEditing(false);
      setInstapayDraft('');
      setCenter((prev) => (prev ? { ...prev, instapay_number: normalized } : null));
      showSaved();
    } finally {
      setInstapaySaving(false);
    }
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

  const handleSaveCenterGovernorate = async () => {
    if (!centerId || !userId) return;
    const val = centerGovernorate.trim() || null;
    const { error } = await dbUpdate({
      table: 'centers',
      data: { governorate: val },
      filters: [{ column: 'id', op: 'eq', value: centerId }],
    });
    if (!error) {
      await auditLog({
        centerId,
        userId,
        action: 'center_update',
        entityType: 'centers',
        details: { field: 'governorate', value: val },
      });
      setCenter((prev) => (prev ? { ...prev, governorate: val } : null));
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
        setInviteError(result.code === 'TEAM_LIMIT_REACHED' ? t('planLimitReached') : result.error || tCommon('errorGeneric'));
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
      } else setInviteError(result.error || tCommon('errorGeneric'));
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
      if (!res.ok) throw new Error('permission_update_failed');
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
    if (role === 'owner') return 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200';
    if (role === 'admin') return 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200';
    if (role === 'teacher') return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200';
    return 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200';
  };

  const getRoleLabel = (role: string) => {
    if (role === 'owner') return tNav('roleOwner');
    if (role === 'admin') return t('admin');
    if (role === 'teacher') return tNav('roleTeacher');
    return t('assistant');
  };

  const isOwner = (member: TeamMember) => member.role === 'owner' || member.role === 'admin';
  const canEditPermissions = (member: TeamMember) => !isOwner(member) && member.id !== userId;

  if (isLoading) {
    return (
      <div className="min-h-screen w-full bg-[var(--color-surface-0)]">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-4" aria-busy>
          <div className="skeleton h-8 rounded-xl w-48" />
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton h-28 rounded-2xl w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (isPlatformAdminNoCenter) {
    return (
      <div className="min-h-screen w-full bg-[var(--color-surface-0)] page-enter" dir={isRTL ? 'rtl' : 'ltr'}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <PageHeader title={t('title')} />
          <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] card-shadow p-6 space-y-4">
            <p className="text-sm text-[var(--color-text-secondary)]">{t('platformAdminSettingsHint')}</p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                href="/settings/reset-password"
                className="inline-flex items-center justify-center gap-2 px-4 py-3 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                <KeyRound className="w-4 h-4 shrink-0" />
                {t('resetPassword')}
              </Link>
              <Link
                href="/admin"
                className="inline-flex items-center justify-center gap-2 px-4 py-3 border border-[var(--color-border-subtle)] text-[var(--color-text-primary)] text-sm font-semibold rounded-lg hover:bg-[var(--color-surface-0)] transition-colors"
              >
                <Shield className="w-4 h-4 shrink-0" />
                {t('backToAdminConsole')}
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-[var(--color-surface-0)] page-enter" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <PageHeader title={t('title')} />

        <Link
          href="/orders"
          className="btn-lift flex items-center gap-3 w-full mb-4 px-4 py-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] card-shadow hover:border-teal-500/30 hover:bg-[var(--color-surface-0)] transition-colors text-[var(--color-text-primary)]"
        >
          <Package className="w-5 h-5 text-teal-600 shrink-0" aria-hidden />
          <span className="font-medium text-sm flex-1 text-start">{tCardOrders('ordersNav')}</span>
          <DirectionalIcon icon={ChevronRight} className="w-4 h-4 text-[var(--color-text-tertiary)] shrink-0" />
        </Link>

        <Link
          href="/whatsapp-pack"
          className="btn-lift flex items-center gap-3 w-full mb-4 px-4 py-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] card-shadow hover:border-teal-500/30 hover:bg-[var(--color-surface-0)] transition-colors text-[var(--color-text-primary)]"
        >
          <MessageCircle className="w-5 h-5 text-teal-600 shrink-0" aria-hidden />
          <span className="font-medium text-sm flex-1 text-start">{t('whatsappPack')}</span>
          <DirectionalIcon icon={ChevronRight} className="w-4 h-4 text-[var(--color-text-tertiary)] shrink-0" />
        </Link>

        {/* Tabs */}
        <div className="flex gap-1 p-1 rounded-xl border border-[var(--color-border-subtle)] w-fit mb-6 bg-[var(--color-surface-1)]">
          <button
            onClick={() => setActiveTab('general')}
            className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${activeTab === 'general' ? 'bg-teal-600 text-white shadow-sm' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}
          >
            {t('general')}
          </button>
          <Link
            href="/settings/billing"
            className="btn-lift inline-flex items-center gap-1 px-4 py-2.5 rounded-xl text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-0)] transition-colors card-shadow"
          >
            {t('billing')}
            <DirectionalIcon icon={ChevronRight} className="w-6 h-6 text-teal-600 dark:text-teal-400" aria-hidden />
          </Link>
          <button
            onClick={() => setActiveTab('team')}
            className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${activeTab === 'team' ? 'bg-teal-600 text-white shadow-sm' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}
          >
            {t('teamMembers')}
          </button>
        </div>

        {savedMessage && (
          <div className="mb-4 p-3 bg-teal-50 dark:bg-teal-950/40 border border-teal-500/30 text-teal-800 dark:text-teal-200 rounded-xl text-sm text-center">
            {savedMessage}
          </div>
        )}

        {/* GENERAL TAB */}
        {activeTab === 'general' && (
          <div className="space-y-4 overflow-y-auto max-h-[calc(100vh-200px)] pb-4">
            {/* 1. Center Information */}
            <div className="bg-[var(--color-surface-1)] rounded-2xl border border-[var(--color-border-subtle)] card-shadow mb-4">
              <div className="flex items-center gap-4 p-6 border-b border-[var(--color-border-subtle)]">
                <div className="p-2 bg-teal-100 dark:bg-teal-900/30 rounded-xl shrink-0">
                  <Building2 className="w-4 h-4 text-teal-600 dark:text-teal-400" aria-hidden />
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold text-[var(--color-text-primary)]">{t('centerInfo')}</h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{t('centerName')} · {t('centerPhone')}</p>
                </div>
              </div>
              <div className="p-6">
                <div className="flex items-start gap-6 flex-wrap">
                  <div className="relative w-24 h-24 flex-shrink-0">
                    <div className="w-24 h-24 rounded-full bg-[var(--color-surface-2)] border-2 border-[var(--color-border-subtle)] overflow-hidden flex items-center justify-center">
                      {logoUrl ? (
                        <img
                          src={logoUrl}
                          alt={t('centerLogoAlt')}
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
                        <span className="inline-block px-2 py-0.5 bg-teal-600 text-white text-xs rounded-full">
                          {t('logoToastSuccess')}
                        </span>
                      </div>
                    )}
                    {logoToast === 'error' && (
                      <div className="absolute -bottom-1 start-0 end-0 text-center">
                        <span className="inline-block px-2 py-0.5 bg-red-600 text-white text-xs rounded-full">
                          {t('logoToastError')}
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
                      <input type="tel" value={centerPhone} onChange={(e) => setCenterPhone(e.target.value)} dir="ltr" placeholder={t('phonePlaceholder')} className="w-full px-3 py-2 border border-[var(--color-border-subtle)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-[var(--color-surface-1)]" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">{t('district')}</label>
                      <select value={centerDistrict} onChange={(e) => setCenterDistrict(e.target.value)} className="w-full px-3 py-2 border border-[var(--color-border-subtle)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-[var(--color-surface-1)]">
                        <option value="">{t('districtSelectPlaceholder')}</option>
                        {DISTRICT_VALUES.map((d) => (
                          <option key={d} value={d}>
                            {t(`districts.${d}`)}
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-[var(--color-text-secondary)] mt-1">{t('districtHint')}</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">{t('governorate')}</label>
                      <select
                        value={centerGovernorate}
                        onChange={(e) => setCenterGovernorate(e.target.value)}
                        className="w-full px-3 py-2 border border-[var(--color-border-subtle)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-[var(--color-surface-1)]"
                      >
                        <option value="">{t('governorateSelectPlaceholder')}</option>
                        {CENTER_GOVERNORATE_VALUES.map((g) => (
                          <option key={g} value={g}>
                            {t(`governorateOptions.${g}`)}
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-[var(--color-text-secondary)] mt-1">{t('governorateHint')}</p>
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => {
                          handleSaveCenterName();
                          handleSaveCenterPhone();
                          handleSaveCenterDistrict();
                          handleSaveCenterGovernorate();
                        }}
                        className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-lg transition-colors"
                      >
                        {tCommon('save')}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 2. Subject Management */}
            <div className="bg-[var(--color-surface-1)] rounded-2xl border border-[var(--color-border-subtle)] card-shadow mb-4">
              <div className="flex items-center gap-4 p-6 border-b border-[var(--color-border-subtle)]">
                <div className="p-2 bg-teal-100 dark:bg-teal-900/30 rounded-xl shrink-0">
                  <BookOpen className="w-4 h-4 text-teal-600 dark:text-teal-400" aria-hidden />
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold text-[var(--color-text-primary)]">{t('subjects')}</h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{t('subjectName')}</p>
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
            <div className="bg-[var(--color-surface-1)] rounded-2xl border border-[var(--color-border-subtle)] card-shadow mb-4">
              <div className="flex items-center gap-4 p-6 border-b border-[var(--color-border-subtle)]">
                <div className="p-2 bg-teal-100 dark:bg-teal-900/30 rounded-xl shrink-0">
                  <Users className="w-4 h-4 text-teal-600 dark:text-teal-400" aria-hidden />
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold text-[var(--color-text-primary)]">{t('teamMembers')}</h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{t('manageTeamDesc')}</p>
                </div>
              </div>
              <div className="p-6">
                <button type="button" onClick={() => setActiveTab('team')} className="flex items-center gap-2 px-4 py-2 border border-slate-300 hover:bg-[var(--color-surface-0)] text-[var(--color-text-primary)] text-sm font-semibold rounded-lg transition-colors w-fit">
                  <Users className="w-4 h-4" /> {t('manageTeam')}{' '}
                  <DirectionalIcon icon={ChevronRight} className="inline w-4 h-4 ms-1 align-middle" />
                </button>
              </div>
            </div>

            {/* 4. Scanner Settings */}
            <div className="bg-[var(--color-surface-1)] rounded-2xl border border-[var(--color-border-subtle)] card-shadow mb-4">
              <div className="flex items-center gap-4 p-6 border-b border-[var(--color-border-subtle)]">
                <div className="p-2 bg-teal-100 dark:bg-teal-900/30 rounded-xl shrink-0">
                  <QrCode className="w-4 h-4 text-teal-600 dark:text-teal-400" aria-hidden />
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold text-[var(--color-text-primary)]">{t('scannerTitle')}</h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{t('defaultMode')}</p>
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
            <div className="bg-[var(--color-surface-1)] rounded-2xl border border-[var(--color-border-subtle)] card-shadow mb-4">
              <div className="flex items-center gap-4 p-6 border-b border-[var(--color-border-subtle)]">
                <div className="p-2 bg-teal-100 dark:bg-teal-900/30 rounded-xl shrink-0">
                  <MessageCircle className="w-4 h-4 text-teal-600 dark:text-teal-400" aria-hidden />
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold text-[var(--color-text-primary)]">{t('dailySummary')}</h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{t('dailySummaryDesc')}</p>
                </div>
              </div>
              <div className="p-6">
                <div className="flex items-center justify-between gap-4">
                  <div id={dailySummarySwitchId} className="min-w-0">
                    <p className="text-sm font-medium text-[var(--color-text-primary)]">{t('dailySummaryToggle')}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{t('dailySummaryDesc')}</p>
                  </div>
                  <SettingsSwitch
                    checked={dailySummaryEnabled}
                    onCheckedChange={handleDailySummaryToggle}
                    aria-labelledby={dailySummarySwitchId}
                  />
                </div>
              </div>
            </div>

            {/* 4c. Summer mode */}
            <div className="bg-[var(--color-surface-1)] rounded-2xl border border-[var(--color-border-subtle)] card-shadow mb-4">
              <div className="flex items-center gap-4 p-6 border-b border-[var(--color-border-subtle)]">
                <div className="p-2 bg-teal-100 dark:bg-teal-900/30 rounded-xl shrink-0">
                  <Calendar className="w-4 h-4 text-teal-600 dark:text-teal-400" aria-hidden />
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold text-[var(--color-text-primary)]">{t('summerMode')}</h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{t('summerModeDesc')}</p>
                </div>
              </div>
              <div className="p-6">
                <div className="flex items-center justify-between gap-4">
                  <div id={summerSwitchId} className="min-w-0">
                    <p className="text-sm font-medium text-[var(--color-text-primary)]">{t('summerModeToggle')}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{t('summerModeDesc')}</p>
                  </div>
                  <SettingsSwitch
                    checked={summerModeEnabled}
                    onCheckedChange={handleSummerModeToggle}
                    aria-labelledby={summerSwitchId}
                  />
                </div>
              </div>
            </div>

            {/* Financial Settings (owner - InstaPay for withdrawals) */}
            {currentUser?.role === 'owner' || currentUser?.role === 'super_admin' ? (
              <div className="bg-[var(--color-surface-1)] dark:bg-slate-800 rounded-2xl border border-[var(--color-border-subtle)] p-6 mb-4 card-shadow">
                <div className="flex items-center gap-4 mb-6">
                  <div className="p-2 bg-teal-100 dark:bg-teal-900/30 rounded-xl shrink-0">
                    <Wallet className="w-4 h-4 text-teal-600 dark:text-teal-400" aria-hidden />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-semibold text-[var(--color-text-primary)]">{t('financialSettingsTitle')}</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{t('financialSettingsSubtitle')}</p>
                  </div>
                </div>
                <div className="space-y-3">
                  <label className="block text-sm font-medium text-[var(--color-text-primary)]" htmlFor="instapay-input">
                    {t('instapayNumber')}
                  </label>
                  {instapayStored && !instapayEditing ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <span
                        className="font-mono text-[var(--color-text-primary)] px-3 py-2 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border-subtle)]"
                        dir="ltr"
                      >
                        {maskInstapayDisplay(instapayStored)}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setInstapayError('');
                          setInstapayDraft(instapayStored);
                          setInstapayEditing(true);
                        }}
                        className="px-4 py-2 border border-[var(--color-border-subtle)] text-[var(--color-text-primary)] text-sm font-semibold rounded-lg hover:bg-[var(--color-surface-0)] transition-colors"
                      >
                        {t('editInstapay')}
                      </button>
                    </div>
                  ) : (
                    <input
                      id="instapay-input"
                      type="tel"
                      inputMode="numeric"
                      autoComplete="off"
                      dir="ltr"
                      placeholder={t('instapayPlaceholder')}
                      value={instapayDraft}
                      onChange={(e) => setInstapayDraft(e.target.value)}
                      className="w-full max-w-md px-3 py-2 border border-[var(--color-border-subtle)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-[var(--color-surface-1)] font-mono"
                    />
                  )}
                  {instapayError ? (
                    <p className="text-sm text-red-600 dark:text-red-400" role="alert">
                      {instapayError}
                    </p>
                  ) : null}
                  {(instapayEditing || !instapayStored) && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      <button
                        type="button"
                        disabled={instapaySaving}
                        onClick={() => void handleSaveInstapay()}
                        className="px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors"
                      >
                        {instapaySaving ? tCommon('loading') : tCommon('save')}
                      </button>
                      {instapayStored && instapayEditing ? (
                        <button
                          type="button"
                          disabled={instapaySaving}
                          onClick={() => {
                            setInstapayEditing(false);
                            setInstapayDraft('');
                            setInstapayError('');
                          }}
                          className="px-4 py-2 border border-[var(--color-border-subtle)] text-sm font-semibold rounded-lg text-[var(--color-text-primary)] hover:bg-[var(--color-surface-0)]"
                        >
                          {tCommon('cancel')}
                        </button>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {/* 5. Referral Program */}
            <div className="bg-[var(--color-surface-1)] rounded-2xl border border-[var(--color-border-subtle)] card-shadow mb-4">
              <div className="flex items-center gap-4 p-6 border-b border-[var(--color-border-subtle)]">
                <div className="p-2 bg-teal-100 dark:bg-teal-900/30 rounded-xl shrink-0">
                  <Gift className="w-4 h-4 text-teal-600 dark:text-teal-400" aria-hidden />
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold text-[var(--color-text-primary)]">{tReferral('title')}</h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                    {tReferral('shareText', {
                      p25: formatNumber(25, locale),
                      p10: formatNumber(10, locale),
                      p5: formatNumber(5, locale),
                    })}
                  </p>
                </div>
              </div>
              <div className="p-6">
              {referralData && (
                <>
                  <div className="flex flex-wrap items-center gap-3 p-4 bg-[var(--color-surface-0)] rounded-xl border border-[var(--color-border-subtle)] mb-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-[var(--color-text-secondary)] mb-1">{tReferral('yourCode')}</p>
                      <p className="text-2xl font-bold text-teal-600 dark:text-teal-400 font-mono tracking-widest break-all">
                        {referralData.referralCode || tCommon('notAvailable')}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        if (referralData.referralCode) {
                          await navigator.clipboard.writeText(referralData.referralCode);
                          setReferralCopied(true);
                          setTimeout(() => setReferralCopied(false), 2000);
                        }
                      }}
                      className="flex items-center gap-2 px-4 py-2 border border-slate-300 dark:border-slate-600 hover:bg-[var(--color-surface-1)] text-[var(--color-text-primary)] text-sm font-semibold rounded-lg transition-colors shrink-0"
                    >
                      <Copy className="w-4 h-4 shrink-0" aria-hidden />
                      {referralCopied ? tReferral('copied') : tReferral('copyCode')}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => router.push(`/${locale}/settings/referrals`)}
                    className="flex items-center gap-2 px-4 py-2 border border-teal-600 text-teal-600 dark:text-teal-400 rounded-lg text-sm hover:bg-teal-50 dark:hover:bg-teal-950/40 transition-colors"
                  >
                    {t('manageReferrals')}
                  </button>
                  <p className="text-sm text-[var(--color-text-secondary)] mb-2">
                    {tReferral('referralRateDescription', {
                      p25: formatNumber(25, locale),
                      p10: formatNumber(10, locale),
                      p5: formatNumber(5, locale),
                    })}
                  </p>
                  <p className="text-xs text-[var(--color-text-secondary)] mb-2">
                    {t('totalReferrals')}: {formatNumber(referralData.rewards?.length ?? 0, locale)} | {t('totalEarned')}:{' '}
                    <span dir="ltr" className="tabular-nums inline-block">
                      {formatCurrency(Number(referralData.totalEarned || 0), locale)}
                    </span>
                  </p>
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
                                <td className="py-2 font-mono text-[var(--color-text-primary)]" dir="ltr">
                                  {formatCurrency(Number(r.reward_amount), locale)}
                                </td>
                                <td className="py-2"><span className={`px-2 py-0.5 text-xs font-medium rounded-full ${r.reward_status === 'paid' ? 'badge-confirmed' : r.reward_status === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-muted text-[var(--color-text-secondary)]'}`}>{r.reward_status}</span></td>
                                <td className="py-2 text-[var(--color-text-secondary)]">
                                  {formatDate(r.created_at, locale, {
                                    dateStyle: 'medium',
                                  })}
                                </td>
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

            <Link
              href="/settings/billing"
              className="group flex items-center gap-4 w-full p-6 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] card-shadow btn-lift mb-4 text-start transition-colors hover:border-teal-500/30"
            >
              <div className="p-2 bg-teal-100 dark:bg-teal-900/30 rounded-xl shrink-0">
                <CreditCard className="w-5 h-5 text-teal-600 dark:text-teal-400" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold text-[var(--color-text-primary)]">{t('billingCardTitle')}</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{t('billingDesc')}</p>
              </div>
              <DirectionalIcon icon={ChevronRight} className="w-6 h-6 text-teal-600 dark:text-teal-400 shrink-0" aria-hidden />
            </Link>

            {/* 7. WhatsApp Support */}
            <div className="bg-[var(--color-surface-1)] rounded-2xl border border-[var(--color-border-subtle)] card-shadow mb-4">
              <div className="flex items-center gap-4 p-6 border-b border-[var(--color-border-subtle)]">
                <div className="p-2 bg-teal-100 dark:bg-teal-900/30 rounded-xl shrink-0">
                  <MessageCircle className="w-4 h-4 text-teal-600 dark:text-teal-400" aria-hidden />
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold text-[var(--color-text-primary)]">{tBilling('whatsappSupport')}</h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{tBilling('contactSupportViaWhatsapp')}</p>
                </div>
              </div>
              <div className="p-6">
                <p className="text-sm text-[var(--color-text-secondary)] mb-3" dir="ltr">
                  {t('supportContact', {
                    email: 'support@centerhq.com',
                    phone: getSupportWhatsAppDisplayLabel() || '—',
                  })}
                </p>
                {getSupportWhatsAppWaMeBase() ? (
                  <a
                    href={getSupportWhatsAppWaMeBase()}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-teal-600 hover:bg-teal-700 text-white rounded-lg px-4 py-2 text-sm font-medium flex items-center gap-2 transition-colors btn-lift"
                  >
                    <MessageCircle className="w-4 h-4 shrink-0" aria-hidden />
                    {t('chatOnWhatsapp')}
                  </a>
                ) : null}
              </div>
            </div>

            {/* 8. Account */}
            <div className="bg-[var(--color-surface-1)] rounded-2xl border border-[var(--color-border-subtle)] card-shadow mb-4">
              <div className="flex items-center gap-4 p-6 border-b border-[var(--color-border-subtle)]">
                <div className="p-2 bg-teal-100 dark:bg-teal-900/30 rounded-xl shrink-0">
                  <Shield className="w-4 h-4 text-teal-600 dark:text-teal-400" aria-hidden />
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold text-[var(--color-text-primary)]">{t('account')}</h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{tBilling('securityAndSignOut')}</p>
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
                    {limits && (
                      <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">
                        {t('teamMembersCount', {
                          current: formatNumber(teamMembers.length, locale),
                          max: formatNumber(limits.maxTeachers, locale),
                        })}
                      </p>
                    )}
                  </div>
                  <button onClick={() => { setInviteRole('assistant'); setInviteTeacherGroupIds([]); setInvitePerms({ can_scan: true, can_view_payments: true, can_view_dashboard: true, can_manage_students: false, can_manage_groups: false, can_view_settings: false }); setShowInviteModal(true); }} disabled={limits ? !limits.canAddTeacher : false} className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors"><UserPlus className="w-4 h-4" /> {t('inviteMemberPlus')}</button>
                </div>

                {lastInvitePassword && (
                  <div className="p-4 bg-teal-50 dark:bg-teal-950/40 rounded-xl border border-teal-500/30 text-sm text-teal-800 dark:text-teal-200 mb-4">
                    <p className="font-medium">{t('inviteSuccess')}</p>
                    <p className="mt-1">{t('passwordIs', { password: lastInvitePassword })}</p>
                  </div>
                )}

                <div className="bg-[var(--color-surface-1)] rounded-2xl overflow-hidden border border-[var(--color-border-subtle)] card-shadow">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-0)]">
                          <th className="px-4 py-3 text-start text-xs font-semibold text-[var(--color-text-secondary)] uppercase">{t('inviteName')}</th>
                          <th className="px-4 py-3 text-start text-xs font-semibold text-[var(--color-text-secondary)] uppercase">{t('teamMemberPhone')}</th>
                          <th className="px-4 py-3 text-start text-xs font-semibold text-[var(--color-text-secondary)] uppercase">{t('role')}</th>
                          <th className="px-4 py-3 text-start text-xs font-semibold text-[var(--color-text-secondary)] uppercase">{t('permissions')}</th>
                          <th className="px-4 py-3 text-start text-xs font-semibold text-[var(--color-text-secondary)] uppercase">{tCommon('status')}</th>
                          <th className="px-4 py-3 text-start text-xs font-semibold text-[var(--color-text-secondary)] uppercase">{tCommon('actions')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {teamMembers.map((member) => {
                          const isSelf = member.id === userId;
                          const isPermReadOnly = isOwner(member) || isSelf;
                          const permChecked = (k: string) => isOwner(member) ? true : (assistantPermissions[member.id]?.[k] ?? false);
                          const PERM_CHIPS: { key: string; emoji: string; labelKey: 'canScan' | 'canViewPayments' | 'canViewDashboard' | 'canManageStudents' | 'canManageGroups' | 'canViewSettings' }[] = [
                            { key: 'can_scan', emoji: '📷', labelKey: 'canScan' },
                            { key: 'can_view_payments', emoji: '💳', labelKey: 'canViewPayments' },
                            { key: 'can_view_dashboard', emoji: '📊', labelKey: 'canViewDashboard' },
                            { key: 'can_manage_students', emoji: '👥', labelKey: 'canManageStudents' },
                            { key: 'can_manage_groups', emoji: '📚', labelKey: 'canManageGroups' },
                            { key: 'can_view_settings', emoji: '⚙️', labelKey: 'canViewSettings' },
                          ];
                          return (
                            <tr key={member.id} className={member.is_active === false ? 'opacity-60' : ''}>
                              <td className="px-4 py-3 font-medium text-[var(--color-text-primary)]">
                                {member.name || tCommon('notAvailable')}
                                {isSelf && (
                                  <span className="text-xs text-[var(--color-text-secondary)] ms-1">({t('you')})</span>
                                )}
                              </td>
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
                                    <div className="mt-3 pt-3 border-t border-[var(--color-border-subtle)]">
                                      <p className="text-xs font-semibold text-[var(--color-text-secondary)] mb-2 uppercase tracking-wide">{t('sensitivePermissions')}</p>
                                      <StaffMemberCard
                                        userId={member.id}
                                        role={member.role}
                                        permissions={assistantPermissions[member.id] as Partial<Record<CenterPermission, boolean>> ?? {}}
                                        visibleFlags={SIX_NEW_FLAGS}
                                        onUpdate={(flag, value) => setAssistantPermissions(prev => ({
                                          ...prev,
                                          [member.id]: { ...prev[member.id], [flag]: value },
                                        }))}
                                      />
                                    </div>
                                    <button type="button" onClick={() => setEditingPermissionsId(null)} className="text-xs text-teal-600 hover:underline">{tCommon('cancel')}</button>
                                  </div>
                                ) : (
                                  <div className="flex flex-wrap gap-1">
                                    {PERM_CHIPS.map(({ key, emoji, labelKey }) => (
                                      <span
                                        key={key}
                                        className={`px-1.5 py-0.5 rounded text-xs font-medium ${permChecked(key) ? 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200' : 'bg-[var(--color-surface-2)] text-slate-400'}`}
                                        title={t(labelKey)}
                                      >
                                        {emoji}
                                      </span>
                                    ))}
                                    {canEditPermissions(member) && <button type="button" onClick={() => setEditingPermissionsId(member.id)} className="text-teal-600 hover:underline text-xs ms-1">{t('editPermissions')}</button>}
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${member.is_active !== false ? 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200' : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200'}`}>
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
                            <td className="px-4 py-3 text-[var(--color-text-secondary)]">-</td>
                            <td className="px-4 py-3 font-mono text-[var(--color-text-secondary)]" dir="ltr">{inv.phone}</td>
                            <td className="px-4 py-3"><RoleBadge role={inv.role} /></td>
                            <td className="px-4 py-3">-</td>
                            <td className="px-4 py-3"><span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">{t('pendingInvite')}</span></td>
                            <td className="px-4 py-3">-</td>
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
                <div><label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">{t('invitePhone')}</label><input type="tel" value={invitePhone} onChange={(e) => { let v = e.target.value.replace(/\D/g, ''); if (v.startsWith('0') && v.length > 1) v = v.substring(1); setInvitePhone(v); setInviteError(''); }} placeholder={t('phonePlaceholder')} dir="ltr" className="w-full px-3 py-2 border border-[var(--color-border-subtle)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-[var(--color-surface-1)]" required /></div>
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
