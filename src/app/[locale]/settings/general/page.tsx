'use client';

import { useState, useEffect, useRef, useId } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter, Link } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { dbSelect, dbInsert, dbUpdate, dbDelete, auditLog } from '@/lib/db-proxy';
import { useUser } from '@/contexts/UserContext';
import { PageHeader } from '@/components/shared';
import {
  Building2,
  BookOpen,
  Users,
  QrCode,
  Gift,
  CreditCard,
  MessageCircle,
  Shield,
  Camera,
  ChevronRight,
  Copy,
  KeyRound,
  LogOut,
  X,
  Loader2,
  Calendar,
  Package,
  Wallet,
} from 'lucide-react';
import { DirectionalIcon } from '@/components/icons/DirectionalIcon';
import { SettingsSwitch } from '@/components/settings/SettingsSwitch';
import { formatCurrency, formatDate, formatNumber } from '@/lib/formatNumber';
import { signOutToLogin } from '@/lib/auth/sign-out-client';
import { getSupportWhatsAppDisplayLabel, getSupportWhatsAppWaMeBase } from '@/lib/supportWhatsApp';

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

function maskInstapayDisplay(digits: string): string {
  const d = digits.replace(/\D/g, '');
  if (d.length !== 11) return '';
  return `${d.slice(0, 2)}XXXXXXXX${d.slice(-2)}`;
}

const LOGO_MAX_SIZE = 2 * 1024 * 1024;
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

export default function GeneralSettingsPage() {
  const t = useTranslations('settings');
  const tCommon = useTranslations('common');
  const tReferral = useTranslations('referral');
  const tBilling = useTranslations('billing');
  const tCardOrders = useTranslations('cardOrders');
  const tDashboard = useTranslations('dashboard');
  const router = useRouter();
  const locale = useLocale();
  const { user: currentUser, hasPermission, refreshUser } = useUser();
  const isRTL = locale === 'ar';
  const dailySummarySwitchId = useId();
  const summerSwitchId = useId();

  const [center, setCenter] = useState<CenterInfo | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [centerId, setCenterId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPlatformAdminNoCenter, setIsPlatformAdminNoCenter] = useState(false);
  const [savedMessage, setSavedMessage] = useState('');

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
  const [referralData, setReferralData] = useState<{
    referralCode: string;
    rewards: { id: string; referred_center_name: string; referred_center_plan: string; reward_amount: number; reward_status: string; created_at: string }[];
    pending?: { referred_center_name: string; referred_center_plan: string; reward_status: string }[];
    totalEarned: number;
  } | null>(null);
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

  const handleLogout = async () => {
    await signOutToLogin(locale);
  };

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
      if (!session) {
        setIsLoading(false);
        return;
      }
      setUserId(session.user.id);

      const meRes = await fetch('/api/me', { headers: { Authorization: `Bearer ${session.access_token}` } });
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

  // Load referral (owner-only — revenue share)
  useEffect(() => {
    const fetchReferral = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || !centerId) return;
      try {
        const res = await fetch('/api/referral', { headers: { Authorization: `Bearer ${session.access_token}` } });
        if (res.ok) setReferralData(await res.json());
      } catch (err) {
        console.error('Referral fetch error:', err);
      }
    };
    if (centerId && (currentUser?.role === 'owner' || currentUser?.role === 'super_admin')) {
      fetchReferral();
    }
  }, [centerId, currentUser?.role]);

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
      setCenter((prev) => (prev ? { ...prev, phone: centerPhone.trim() || null } : null));
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
      setCenter((prev) => (prev ? { ...prev, district: val } : null));
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
      const { error } = await dbUpdate({
        table: 'centers',
        data: { logo_url: cacheBustedUrl },
        filters: [{ column: 'id', op: 'eq', value: centerId }],
      });
      if (error) {
        console.error('Logo dbUpdate error:', error);
        setLogoUploading(false);
        showLogoToast('error');
        return;
      }
      await auditLog({ centerId, userId, action: 'center_update', entityType: 'centers', details: { field: 'logo' } });
      setLogoUrl(cacheBustedUrl);
      setCenter((prev) => (prev ? { ...prev, logo_url: cacheBustedUrl } : null));
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
      setSubjects((prev) => [...prev, { ...subject, monthly_fee: 0 }]);
      setNewSubjectName('');
      showSaved();
    }
  };

  const handleUpdateSubject = async (id: string) => {
    if (!centerId || !userId) return;
    const { error } = await dbUpdate({ table: 'subjects', data: { name: editName.trim() }, filters: [{ column: 'id', op: 'eq', value: id }] });
    if (!error) {
      await auditLog({ centerId, userId, action: 'subject_update', entityType: 'subjects', entityId: id, details: { name: editName.trim() } });
      setSubjects((prev) => prev.map((s) => (s.id === id ? { ...s, name: editName.trim() } : s)));
      setEditingSubject(null);
      showSaved();
    }
  };

  const handleDeleteSubject = async (id: string) => {
    if (!confirm(t('deleteConfirm')) || !centerId || !userId) return;
    const subj = subjects.find((s) => s.id === id);
    const { data: studentsWithSubject } = await dbSelect({
      table: 'students',
      select: 'id',
      filters: [{ column: 'subject', op: 'eq', value: subj?.name ?? '' }],
      limit: 1,
    });
    if (studentsWithSubject && (studentsWithSubject as unknown[]).length > 0) {
      alert(t('subjectInUse'));
      return;
    }
    const { error } = await dbDelete({ table: 'subjects', filters: [{ column: 'id', op: 'eq', value: id }] });
    if (!error) {
      await auditLog({ centerId, userId, action: 'subject_delete', entityType: 'subjects', entityId: id, details: { name: subj?.name } });
      setSubjects((prev) => prev.filter((s) => s.id !== id));
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
          <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] card-shadow p-6 space-y-4">
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

        {savedMessage && (
          <div className="mb-4 p-3 bg-teal-50 dark:bg-teal-950/40 border border-teal-500/30 text-teal-800 dark:text-teal-200 rounded-xl text-sm text-center">
            {savedMessage}
          </div>
        )}

        <div className="space-y-4 pb-4">
          <Link
            href="/orders"
            className="btn-lift flex items-center gap-3 w-full px-4 py-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] card-shadow hover:border-teal-500/30 hover:bg-[var(--color-surface-0)] transition-colors text-[var(--color-text-primary)]"
          >
            <Package className="w-5 h-5 text-teal-600 shrink-0" aria-hidden />
            <span className="font-medium text-sm flex-1 text-start">{tCardOrders('ordersNav')}</span>
            <DirectionalIcon icon={ChevronRight} className="w-4 h-4 text-[var(--color-text-tertiary)] shrink-0" />
          </Link>

          <Link
            href="/whatsapp-pack"
            className="btn-lift flex items-center gap-3 w-full px-4 py-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] card-shadow hover:border-teal-500/30 hover:bg-[var(--color-surface-0)] transition-colors text-[var(--color-text-primary)]"
          >
            <MessageCircle className="w-5 h-5 text-teal-600 shrink-0" aria-hidden />
            <span className="font-medium text-sm flex-1 text-start">{t('whatsappPack')}</span>
            <DirectionalIcon icon={ChevronRight} className="w-4 h-4 text-[var(--color-text-tertiary)] shrink-0" />
          </Link>

          {/* Center Information */}
          <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] card-shadow mb-4">
            <div className="flex items-center gap-4 p-6 border-b border-[var(--color-border-subtle)]">
              <div className="p-2 bg-teal-100 dark:bg-teal-900/30 rounded-xl shrink-0">
                <Building2 className="w-4 h-4 text-teal-600 dark:text-teal-400" aria-hidden />
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold text-[var(--color-text-primary)]">{t('centerInfo')}</h3>
                <p className="text-sm text-[var(--color-text-muted)] mt-0.5">{t('centerName')} · {t('centerPhone')}</p>
              </div>
            </div>
            <div className="p-6">
              <div className="flex items-start gap-6 flex-wrap">
                <div className="relative w-24 h-24 flex-shrink-0">
                  <div className="w-24 h-24 rounded-full bg-teal-100 dark:bg-teal-900/30 border-2 border-[var(--color-border-subtle)] overflow-hidden flex items-center justify-center">
                    {logoUrl && !logoLoadFailed ? (
                      <img
                        src={logoUrl}
                        alt={t('centerLogoAlt')}
                        className="w-full h-full object-cover"
                        onError={() => setLogoLoadFailed(true)}
                      />
                    ) : (
                      <Building2 className="w-10 h-10 text-teal-600 dark:text-teal-400" aria-hidden />
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
                      <span className="inline-block px-2 py-0.5 bg-teal-600 text-white text-xs rounded-full">{t('logoToastSuccess')}</span>
                    </div>
                  )}
                  {logoToast === 'error' && (
                    <div className="absolute -bottom-1 start-0 end-0 text-center">
                      <span className="inline-block px-2 py-0.5 bg-red-600 text-white text-xs rounded-full">{t('logoToastError')}</span>
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-[200px] space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">{t('centerName')}</label>
                    <input
                      type="text"
                      value={centerName}
                      onChange={(e) => setCenterName(e.target.value)}
                      className="w-full px-3 py-2 border border-[var(--color-border-subtle)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-[var(--color-surface-1)]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">{t('centerPhone')}</label>
                    <input
                      type="tel"
                      value={centerPhone}
                      onChange={(e) => setCenterPhone(e.target.value)}
                      dir="ltr"
                      placeholder={t('phonePlaceholder')}
                      className="w-full px-3 py-2 border border-[var(--color-border-subtle)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-[var(--color-surface-1)]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">{t('district')}</label>
                    <select
                      value={centerDistrict}
                      onChange={(e) => setCenterDistrict(e.target.value)}
                      className="w-full px-3 py-2 border border-[var(--color-border-subtle)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-[var(--color-surface-1)]"
                    >
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

          {/* Subjects */}
          <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] card-shadow mb-4">
            <div className="flex items-center gap-4 p-6 border-b border-[var(--color-border-subtle)]">
              <div className="p-2 bg-teal-100 dark:bg-teal-900/30 rounded-xl shrink-0">
                <BookOpen className="w-4 h-4 text-teal-600 dark:text-teal-400" aria-hidden />
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold text-[var(--color-text-primary)]">{t('subjects')}</h3>
                <p className="text-sm text-[var(--color-text-muted)] mt-0.5">{t('subjectName')}</p>
              </div>
            </div>
            <div className="p-6">
              {currentUser?.role === 'owner' || currentUser?.role === 'super_admin' ? (
                <>
                  <div className="flex flex-wrap gap-2 mb-4">
                    {subjects.map((subject) =>
                      editingSubject === subject.id ? (
                        <div key={subject.id} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="px-3 py-1.5 border border-[var(--color-border-subtle)] rounded-lg text-sm bg-[var(--color-surface-1)]"
                          />
                          <button type="button" onClick={() => handleUpdateSubject(subject.id)} className="text-teal-600 text-sm font-medium hover:underline">
                            {tCommon('save')}
                          </button>
                          <button type="button" onClick={() => setEditingSubject(null)} className="text-[var(--color-text-secondary)] text-sm hover:underline">
                            {tCommon('cancel')}
                          </button>
                        </div>
                      ) : (
                        <span key={subject.id} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[var(--color-surface-2)] text-[var(--color-text-primary)] rounded-full text-sm font-medium">
                          {subject.name}
                          <button
                            type="button"
                            onClick={() => {
                              setEditingSubject(subject.id);
                              setEditName(subject.name);
                            }}
                            className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                          >
                            {tCommon('edit')}
                          </button>
                          <button type="button" onClick={() => handleDeleteSubject(subject.id)} className="hover:text-red-500 transition-colors">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </span>
                      ),
                    )}
                  </div>
                  <form onSubmit={handleAddSubject} className="flex gap-2">
                    <input
                      type="text"
                      value={newSubjectName}
                      onChange={(e) => setNewSubjectName(e.target.value)}
                      placeholder={t('subjectName')}
                      className="flex-1 px-3 py-2 border border-[var(--color-border-subtle)] rounded-lg text-sm bg-[var(--color-surface-1)] focus:outline-none focus:ring-2 focus:ring-teal-500"
                      required
                    />
                    <button type="submit" className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-lg transition-colors">
                      {t('addSubject')}
                    </button>
                  </form>
                </>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2 mb-4">
                    {subjects.map((subject) => (
                      <span key={subject.id} className="inline-flex items-center px-3 py-1.5 bg-[var(--color-surface-2)] text-[var(--color-text-primary)] rounded-full text-sm font-medium">
                        {subject.name}
                      </span>
                    ))}
                  </div>
                  <p className="text-sm text-[var(--color-text-secondary)]">
                    {tDashboard('subjectManagement.ownerOnlyMessage')}
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Team Members shortcut — owner-only */}
          {(currentUser?.role === 'owner' || currentUser?.role === 'super_admin') && (
            <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] card-shadow mb-4">
              <div className="flex items-center gap-4 p-6 border-b border-[var(--color-border-subtle)]">
                <div className="p-2 bg-teal-100 dark:bg-teal-900/30 rounded-xl shrink-0">
                  <Users className="w-4 h-4 text-teal-600 dark:text-teal-400" aria-hidden />
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold text-[var(--color-text-primary)]">{t('teamMembers')}</h3>
                  <p className="text-sm text-[var(--color-text-muted)] mt-0.5">{t('manageTeamDesc')}</p>
                </div>
              </div>
              <div className="p-6">
                <Link
                  href="/settings/team"
                  className="inline-flex items-center gap-2 px-4 py-2 border border-[var(--color-border-default)] hover:bg-[var(--color-surface-0)] text-[var(--color-text-primary)] text-sm font-semibold rounded-lg transition-colors w-fit"
                >
                  <Users className="w-4 h-4" /> {t('manageTeam')}
                  <DirectionalIcon icon={ChevronRight} className="inline w-4 h-4 ms-1 align-middle" />
                </Link>
              </div>
            </div>
          )}

          {/* Scanner Settings */}
          <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] card-shadow mb-4">
            <div className="flex items-center gap-4 p-6 border-b border-[var(--color-border-subtle)]">
              <div className="p-2 bg-teal-100 dark:bg-teal-900/30 rounded-xl shrink-0">
                <QrCode className="w-4 h-4 text-teal-600 dark:text-teal-400" aria-hidden />
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold text-[var(--color-text-primary)]">{t('scannerTitle')}</h3>
                <p className="text-sm text-[var(--color-text-muted)] mt-0.5">{t('defaultMode')}</p>
              </div>
            </div>
            <div className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">{t('defaultMode')}</p>
                  <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">{t('defaultMode')}</p>
                </div>
                <div className="flex gap-1 bg-[var(--color-surface-2)] p-1 rounded-lg">
                  <button
                    type="button"
                    onClick={() => handleScannerMode('camera')}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${scannerMode === 'camera' ? 'bg-[var(--color-surface-1)] shadow-sm text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}
                  >
                    {t('camera')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleScannerMode('bluetooth')}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${scannerMode === 'bluetooth' ? 'bg-[var(--color-surface-1)] shadow-sm text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}
                  >
                    {t('bluetooth')}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Daily WhatsApp Summary */}
          <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] card-shadow mb-4">
            <div className="flex items-center gap-4 p-6 border-b border-[var(--color-border-subtle)]">
              <div className="p-2 bg-teal-100 dark:bg-teal-900/30 rounded-xl shrink-0">
                <MessageCircle className="w-4 h-4 text-teal-600 dark:text-teal-400" aria-hidden />
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold text-[var(--color-text-primary)]">{t('dailySummary')}</h3>
                <p className="text-sm text-[var(--color-text-muted)] mt-0.5">{t('dailySummaryDesc')}</p>
              </div>
            </div>
            <div className="p-6">
              <div className="flex items-center justify-between gap-4">
                <div id={dailySummarySwitchId} className="min-w-0">
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">{t('dailySummaryToggle')}</p>
                  <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{t('dailySummaryDesc')}</p>
                </div>
                <SettingsSwitch
                  checked={dailySummaryEnabled}
                  onCheckedChange={handleDailySummaryToggle}
                  aria-labelledby={dailySummarySwitchId}
                />
              </div>
            </div>
          </div>

          {/* Summer mode */}
          <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] card-shadow mb-4">
            <div className="flex items-center gap-4 p-6 border-b border-[var(--color-border-subtle)]">
              <div className="p-2 bg-teal-100 dark:bg-teal-900/30 rounded-xl shrink-0">
                <Calendar className="w-4 h-4 text-teal-600 dark:text-teal-400" aria-hidden />
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold text-[var(--color-text-primary)]">{t('summerMode')}</h3>
                <p className="text-sm text-[var(--color-text-muted)] mt-0.5">{t('summerModeDesc')}</p>
              </div>
            </div>
            <div className="p-6">
              <div className="flex items-center justify-between gap-4">
                <div id={summerSwitchId} className="min-w-0">
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">{t('summerModeToggle')}</p>
                  <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{t('summerModeDesc')}</p>
                </div>
                <SettingsSwitch
                  checked={summerModeEnabled}
                  onCheckedChange={handleSummerModeToggle}
                  aria-labelledby={summerSwitchId}
                />
              </div>
            </div>
          </div>

          {/* Financial Settings (owner/super_admin) */}
          {currentUser?.role === 'owner' || currentUser?.role === 'super_admin' ? (
            <div className="bg-[var(--color-surface-1)] dark:bg-slate-800 rounded-xl border border-[var(--color-border-subtle)] p-6 mb-4 card-shadow">
              <div className="flex items-center gap-4 mb-6">
                <div className="p-2 bg-teal-100 dark:bg-teal-900/30 rounded-xl shrink-0">
                  <Wallet className="w-4 h-4 text-teal-600 dark:text-teal-400" aria-hidden />
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold text-[var(--color-text-primary)]">{t('financialSettingsTitle')}</h3>
                  <p className="text-sm text-[var(--color-text-muted)] mt-0.5">{t('financialSettingsSubtitle')}</p>
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

          {/* Referral Program — owner-only (revenue share) */}
          {(currentUser?.role === 'owner' || currentUser?.role === 'super_admin') && (
          <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] card-shadow mb-4">
            <div className="flex items-center gap-4 p-6 border-b border-[var(--color-border-subtle)]">
              <div className="p-2 bg-teal-100 dark:bg-teal-900/30 rounded-xl shrink-0">
                <Gift className="w-4 h-4 text-teal-600 dark:text-teal-400" aria-hidden />
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold text-[var(--color-text-primary)]">{tReferral('title')}</h3>
                <p className="text-sm text-[var(--color-text-muted)] mt-0.5">
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
                      className="flex items-center gap-2 px-4 py-2 border border-[var(--color-border-default)] hover:bg-[var(--color-surface-1)] text-[var(--color-text-primary)] text-sm font-semibold rounded-lg transition-colors shrink-0"
                    >
                      <Copy className="w-4 h-4 shrink-0" aria-hidden />
                      {referralCopied ? tReferral('copied') : tReferral('copyCode')}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => router.push('/settings/referrals')}
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
                                <td className="py-2">
                                  <span
                                    className={`px-2 py-0.5 text-xs font-medium rounded-full ${r.reward_status === 'paid' ? 'badge-confirmed' : r.reward_status === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-muted text-[var(--color-text-secondary)]'}`}
                                  >
                                    {r.reward_status}
                                  </span>
                                </td>
                                <td className="py-2 text-[var(--color-text-secondary)]">
                                  {formatDate(r.created_at, locale, { dateStyle: 'medium' })}
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
          )}

          {/* Billing card */}
          <Link
            href="/settings/billing"
            className="group flex items-center gap-4 w-full p-6 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] card-shadow btn-lift mb-4 text-start transition-colors hover:border-teal-500/30"
          >
            <div className="p-2 bg-teal-100 dark:bg-teal-900/30 rounded-xl shrink-0">
              <CreditCard className="w-5 h-5 text-teal-600 dark:text-teal-400" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-[var(--color-text-primary)]">{t('billingCardTitle')}</h3>
              <p className="text-sm text-[var(--color-text-muted)] mt-0.5">{t('billingDesc')}</p>
            </div>
            <DirectionalIcon icon={ChevronRight} className="w-6 h-6 text-teal-600 dark:text-teal-400 shrink-0" aria-hidden />
          </Link>

          {/* WhatsApp Support */}
          <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] card-shadow mb-4">
            <div className="flex items-center gap-4 p-6 border-b border-[var(--color-border-subtle)]">
              <div className="p-2 bg-teal-100 dark:bg-teal-900/30 rounded-xl shrink-0">
                <MessageCircle className="w-4 h-4 text-teal-600 dark:text-teal-400" aria-hidden />
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold text-[var(--color-text-primary)]">{tBilling('whatsappSupport')}</h3>
                <p className="text-sm text-[var(--color-text-muted)] mt-0.5">{tBilling('contactSupportViaWhatsapp')}</p>
              </div>
            </div>
            <div className="p-6">
              <p className="text-sm text-[var(--color-text-secondary)] mb-3" dir="ltr">
                {t('supportContact', {
                  email: 'support@centerhq.com',
                  phone: getSupportWhatsAppDisplayLabel() || ',',
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

          {/* Account */}
          <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] card-shadow mb-4">
            <div className="flex items-center gap-4 p-6 border-b border-[var(--color-border-subtle)]">
              <div className="p-2 bg-teal-100 dark:bg-teal-900/30 rounded-xl shrink-0">
                <Shield className="w-4 h-4 text-teal-600 dark:text-teal-400" aria-hidden />
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold text-[var(--color-text-primary)]">{t('account')}</h3>
                <p className="text-sm text-[var(--color-text-muted)] mt-0.5">{tBilling('securityAndSignOut')}</p>
              </div>
            </div>
            <div className="p-6">
              <div className="flex items-center gap-3">
                <Link
                  href="/settings/reset-password"
                  className="flex items-center gap-2 px-4 py-2 border border-[var(--color-border-default)] hover:bg-[var(--color-surface-0)] text-[var(--color-text-primary)] text-sm font-semibold rounded-lg transition-colors"
                >
                  <KeyRound className="w-4 h-4" /> {t('resetPassword')}
                </Link>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg transition-colors"
                >
                  <LogOut className="w-4 h-4" /> {t('logout')}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
