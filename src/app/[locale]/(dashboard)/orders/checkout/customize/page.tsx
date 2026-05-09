'use client';

import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { Check } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { patchCardOrderCart } from '@/lib/card-order-cart/patchCartClient';
import { useCardOrderCart } from '@/hooks/useCardOrderCart';
import { CardOrderStyleSampleMock } from '@/components/CardOrderStyleSampleMock';

const vendorNotesSchema = z.string().trim().max(200).optional();

export default function CheckoutCustomizePage() {
  const t = useTranslations('checkout.customize');
  const router = useRouter();
  const { cart, loading } = useCardOrderCart();
  const [style, setStyle] = useState<'dark' | 'light'>('dark');
  const [vendorNotes, setVendorNotes] = useState('');
  const [rememberStyle, setRememberStyle] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hydratedForCart = useRef<string | null>(null);

  useEffect(() => {
    if (!cart || loading) return;
    if (hydratedForCart.current === cart.id) return;
    let cancelled = false;
    (async () => {
      let mem: string | null = null;
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) {
        const res = await fetch('/api/me', { headers: { Authorization: `Bearer ${session.access_token}` } });
        if (res.ok && !cancelled) {
          const data = (await res.json()) as { user?: { center?: { last_card_style?: string | null } | null } };
          mem = data.user?.center?.last_card_style ?? null;
        }
      }
      if (cancelled) return;
      hydratedForCart.current = cart.id;
      const fromCart = cart.card_style === 'dark' || cart.card_style === 'light' ? cart.card_style : null;
      const fromCenter = mem === 'dark' || mem === 'light' ? mem : null;
      setStyle(fromCart ?? fromCenter ?? 'dark');
      setVendorNotes(cart.vendor_notes?.trim() ?? '');
    })();
    return () => {
      cancelled = true;
    };
  }, [cart, loading]);

  useEffect(() => {
    return () => {
      hydratedForCart.current = null;
    };
  }, []);

  async function onContinue(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsedNotes = vendorNotesSchema.safeParse(vendorNotes.trim() === '' ? undefined : vendorNotes.trim());
    if (!parsedNotes.success) {
      setError(t('errors.notesMax'));
      return;
    }
    setSubmitting(true);
    try {
      await patchCardOrderCart({
        card_style: style,
        vendor_notes: parsedNotes.data ? parsedNotes.data : null,
        remember_card_style: rememberStyle,
      });
      router.push('/orders/checkout/review');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6" data-testid="checkout-customize">
      <div>
        <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{t('title')}</h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">{t('subtitle')}</p>
      </div>

      <form onSubmit={onContinue} className="space-y-6 max-w-3xl">
        <div>
          <p className="text-sm font-semibold text-[var(--color-text-primary)] mb-3">{t('cardStyle')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {(['dark', 'light'] as const).map((v) => (
              <button
                key={v}
                type="button"
                data-testid={`checkout-style-${v}`}
                onClick={() => setStyle(v)}
                className={cn(
                  'relative rounded-xl border-2 p-3 text-left transition-colors',
                  style === v
                    ? 'border-teal-500 bg-teal-500/10'
                    : 'border-[var(--color-border-subtle)] hover:border-[var(--color-border)]',
                )}
              >
                {style === v ? (
                  <span className="absolute top-2 end-2 flex h-7 w-7 items-center justify-center rounded-full bg-teal-600 text-white">
                    <Check className="h-4 w-4" aria-hidden />
                  </span>
                ) : null}
                <p className="text-sm font-semibold text-[var(--color-text-primary)] mb-2">{t(`styles.${v}`)}</p>
                <CardOrderStyleSampleMock variant={v} className="rounded-lg border border-[var(--color-border-subtle)]" />
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold text-[var(--color-text-primary)] mb-1">{t('vendorNotes')}</label>
          <p className="text-xs text-[var(--color-text-secondary)] mb-2">{t('vendorNotesHint')}</p>
          <textarea
            data-testid="checkout-vendor-notes"
            className="w-full min-h-[88px] rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-3 py-2 text-sm"
            value={vendorNotes}
            onChange={(e) => setVendorNotes(e.target.value)}
            maxLength={200}
          />
        </div>

        <label className="flex items-start gap-2 text-sm text-[var(--color-text-secondary)] cursor-pointer">
          <input
            type="checkbox"
            className="mt-1 rounded border-[var(--color-border-subtle)]"
            checked={rememberStyle}
            onChange={(e) => setRememberStyle(e.target.checked)}
          />
          <span>{t('rememberStyle')}</span>
        </label>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <button
          type="submit"
          disabled={submitting || loading}
          className="px-6 py-3 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-semibold text-sm"
        >
          {submitting ? t('saving') : t('continue')}
        </button>
      </form>
    </div>
  );
}
