'use client';

import Image from 'next/image';
import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useRouter } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { dbSelect, dbInsert, dbUpdate, dbDelete, auditLog } from '@/lib/db-proxy';
import { useUser } from '@/contexts/UserContext';
import { Link } from '@/i18n/routing';
import { PageHeader, RoleBadge } from '@/components/shared';
import PasswordConfirmModal from '@/components/PasswordConfirmModal';
import { Building2, BookOpen, Users, QrCode, Gift, CreditCard, MessageCircle, Shield, Camera, ChevronRight, Copy, KeyRound, LogOut, UserPlus, Pencil, UserX, X, LayoutDashboard, Loader2, Calendar, Smartphone, Package, Wallet } from 'lucide-react';
import { calculatePackCharge } from '@/lib/parent-pack';
import { getAnnouncementCap, PACK_PRICE_PER_PARENT } from '@/lib/parentPack';
import { PARENT_PACK, type PackStatusResponse } from '@/types/parent-pack';
import { useToast } from '@/hooks/useToast';

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
}

interface PendingInvite {
  id?: string;
  phone: string;
  role: string;
  status: string;
}

const ADMIN_NOTIFICATION_PHONE = '201220601410';

function maskInstapayDisplay(digits: string): string {
  const d = digits.replace(/\D/g, '');
  if (d.length !== 11) return '';
  return `${d.slice(0, 2)}XXXXXXXX${d.slice(-2)}`;
}

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

  const [packStatus, setPackStatus] = useState<PackStatusResponse | null>(null);
  const [packLoading, setPackLoading] = useState(false);
  const [packConfirmOpen, setPackConfirmOpen] = useState(false);
  const toast = useToast();

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

  const refreshPackStatus = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      setPackStatus(null);
      return;
    }
    try {
      const res = await fetch('/api/parent-pack/status', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        setPackStatus((await res.json()) as PackStatusResponse);
      } else {
        setPackStatus(null);
      }
    } catch {
      setPackStatus(null);
    }
  }, []);

  useEffect(() => {
    void refreshPackStatus();
  }, [refreshPackStatus]);

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

  const canEnablePack = (center?.status ?? '') === 'active';
  const isPackEnabled = packStatus?.pack_enabled ?? false;
  const activeParentsCount = packStatus?.active_parents ?? 0;
  const monthlyPackCharge = calculatePackCharge(isPackEnabled, activeParentsCount);

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

        <Link
          href="/orders"
          className="flex items-center gap-3 w-full mb-4 px-4 py-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] hover:border-teal-500/30 hover:bg-[var(--color-surface-0)] transition-colors text-[var(--color-text-primary)]"
        >
          <Package className="w-5 h-5 text-teal-600 shrink-0" aria-hidden />
          <span className="font-medium text-sm flex-1 text-start">{tCardOrders('ordersNav')}</span>
          <ChevronRight className="w-4 h-4 text-[var(--color-text-tertiary)] shrink-0" />
        </Link>

        <Link
          href="/whatsapp-pack"
          className="flex items-center gap-3 w-full mb-4 px-4 py-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] hover:border-teal-500/30 hover:bg-[var(--color-surface-0)] transition-colors text-[var(--color-text-primary)]"
        >
          <MessageCircle className="w-5 h-5 text-teal-600 shrink-0" aria-hidden />
          <span className="font-medium text-sm flex-1 text-start">{t('whatsappPack')}</span>
          <ChevronRight className="w-4 h-4 text-[var(--color-text-tertiary)] shrink-0" />
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
            className="inline-flex items-center gap-1 px-4 py-2.5 rounded-xl text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-0)] transition-colors"
          >
            {t('billing')}
            <ChevronRight className="w-4 h-4" aria-hidden />
          </Link>
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

            {/* Financial Settings (owner — InstaPay for withdrawals) */}
            {currentUser?.role === 'owner' ? (
              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-[var(--color-border-subtle)] p-6 mb-4 shadow-sm">
                <div className="flex items-center gap-4 mb-6">
                  <div className="p-2.5 bg-emerald-100 dark:bg-emerald-900/40 rounded-xl shrink-0">
                    <Wallet className="w-5 h-5 text-emerald-600 dark:text-emerald-400" aria-hidden />
                  </div>
                  <div>
                    <h3 className="font-semibold text-[var(--color-text-primary)]">{t('financialSettingsTitle')}</h3>
                    <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">{t('financialSettingsSubtitle')}</p>
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
                  <p className="text-xs text-[var(--color-text-secondary)] mb-2">
                    {t('totalReferrals')}: {(referralData.rewards?.length ?? 0).toLocaleString('en-US')} | {t('totalEarned')}: {tCommon('egp')}{' '}
                    {Number(referralData.totalEarned || 0).toLocaleString('en-US')}
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
                                <td className="py-2 font-mono text-[var(--color-text-primary)]">{Number(r.reward_amount).toLocaleString('en-US')} EGP</td>
                                <td className="py-2"><span className={`px-2 py-0.5 text-xs font-medium rounded-full ${r.reward_status === 'paid' ? 'badge-confirmed' : r.reward_status === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-muted text-[var(--color-text-secondary)]'}`}>{r.reward_status}</span></td>
                                <td className="py-2 text-[var(--color-text-secondary)]">{new Date(r.created_at).toLocaleDateString('en-US')}</td>
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
                <Link
                  href="/settings/billing"
                  className="flex items-center gap-2 px-4 py-2 border border-slate-300 hover:bg-[var(--color-surface-0)] text-[var(--color-text-primary)] text-sm font-semibold rounded-lg transition-colors w-fit"
                >
                  <CreditCard className="w-4 h-4" /> {tBilling('page.fullManagement')} <ChevronRight className="w-4 h-4 ms-1" />
                </Link>
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

            {/* 9. Parent WA Pack */}
            {(currentUser?.role === 'owner' || currentUser?.role === 'admin') && (
              <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm mb-4">
                <div className="flex items-center gap-4 p-6 border-b border-[var(--color-border-subtle)]">
                  <div className="p-2.5 bg-teal-100 rounded-xl flex-shrink-0">
                    <Smartphone className="w-5 h-5 text-teal-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-[var(--color-text-primary)]">{t('parentPack.packCardTitle')}</h3>
                      <span
                        className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                          isPackEnabled ? 'bg-teal-100 text-teal-800' : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        {isPackEnabled ? t('parentPack.packStatusActive') : t('parentPack.packStatusInactive')}
                      </span>
                    </div>
                    <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">{t('parentPack.enableDescription')}</p>
                    <div className="mt-2 flex flex-wrap gap-3 text-sm text-[var(--color-text-primary)]">
                      <span>
                        {t('parentPack.activeParents')}:{' '}
                        <span className="font-mono font-semibold">{activeParentsCount.toLocaleString('en-US')}</span>
                      </span>
                      <span>
                        {t('parentPack.packMonthlyCostLabel')}:{' '}
                        <span className="font-mono font-semibold" dir="ltr">
                          {(activeParentsCount * PACK_PRICE_PER_PARENT).toLocaleString('en-US')} {tCommon('egp')}
                        </span>
                      </span>
                    </div>
                  </div>
                </div>
                <div className="p-6 space-y-4">
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div>
                      <p className="text-sm font-medium text-[var(--color-text-primary)]">{t('parentPack.enableTitle')}</p>
                      <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">{t('parentPack.enableDescription')}</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isPackEnabled}
                      disabled={!canEnablePack || packLoading}
                      onClick={() => setPackConfirmOpen(true)}
                      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${isPackEnabled ? 'bg-teal-600' : 'bg-slate-200'}`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-[var(--color-surface-1)] shadow ring-0 transition-transform ${isPackEnabled ? 'translate-x-5' : 'translate-x-1'}`}
                      />
                    </button>
                  </div>
                  {!canEnablePack && (
                    <p className="text-sm text-amber-600">{t('parentPack.notActive')}</p>
                  )}
                  {isPackEnabled && (
                    <>
                      <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-0)] p-4 space-y-2 text-sm">
                        <div className="flex justify-between gap-2">
                          <span className="text-[var(--color-text-secondary)]">{t('parentPack.pricePerParent')}</span>
                          <span className="font-mono text-[var(--color-text-primary)]" dir="ltr">
                            EGP {PARENT_PACK.ALL_IN_PRICE.toLocaleString('en-US')} / {tCommon('perMonth')}
                          </span>
                        </div>
                        <div className="flex justify-between gap-2">
                          <span className="text-[var(--color-text-secondary)]">{t('parentPack.suggestedPrice')}</span>
                          <span className="font-mono text-[var(--color-text-primary)]" dir="ltr">
                            EGP {PARENT_PACK.CENTER_CHARGE_TO_PARENT.toLocaleString('en-US')}
                          </span>
                        </div>
                        <div className="flex justify-between gap-2">
                          <span className="text-[var(--color-text-secondary)]">{t('parentPack.yourProfit')}</span>
                          <span className="font-mono text-[var(--color-text-primary)]" dir="ltr">
                            EGP {PARENT_PACK.CENTER_PROFIT_PER_PARENT.toLocaleString('en-US')}
                          </span>
                        </div>
                        <div className="flex justify-between gap-2">
                          <span className="text-[var(--color-text-secondary)]">{t('parentPack.activeParents')}</span>
                          <span className="font-mono text-[var(--color-text-primary)]">
                            {activeParentsCount.toLocaleString('en-US')}
                          </span>
                        </div>
                        <div className="flex justify-between gap-2">
                          <span className="text-[var(--color-text-secondary)]">{t('parentPack.monthlyCharge')}</span>
                          <span className="font-mono text-[var(--color-text-primary)]" dir="ltr">
                            EGP {monthlyPackCharge.toLocaleString('en-US')}
                          </span>
                        </div>
                      </div>
                      <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-0)] p-4">
                        <p className="text-sm font-semibold text-[var(--color-text-primary)]">{t('parentPack.messagesTitle')}</p>
                        <p className="text-xs text-[var(--color-text-secondary)] mt-1 mb-3">{t('parentPack.messagesSubtitle')}</p>
                        <ul className="space-y-2 text-sm text-[var(--color-text-primary)]">
                          <li>
                            <span className="font-medium">{t('parentPack.messages.absence_alert')}</span>
                            <span className="text-[var(--color-text-secondary)]"> — {t('parentPack.messages.absence_alert_timing')}</span>
                          </li>
                          <li>
                            <span className="font-medium">{t('parentPack.messages.balance_statement')}</span>
                            <span className="text-[var(--color-text-secondary)]"> — {t('parentPack.messages.balance_statement_timing')}</span>
                          </li>
                          <li>
                            <span className="font-medium">{t('parentPack.messages.payment_confirmation')}</span>
                            <span className="text-[var(--color-text-secondary)]"> — {t('parentPack.messages.payment_confirmation_timing')}</span>
                          </li>
                          <li>
                            <span className="font-medium">{t('parentPack.messages.term_report')}</span>
                            <span className="text-[var(--color-text-secondary)]"> — {t('parentPack.messages.term_report_timing')}</span>
                          </li>
                          <li>
                            <span className="font-medium">{t('parentPack.messages.announcement')}</span>
                            <span className="text-[var(--color-text-secondary)]"> — {t('parentPack.messages.announcement_timing')}</span>
                          </li>
                        </ul>
                        <p className="text-xs text-[var(--color-text-tertiary)] mt-4">{t('parentPack.platformControls')}</p>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {packConfirmOpen && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4 max-w-sm w-full shadow-lg">
                  <p className="text-sm text-[var(--color-text-primary)] mb-4">
                    {isPackEnabled ? t('parentPack.confirmDisable') : t('parentPack.confirmEnable')}
                  </p>
                  <div className="flex gap-2 justify-end">
                    <button
                      type="button"
                      onClick={() => setPackConfirmOpen(false)}
                      className="rounded-lg border border-[var(--color-border-default)] px-3 py-1.5 text-sm text-[var(--color-text-primary)]"
                    >
                      {tCommon('cancel')}
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        setPackLoading(true);
                        setPackConfirmOpen(false);
                        try {
                          const { data: { session } } = await supabase.auth.getSession();
                          if (!session?.access_token) return;
                          const res = await fetch('/api/settings/parent-pack', {
                            method: 'PATCH',
                            headers: {
                              'Content-Type': 'application/json',
                              Authorization: `Bearer ${session.access_token}`,
                            },
                            body: JSON.stringify({ enabled: !isPackEnabled }),
                          });
                          if (!res.ok) {
                            alert(t('parentPack.toggleError'));
                            return;
                          }
                          const packJson = (await res.json()) as { activeParents?: number };
                          await refreshPackStatus();
                          await refreshUser();
                          if (!isPackEnabled) {
                            toast.success(
                              t('parentPack.packEnabledToast', { count: packJson.activeParents ?? 0 }),
                            );
                          } else {
                            toast.success(t('parentPack.packDisabledToast'));
                          }
                          showSaved();
                        } catch {
                          alert(t('parentPack.toggleError'));
                        } finally {
                          setPackLoading(false);
                        }
                      }}
                      className="rounded-lg bg-teal-600 text-white px-3 py-1.5 text-sm font-medium"
                    >
                      {tCommon('confirm')}
                    </button>
                  </div>
                </div>
              </div>
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
