'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname } from '@/i18n/routing';
import { AdminSidebar } from '@/components/AdminSidebar';
import { useSidebar } from '@/contexts/SidebarContext';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/useToast';

type VendorRow = {
  id: string;
  name: string;
  whatsapp_number: string;
  pickup_address: string;
  city: string;
  is_active: boolean;
};

export default function AdminVendorsClient({ initialVendor }: { initialVendor: VendorRow | null }) {
  const t = useTranslations('admin');
  const tCommon = useTranslations('common');
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
    <div className="flex min-h-[calc(100vh-56px)] md:min-h-screen pt-14 lg:pt-0">
      <AdminSidebar activeRoute={pathname} />
      <div className="w-full flex-1 p-6 space-y-6 overflow-auto min-w-0 lg:ms-56">
        <div>
          <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{t('vendorsTitle')}</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">
            {vendor ? '' : t('noVendorYet')}
          </p>
        </div>

        <div className="max-w-lg space-y-4 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-6">
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
              {t('vendorName')}
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-input bg-[var(--color-surface-0)] text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
              {t('vendorWhatsapp')}
            </label>
            <input
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-input bg-[var(--color-surface-0)] text-sm"
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
              className="w-full px-3 py-2 rounded-lg border border-input bg-[var(--color-surface-0)] text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
              {t('vendorCity')}
            </label>
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-input bg-[var(--color-surface-0)] text-sm"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-[var(--color-text-primary)] cursor-pointer">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="rounded border-input"
            />
            {t('vendorActive')}
          </label>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !name.trim() || !whatsapp.trim() || !address.trim()}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
          >
            {saving ? t('creating') : t('saveVendor')}
          </button>
        </div>
      </div>
    </div>
  );
}
