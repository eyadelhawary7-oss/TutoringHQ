'use client';

import { useState, useEffect, useId } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter, Link } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { dbSelect, dbUpdate, auditLog } from '@/lib/db-proxy';
import { useUser } from '@/contexts/UserContext';
import { PageHeader } from '@/components/shared';
import { Wallet, CreditCard, ChevronRight } from 'lucide-react';
import { DirectionalIcon } from '@/components/icons/DirectionalIcon';
import { SettingsSwitch } from '@/components/settings/SettingsSwitch';

function maskInstapayDisplay(digits: string): string {
  const d = digits.replace(/\D/g, '');
  if (d.length !== 11) return '';
  return `${d.slice(0, 2)}XXXXXXXX${d.slice(-2)}`;
}

export default function MoneySettingsPage() {
  const t = useTranslations('settings');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const locale = useLocale();
  const { user: currentUser, hasPermission, refreshUser } = useUser();
  const isRTL = locale === 'ar';
  const cardOrdersSwitchId = useId();

  const [centerId, setCenterId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [cardOrdersEnabled, setCardOrdersEnabled] = useState(false);

  const [instapayStored, setInstapayStored] = useState<string | null>(null);
  const [instapayDraft, setInstapayDraft] = useState('');
  const [instapayEditing, setInstapayEditing] = useState(false);
  const [instapaySaving, setInstapaySaving] = useState(false);
  const [instapayError, setInstapayError] = useState('');

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
        select: 'card_orders_enabled, instapay_number',
        filters: [{ column: 'id', op: 'eq', value: userCenterId }],
        single: true,
      });
      if (centerData) {
        const c = centerData as { card_orders_enabled?: boolean; instapay_number?: string | null };
        setCardOrdersEnabled(c.card_orders_enabled === true);
        const ip = typeof c.instapay_number === 'string' ? c.instapay_number.replace(/\D/g, '') : '';
        setInstapayStored(ip.length === 11 ? ip : null);
      }
      setIsLoading(false);
    };
    load();
  }, []);

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
    } finally {
      setInstapaySaving(false);
    }
  };

  const handleCardOrdersToggle = async (enabled: boolean) => {
    if (!centerId || !userId) return;
    setCardOrdersEnabled(enabled);
    const { error } = await dbUpdate({
      table: 'centers',
      data: { card_orders_enabled: enabled },
      filters: [{ column: 'id', op: 'eq', value: centerId }],
    });
    if (!error) {
      await auditLog({
        centerId,
        userId,
        action: 'center_update',
        entityType: 'centers',
        details: { field: 'card_orders_enabled', value: enabled },
      });
      await refreshUser();
    } else {
      setCardOrdersEnabled(!enabled);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen w-full bg-[var(--color-surface-0)]">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-4" aria-busy>
          <div className="skeleton h-8 rounded-xl w-48" />
          <div className="skeleton h-40 rounded-2xl w-full" />
        </div>
      </div>
    );
  }

  const isOwnerOrAdmin = currentUser?.role === 'owner' || currentUser?.role === 'super_admin';

  return (
    <div className="min-h-screen w-full bg-[var(--color-surface-0)] page-enter" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <PageHeader title={t('billingMoneyTitle')} />
        <div className="mb-6">
          <Link
            href="/settings/general"
            className="inline-flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            <DirectionalIcon icon={ChevronRight} className="w-4 h-4 rotate-180" />
            {t('title')}
          </Link>
        </div>

        <div className="space-y-4">
          {isOwnerOrAdmin ? (
            <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] p-6 card-shadow">
              <div className="flex items-center gap-4 mb-6">
                <div className="p-2 bg-teal-100 rounded-xl shrink-0">
                  <Wallet className="w-4 h-4 text-teal-600" aria-hidden />
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
                  <p className="text-sm text-[var(--color-danger)]" role="alert">
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

          <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] card-shadow">
            <div className="flex items-center gap-4 p-6 border-b border-[var(--color-border-subtle)]">
              <div className="p-2 bg-teal-100 rounded-xl shrink-0">
                <CreditCard className="w-4 h-4 text-teal-600" aria-hidden />
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold text-[var(--color-text-primary)]">{t('cardOrdersTitle')}</h3>
                <p className="text-sm text-[var(--color-text-muted)] mt-0.5">{t('cardOrdersDesc')}</p>
              </div>
            </div>
            <div className="p-6">
              <div className="flex items-center justify-between gap-4">
                <div id={cardOrdersSwitchId} className="min-w-0">
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">{t('cardOrdersToggle')}</p>
                  <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{t('cardOrdersHint')}</p>
                </div>
                <SettingsSwitch
                  checked={cardOrdersEnabled}
                  onCheckedChange={handleCardOrdersToggle}
                  aria-labelledby={cardOrdersSwitchId}
                />
              </div>
            </div>
          </div>

          <Link
            href="/settings/billing"
            className="group flex items-center gap-4 w-full p-6 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] card-shadow btn-lift text-start transition-colors hover:border-teal-500/30"
          >
            <div className="p-2 bg-teal-100 rounded-xl shrink-0">
              <CreditCard className="w-5 h-5 text-teal-600" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-[var(--color-text-primary)]">{t('billingCardTitle')}</h3>
              <p className="text-sm text-[var(--color-text-muted)] mt-0.5">{t('billingDesc')}</p>
            </div>
            <DirectionalIcon icon={ChevronRight} className="w-6 h-6 text-teal-600 shrink-0" aria-hidden />
          </Link>
        </div>
      </div>
    </div>
  );
}
