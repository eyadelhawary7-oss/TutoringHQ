'use client';

import { useState, useEffect, useRef } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter, Link } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { dbSelect, dbUpdate, auditLog } from '@/lib/db-proxy';
import { formatNumber } from '@/lib/formatNumber';
import { useUser } from '@/contexts/UserContext';
import { PageHeader } from '@/components/shared';
import { Building2, Camera, ChevronRight, Loader2, Map } from 'lucide-react';
import { DirectionalIcon } from '@/components/icons/DirectionalIcon';

interface CenterInfo {
  id: string;
  name: string;
  logo_url: string | null;
  phone?: string | null;
  district?: string | null;
  governorate?: string | null;
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

export default function CenterInfoSettingsPage() {
  const t = useTranslations('settings');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const locale = useLocale();
  const { user: currentUser, hasPermission, refreshUser } = useUser();
  const isRTL = locale === 'ar';

  const [center, setCenter] = useState<CenterInfo | null>(null);
  const [centerId, setCenterId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [savedMessage, setSavedMessage] = useState('');

  const [centerName, setCenterName] = useState('');
  const [centerPhone, setCenterPhone] = useState('');
  const [centerDistrict, setCenterDistrict] = useState('');
  const [centerGovernorate, setCenterGovernorate] = useState('');
  const [logoLoadFailed, setLogoLoadFailed] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoToast, setLogoToast] = useState<'success' | 'error' | null>(null);
  const [branchCount, setBranchCount] = useState<number | null>(null);

  useEffect(() => {
    if (currentUser && (currentUser.role === 'assistant' || currentUser.role === 'teacher') && !hasPermission('can_view_settings')) {
      router.replace('/dashboard');
    }
  }, [currentUser, hasPermission, router]);

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
      if (!meData?.user?.center_id) {
        setIsLoading(false);
        return;
      }
      const userCenterId = meData.user.center_id;
      setCenterId(userCenterId);

      const { data: centerData } = await dbSelect({
        table: 'centers',
        select: 'id, name, logo_url, phone, district, governorate',
        filters: [{ column: 'id', op: 'eq', value: userCenterId }],
        single: true,
      });
      if (centerData) {
        const c = centerData as CenterInfo;
        setCenter(c);
        setCenterName(c.name || '');
        setCenterPhone(c.phone || '');
        setCenterDistrict(c.district || '');
        setCenterGovernorate(c.governorate || '');
        setLogoUrl(c.logo_url ?? null);
        setLogoLoadFailed(false);
      }

      // Real branch count from the same org-scoped source /branches itself
      // reads - never invented. Single-branch centers (no organization_id)
      // correctly get { branches: [thisCenter] } back, so the row still
      // shows a real "1" rather than being silently skipped.
      try {
        const branchesRes = await fetch('/api/branches', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (branchesRes.ok) {
          const branchesData = (await branchesRes.json()) as { branches?: unknown[] };
          setBranchCount(Array.isArray(branchesData.branches) ? branchesData.branches.length : null);
        }
      } catch {
        setBranchCount(null);
      }

      setIsLoading(false);
    };
    load();
  }, []);

  const showSaved = () => {
    setSavedMessage(t('saved'));
    setTimeout(() => setSavedMessage(''), 2000);
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

  if (isLoading) {
    return (
      <div className="min-h-screen w-full bg-[var(--color-surface-0)]">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-4" aria-busy>
          <div className="skeleton h-8 rounded-xl w-48" />
          <div className="skeleton h-64 rounded-2xl w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-[var(--color-surface-0)] page-enter" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <PageHeader title={t('centerInfo')} />
        <div className="mb-6">
          <Link
            href="/settings/general"
            className="inline-flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            <DirectionalIcon icon={ChevronRight} className="w-4 h-4 rotate-180" />
            {t('title')}
          </Link>
        </div>

        {savedMessage && (
          <div className="mb-4 p-3 bg-teal-50 border border-teal-500/30 text-teal-800 rounded-xl text-sm text-center">
            {savedMessage}
          </div>
        )}

        <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] card-shadow">
          <div className="flex items-center gap-4 p-6 border-b border-[var(--color-border-subtle)]">
            <div className="p-2 bg-teal-100 rounded-xl shrink-0">
              <Building2 className="w-4 h-4 text-teal-600" aria-hidden />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-[var(--color-text-primary)]">{t('centerInfo')}</h3>
              <p className="text-sm text-[var(--color-text-muted)] mt-0.5">{t('centerName')} · {t('centerPhone')}</p>
            </div>
          </div>
          <div className="p-6">
            <div className="flex items-start gap-6 flex-wrap">
              <div className="relative w-24 h-24 flex-shrink-0">
                <div className="w-24 h-24 rounded-full bg-teal-100 border-2 border-[var(--color-border-subtle)] overflow-hidden flex items-center justify-center">
                  {logoUrl && !logoLoadFailed ? (
                    <img
                      src={logoUrl}
                      alt={t('centerLogoAlt')}
                      className="w-full h-full object-cover"
                      onError={() => setLogoLoadFailed(true)}
                    />
                  ) : (
                    <Building2 className="w-10 h-10 text-teal-600" aria-hidden />
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
                    <span className="inline-block px-2 py-0.5 bg-[var(--color-danger)] text-white text-xs rounded-full">{t('logoToastError')}</span>
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
                      showSaved();
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

        {branchCount !== null && (
          <div className="mt-4 bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] card-shadow">
            <Link
              href="/branches"
              className="flex items-center gap-4 p-6 hover:bg-[var(--color-surface-0)] transition-colors rounded-xl"
            >
              <div className="p-2 bg-teal-100 rounded-xl shrink-0">
                <Map className="w-4 h-4 text-teal-600" aria-hidden />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-[var(--color-text-primary)]">{t('manageBranches')}</h3>
              </div>
              <span className="text-sm text-[var(--color-text-muted)] font-medium">{formatNumber(branchCount, locale)}</span>
              <DirectionalIcon icon={ChevronRight} className="w-4 h-4 text-[var(--color-text-muted)] shrink-0" />
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
