'use client';

import { useCallback, useEffect, useState } from 'react';
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
  }, [data?.center?.id]);

  useEffect(() => {
    if (!data) return;
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
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}
