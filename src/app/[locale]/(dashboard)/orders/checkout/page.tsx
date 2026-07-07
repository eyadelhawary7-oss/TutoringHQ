'use client';

import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { EGYPT_GOVERNORATES, governorateLabel } from '@/lib/egyptGovernorates';
import { normalizePhone, isValidEgyptianMobileE164 } from '@/lib/utils/phone';
import { formatCurrency } from '@/lib/formatNumber';
import { getShippingFee, formatShippingZoneForLocale, getShippingZone } from '@/lib/bostaShipping';
import { patchCardOrderCart } from '@/lib/card-order-cart/patchCartClient';
import { useCardOrderCart } from '@/hooks/useCardOrderCart';
import { useCheckoutRates } from './CheckoutShell';

function phoneDisplayFromE164(raw: string | null | undefined): string {
  if (!raw?.trim()) return '';
  const n = normalizePhone(raw);
  const m = /^\+20(1\d{9})$/.exec(n);
  if (!m) return raw.trim();
  return `+20 ${m[1]}`;
}

function buildSchema(t: (k: string) => string) {
  return z.object({
    delivery_governorate: z.string().trim().min(1, { message: t('errors.governorate') }),
    delivery_address: z
      .string()
      .trim()
      .min(5, { message: t('errors.addressMin') })
      .max(200, { message: t('errors.addressMax') }),
    delivery_phone: z
      .string()
      .trim()
      .min(1, { message: t('errors.phoneRequired') })
      .refine((v) => isValidEgyptianMobileE164(normalizePhone(v)), { message: t('errors.phoneInvalid') }),
    notes: z.string().trim().max(200, { message: t('errors.notesMax') }).optional(),
  });
}

type CenterDefaults = { governorate: string; street: string; phone: string };

export default function CheckoutDeliveryPage() {
  const t = useTranslations('checkout.delivery');
  const router = useRouter();
  const locale = useLocale();
  const localeShort: 'en' | 'ar' = locale.startsWith('ar') ? 'ar' : 'en';
  const { cart, loading: cartLoading } = useCardOrderCart();
  const rates = useCheckoutRates();

  const [centerDefaults, setCenterDefaults] = useState<CenterDefaults | null>(null);
  const [gov, setGov] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [saveDefaults, setSaveDefaults] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const hydratedForCart = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session || cancelled) return;
      const res = await fetch('/api/me', { headers: { Authorization: `Bearer ${session.access_token}` } });
      if (!res.ok || cancelled) {
        if (!cancelled) setCenterDefaults({ governorate: '', street: '', phone: '' });
        return;
      }
      const data = (await res.json()) as {
        user?: {
          center?: {
            governorate?: string | null;
            phone?: string | null;
            delivery_address?: { street?: unknown } | null;
          } | null;
        };
      };
      const c = data.user?.center;
      const street =
        c?.delivery_address && typeof c.delivery_address === 'object' && c.delivery_address !== null
          ? String((c.delivery_address as { street?: unknown }).street ?? '')
          : '';
      if (!cancelled) {
        setCenterDefaults({
          governorate: c?.governorate?.trim() ?? '',
          street: street.trim(),
          phone: c?.phone?.trim() ?? '',
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!cart || cartLoading || !centerDefaults) return;
    if (hydratedForCart.current === cart.id) return;
    hydratedForCart.current = cart.id;
    setGov(cart.delivery_governorate?.trim() || centerDefaults.governorate || '');
    setAddress(cart.delivery_address?.trim() || centerDefaults.street || '');
    setPhone(phoneDisplayFromE164(cart.delivery_phone || centerDefaults.phone || ''));
    setNotes(cart.notes?.trim() || '');
  }, [cart, cartLoading, centerDefaults]);

  useEffect(() => {
    return () => {
      hydratedForCart.current = null;
    };
  }, []);

  const shipFee = gov.trim() ? getShippingFee(gov.trim(), rates ?? undefined) : null;
  const zoneLabel = formatShippingZoneForLocale(getShippingZone(gov.trim() || undefined, rates ?? undefined), locale);

  async function onContinue(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    const parsed = buildSchema((k) => t(k as 'errors.governorate')).safeParse({
      delivery_governorate: gov,
      delivery_address: address,
      delivery_phone: phone,
      notes: notes || undefined,
    });
    if (!parsed.success) {
      const flat = parsed.error.flatten().fieldErrors;
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(flat)) {
        if (v?.[0]) next[k] = v[0];
      }
      setErrors(next);
      return;
    }

    setSubmitting(true);
    try {
      await patchCardOrderCart({
        delivery_governorate: parsed.data.delivery_governorate,
        delivery_address: parsed.data.delivery_address,
        delivery_phone: normalizePhone(parsed.data.delivery_phone),
        notes: parsed.data.notes?.trim() ? parsed.data.notes.trim() : null,
        save_delivery_defaults: saveDefaults,
      });
      router.push('/orders/checkout/customize');
    } catch (err) {
      setErrors({ form: err instanceof Error ? err.message : t('errors.generic') });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6" data-testid="checkout-delivery">
      <div>
        <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{t('title')}</h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">{t('subtitle')}</p>
      </div>

      <form onSubmit={onContinue} className="space-y-4 max-w-xl">
        <div>
          <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">{t('governorate')}</label>
          <select
            data-testid="checkout-governorate"
            className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-3 py-2 text-sm"
            value={gov}
            onChange={(e) => setGov(e.target.value)}
            required
          >
            <option value="">{t('governoratePlaceholder')}</option>
            {EGYPT_GOVERNORATES.map((g) => (
              <option key={g.value} value={g.value}>
                {governorateLabel(g, localeShort)}
              </option>
            ))}
          </select>
          {errors.delivery_governorate ? <p className="text-xs text-red-600 mt-1">{errors.delivery_governorate}</p> : null}
          {gov.trim() && shipFee != null ? (
            <p className="text-sm text-teal-700 mt-2 font-medium">
              {t('shippingPreview', { amount: formatCurrency(shipFee, locale) })}
            </p>
          ) : null}
          {gov.trim() && zoneLabel ? (
            <p className="text-[11px] text-[var(--color-text-tertiary)] mt-0.5">{zoneLabel}</p>
          ) : null}
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">{t('address')}</label>
          <textarea
            data-testid="checkout-address"
            className="w-full min-h-[100px] rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-3 py-2 text-sm"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            maxLength={200}
          />
          {errors.delivery_address ? <p className="text-xs text-red-600 mt-1">{errors.delivery_address}</p> : null}
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">{t('phone')}</label>
          <input
            data-testid="checkout-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder={t('phonePlaceholder')}
            className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-3 py-2 text-sm"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          {errors.delivery_phone ? <p className="text-xs text-red-600 mt-1">{errors.delivery_phone}</p> : null}
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">{t('notes')}</label>
          <textarea
            className="w-full min-h-[72px] rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-3 py-2 text-sm"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={200}
          />
          {errors.notes ? <p className="text-xs text-red-600 mt-1">{errors.notes}</p> : null}
        </div>

        <label className="flex items-start gap-2 text-sm text-[var(--color-text-secondary)] cursor-pointer">
          <input
            type="checkbox"
            className="mt-1 rounded border-[var(--color-border-subtle)]"
            checked={saveDefaults}
            onChange={(e) => setSaveDefaults(e.target.checked)}
          />
          <span>{t('saveDefaults')}</span>
        </label>

        {errors.form ? <p className="text-sm text-red-600">{errors.form}</p> : null}

        <button
          type="submit"
          disabled={submitting || cartLoading}
          className="w-full sm:w-auto px-6 py-3 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-semibold text-sm"
        >
          {submitting ? t('saving') : t('continue')}
        </button>
      </form>
    </div>
  );
}
