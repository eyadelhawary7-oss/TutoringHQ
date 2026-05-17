'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname } from '@/i18n/routing';
import { ArrowDown, ArrowUp, ArrowUpDown, Check } from 'lucide-react';
import { AdminSidebar } from '@/components/AdminSidebar';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { useSidebar } from '@/contexts/SidebarContext';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/useToast';
import { formatDate } from '@/lib/formatNumber';
import { PageHeader } from '@/components/shared';

type VendorRow = {
  id: string;
  name: string;
  whatsapp_number: string;
  pickup_address: string;
  city: string;
  is_active: boolean;
  created_at?: string | null;
};

type VendorSortKey = 'name' | 'whatsapp_number' | 'city' | 'is_active' | 'created_at';

function cmpStr(a: string, b: string, asc: boolean): number {
  const c = a.localeCompare(b, undefined, { sensitivity: 'base' });
  return asc ? c : -c;
}

export default function AdminVendorsClient({ initialVendor }: { initialVendor: VendorRow | null }) {
  const t = useTranslations('admin');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const pathname = usePathname();
  const toast = useToast();
  const { closeMainSidebar } = useSidebar() ?? {};
  const [vendor, setVendor] = useState<VendorRow | null>(initialVendor);
  const [name, setName] = useState(initialVendor?.name ?? '');
  const [whatsapp, setWhatsapp] = useState(initialVendor?.whatsapp_number ?? '');
  const [address, setAddress] = useState(initialVendor?.pickup_address ?? '');
  const [city, setCity] = useState(initialVendor?.city ?? 'Cairo');
  const [isActive, setIsActive] = useState(initialVendor?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const [sortKey, setSortKey] = useState<VendorSortKey>('name');
  const [sortAsc, setSortAsc] = useState(true);

  useEffect(() => {
    if (typeof closeMainSidebar === 'function') closeMainSidebar();
  }, [closeMainSidebar]);

  useEffect(() => {
    setVendor(initialVendor);
    if (initialVendor) {
      setName(initialVendor.name);
      setWhatsapp(initialVendor.whatsapp_number);
      setAddress(initialVendor.pickup_address);
      setCity(initialVendor.city);
      setIsActive(initialVendor.is_active);
    }
  }, [initialVendor]);

  const sortedVendorRows = useMemo(() => {
    const rows = vendor ? [vendor] : [];
    const dir = sortAsc ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (sortKey === 'is_active') {
        const av = a.is_active ? 1 : 0;
        const bv = b.is_active ? 1 : 0;
        return (av - bv) * dir;
      }
      if (sortKey === 'created_at') {
        const at = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bt = b.created_at ? new Date(b.created_at).getTime() : 0;
        return (at - bt) * dir;
      }
      const ak =
        sortKey === 'name'
          ? a.name ?? ''
          : sortKey === 'city'
            ? a.city ?? ''
            : a.whatsapp_number ?? '';
      const bk =
        sortKey === 'name'
          ? b.name ?? ''
          : sortKey === 'city'
            ? b.city ?? ''
            : b.whatsapp_number ?? '';
      return cmpStr(ak, bk, sortAsc);
    });
  }, [vendor, sortKey, sortAsc]);

  const toggleSort = (key: VendorSortKey) => {
    if (sortKey === key) {
      setSortAsc((v) => !v);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const SortIcon = ({ col }: { col: VendorSortKey }) => {
    if (sortKey !== col) {
      return <ArrowUpDown className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)] opacity-40" aria-hidden />;
    }
    if (sortAsc) {
      return <ArrowUp className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-primary)]" aria-hidden />;
    }
    return <ArrowDown className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-primary)]" aria-hidden />;
  };

  const save = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) return;
    setSaving(true);
    try {
      const method = vendor ? 'PATCH' : 'POST';
      const body = vendor
        ? {
            id: vendor.id,
            name: name.trim(),
            whatsapp_number: whatsapp.trim(),
            pickup_address: address.trim(),
            city: city.trim() || 'Cairo',
            is_active: isActive,
          }
        : {
            name: name.trim(),
            whatsapp_number: whatsapp.trim(),
            pickup_address: address.trim(),
            city: city.trim() || 'Cairo',
            is_active: isActive,
          };
      const res = await fetch('/api/admin/vendors', {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { vendor?: VendorRow; error?: string };
      if (!res.ok) {
        toast.error(typeof data.error === 'string' ? data.error : tCommon('errorGeneric'));
        return;
      }
      if (data.vendor) {
        setVendor(data.vendor);
        toast.success(t('vendorSaved'));
      }
    } finally {
      setSaving(false);
    }
  }, [vendor, name, whatsapp, address, city, isActive, toast, t, tCommon]);

  return (
    <div className="-mt-14 flex min-h-0 flex-1 flex-col">
      <AdminHeader />
      <div className="flex min-h-0 min-h-[calc(100vh-3.5rem)] flex-1 md:min-h-[calc(100dvh-3.5rem)]">
        <AdminSidebar activeRoute={pathname} />
        <div className="w-full min-w-0 flex-1 space-y-6 overflow-auto p-6 lg:ms-56">
        <PageHeader title={t('vendorsTitle')} subtitle={t('vendorsSubtitle')} />

        <div className="max-w-lg space-y-4 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-6">
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
              {t('vendorName')}
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
              {t('vendorWhatsapp')}
            </label>
            <input
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]"
              dir="ltr"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
              {t('vendorAddress')}
            </label>
            <textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
              {t('vendorCity')}
            </label>
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-[var(--color-text-primary)] cursor-pointer select-none">
            <span className="relative inline-flex">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="peer h-5 w-5 cursor-pointer appearance-none rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-2)] checked:border-teal-600 checked:bg-teal-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface-1)] transition-colors"
              />
              <Check
                className="pointer-events-none absolute inset-0 m-auto h-3.5 w-3.5 text-white opacity-0 peer-checked:opacity-100 transition-opacity"
                aria-hidden
              />
            </span>
            {t('vendorActive')}
          </label>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !name.trim() || !whatsapp.trim() || !address.trim()}
            className="px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {saving ? t('creating') : t('saveVendor')}
          </button>
        </div>

        <div className="max-w-4xl rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-surface-2)] border-b border-[var(--color-border-subtle)]">
                <tr>
                  <th className="px-4 py-3 text-start">
                    <button
                      type="button"
                      onClick={() => toggleSort('name')}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-widest uppercase text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] btn-press chq-focus rounded-md"
                    >
                      {t('vendorName')}
                      <SortIcon col="name" />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-start">
                    <button
                      type="button"
                      onClick={() => toggleSort('whatsapp_number')}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-widest uppercase text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] btn-press chq-focus rounded-md"
                    >
                      {t('vendorWhatsapp')}
                      <SortIcon col="whatsapp_number" />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-start">
                    <button
                      type="button"
                      onClick={() => toggleSort('city')}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-widest uppercase text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] btn-press chq-focus rounded-md"
                    >
                      {t('vendorCity')}
                      <SortIcon col="city" />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-start">
                    <button
                      type="button"
                      onClick={() => toggleSort('is_active')}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-widest uppercase text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] btn-press chq-focus rounded-md"
                    >
                      {t('vendorActive')}
                      <SortIcon col="is_active" />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-start">
                    <button
                      type="button"
                      onClick={() => toggleSort('created_at')}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-widest uppercase text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] btn-press chq-focus rounded-md"
                    >
                      {tCommon('date')}
                      <SortIcon col="created_at" />
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedVendorRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-[var(--color-text-secondary)]">
                      {t('noVendorYet')}
                    </td>
                  </tr>
                ) : (
                  sortedVendorRows.map((row) => (
                    <tr key={row.id} className="border-t border-[var(--color-border-subtle)]">
                      <td className="px-4 py-3 text-[var(--color-text-primary)] font-medium">{row.name}</td>
                      <td className="px-4 py-3 font-mono text-[var(--color-text-primary)]" dir="ltr">
                        {row.whatsapp_number}
                      </td>
                      <td className="px-4 py-3 text-[var(--color-text-primary)]">{row.city}</td>
                      <td className="px-4 py-3 text-[var(--color-text-primary)]">
                        {row.is_active ? tCommon('active') : tCommon('inactive')}
                      </td>
                      <td className="px-4 py-3 text-[var(--color-text-secondary)] tabular-nums" dir="ltr">
                        {row.created_at
                          ? formatDate(row.created_at, locale, {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                            })
                          : '-'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
