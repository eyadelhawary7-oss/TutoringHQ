'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/contexts/UserContext';
import Navbar from '@/components/Navbar';
import { Link } from '@/i18n/routing';

type BillingPeriod = 'monthly' | 'quarterly' | 'half_yearly' | 'yearly';
type PlanType = 'starter' | 'pro' | 'enterprise';

const PLAN_NAMES: Record<PlanType, string> = {
  starter: 'starter',
  pro: 'pro',
  enterprise: 'enterprise',
};

const PRICING: Record<PlanType, Record<BillingPeriod, { amount: number; savings?: number }>> = {
  starter: {
    monthly: { amount: 1075 },
    quarterly: { amount: 3000 },
    half_yearly: { amount: 5700, savings: 300 },
    yearly: { amount: 10800, savings: 1200 },
  },
  pro: {
    monthly: { amount: 1935 },
    quarterly: { amount: 5400 },
    half_yearly: { amount: 10260, savings: 540 },
    yearly: { amount: 19440, savings: 2160 },
  },
  enterprise: {
    monthly: { amount: 3763 },
    quarterly: { amount: 10500 },
    half_yearly: { amount: 19950, savings: 1050 },
    yearly: { amount: 37800, savings: 4200 },
  },
};

interface BillingData {
  plan: PlanType;
  billing_period: BillingPeriod;
  billing_amount: number;
  next_billing_date: string | null;
  whatsapp_monthly_charges: {
    individual: number;
    group: number;
    parent_checkup: number;
    total: number;
  };
}

export default function BillingPage() {
  const t = useTranslations('billing');
  const router = useRouter();
  const { user: currentUser } = useUser();
  const [data, setData] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState<BillingPeriod | null>(null);
  const [savedMessage, setSavedMessage] = useState('');

  useEffect(() => {
    if (currentUser?.role === 'assistant') {
      router.replace('/dashboard');
    }
  }, [currentUser, router]);

  useEffect(() => {
    fetchBilling();
  }, []);

  useEffect(() => {
    if (data) setSelectedPeriod(data.billing_period);
  }, [data]);

  async function fetchBilling() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace('/login');
        return;
      }

      const res = await fetch('/api/settings/billing', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        if (res.status === 401) router.replace('/login');
        return;
      }
      const json = await res.json();
      setData(json);
    } catch (err) {
      console.error('Fetch billing error:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!selectedPeriod || selectedPeriod === data?.billing_period || saving) return;

    try {
      setSaving(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch('/api/settings/billing', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ billing_period: selectedPeriod }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to update');
      }
      const json = await res.json();
      setData((prev) =>
        prev
          ? {
              ...prev,
              billing_period: selectedPeriod,
              billing_amount: json.billing_amount ?? prev.billing_amount,
              next_billing_date: json.next_billing_date ?? prev.next_billing_date,
            }
          : null
      );
      setSavedMessage(t('saveSuccess'));
      setTimeout(() => setSavedMessage(''), 2000);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  }

  const planNameKey = data?.plan ? PLAN_NAMES[data.plan] : 'starter';
  const planLabel = t(planNameKey);
  const isOwner = currentUser?.role === 'owner';

  if (loading) {
    return (
      <>
        <Navbar />
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
          <div className="animate-spin h-8 w-8 border-2 border-indigo-600 border-t-transparent rounded-full" />
        </div>
      </>
    );
  }

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="mb-6">
            <Link
              href="/settings"
              className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              ← {t('backToSettings')}
            </Link>
          </div>

          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white mb-6">
            {t('title')}
          </h1>

          {savedMessage && (
            <div className="mb-4 p-3 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-lg text-sm text-center">
              {savedMessage}
            </div>
          )}

          {/* Current plan & billing info */}
          <section className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">
              {t('currentPlan')}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <span className="text-sm text-gray-500 dark:text-gray-400">{t('plan')}</span>
                <p className="font-semibold text-gray-900 dark:text-white">{planLabel}</p>
              </div>
              <div>
                <span className="text-sm text-gray-500 dark:text-gray-400">{t('period')}</span>
                <p className="font-semibold text-gray-900 dark:text-white">
                  {t(data?.billing_period ?? 'quarterly')}
                </p>
              </div>
              <div>
                <span className="text-sm text-gray-500 dark:text-gray-400">{t('amount')}</span>
                <p className="font-semibold text-gray-900 dark:text-white">
                  {data?.billing_amount?.toLocaleString('ar-EG')} {t('egp')}
                </p>
              </div>
              <div>
                <span className="text-sm text-gray-500 dark:text-gray-400">{t('nextDue')}</span>
                <p className="font-semibold text-gray-900 dark:text-white">
                  {data?.next_billing_date
                    ? new Date(data.next_billing_date).toLocaleDateString('ar-EG')
                    : '—'}
                </p>
              </div>
            </div>
          </section>

          {/* Billing period options */}
          <section className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">
              {t('changePeriod')}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Monthly */}
              <button
                type="button"
                onClick={() => isOwner && setSelectedPeriod('monthly')}
                disabled={!isOwner}
                className={`text-start p-4 rounded-xl border-2 transition-all ${
                  selectedPeriod === 'monthly'
                    ? 'border-red-500 bg-red-50 dark:bg-red-900/20'
                    : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                } ${!isOwner ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-gray-900 dark:text-white">{t('monthly')}</span>
                  <span className="text-xs font-medium text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/40 px-2 py-0.5 rounded">
                    +7.5% {t('monthlyFee')}
                  </span>
                </div>
                <p className="text-xl font-bold text-gray-900 dark:text-white">
                  {PRICING[data?.plan ?? 'starter'].monthly.amount.toLocaleString('ar-EG')}{' '}
                  {t('egp')}/{t('perMonth')}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{t('paymentEvery')} 1 {t('perMonth')}</p>
              </button>

              {/* Quarterly - Recommended */}
              <button
                type="button"
                onClick={() => isOwner && setSelectedPeriod('quarterly')}
                disabled={!isOwner}
                className={`text-start p-4 rounded-xl border-2 transition-all ${
                  selectedPeriod === 'quarterly'
                    ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                    : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                } ${!isOwner ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-gray-900 dark:text-white">{t('quarterly')}</span>
                  <span className="text-xs font-medium text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/40 px-2 py-0.5 rounded">
                    {t('recommended')}
                  </span>
                </div>
                <p className="text-xl font-bold text-gray-900 dark:text-white">
                  {PRICING[data?.plan ?? 'starter'].quarterly.amount.toLocaleString('ar-EG')}{' '}
                  {t('egp')}/{t('perQuarter')}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{t('paymentEvery')} 3 {t('perMonth')}</p>
              </button>

              {/* Half-Yearly - 5% discount */}
              <button
                type="button"
                onClick={() => isOwner && setSelectedPeriod('half_yearly')}
                disabled={!isOwner}
                className={`text-start p-4 rounded-xl border-2 transition-all ${
                  selectedPeriod === 'half_yearly'
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                    : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                } ${!isOwner ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-gray-900 dark:text-white">{t('halfYearly')}</span>
                  <span className="text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/40 px-2 py-0.5 rounded">
                    5% {t('discount')}
                  </span>
                </div>
                <p className="text-xl font-bold text-gray-900 dark:text-white">
                  {PRICING[data?.plan ?? 'starter'].half_yearly.amount.toLocaleString('ar-EG')}{' '}
                  {t('egp')}/{t('perHalfYear')}
                </p>
                <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                  {t('save')} {PRICING[data?.plan ?? 'starter'].half_yearly.savings?.toLocaleString('ar-EG')} {t('egp')}
                </p>
              </button>

              {/* Yearly - Best Value */}
              <button
                type="button"
                onClick={() => isOwner && setSelectedPeriod('yearly')}
                disabled={!isOwner}
                className={`text-start p-4 rounded-xl border-2 transition-all ${
                  selectedPeriod === 'yearly'
                    ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20'
                    : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                } ${!isOwner ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-gray-900 dark:text-white">{t('yearly')}</span>
                  <span className="text-xs font-medium text-purple-600 dark:text-purple-400 bg-purple-100 dark:bg-purple-900/40 px-2 py-0.5 rounded">
                    {t('bestValue')}
                  </span>
                </div>
                <p className="text-xl font-bold text-gray-900 dark:text-white">
                  {PRICING[data?.plan ?? 'starter'].yearly.amount.toLocaleString('ar-EG')}{' '}
                  {t('egp')}/{t('perYear')}
                </p>
                <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                  10% {t('discount')} — {t('save')} {PRICING[data?.plan ?? 'starter'].yearly.savings?.toLocaleString('ar-EG')} {t('egp')}
                </p>
              </button>
            </div>

            {isOwner && selectedPeriod !== data?.billing_period && (
              <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-600">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-medium rounded-lg transition-colors"
                >
                  {saving ? t('saving') : t('saveChanges')}
                </button>
              </div>
            )}
          </section>

          {/* WhatsApp add-ons */}
          <section className="bg-white dark:bg-gray-800 rounded-xl shadow p-6">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-2">
              {t('whatsappAddons')}
            </h2>
            <p className="text-sm text-amber-600 dark:text-amber-400 mb-4 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
              ⚠ {t('whatsappNote')}
            </p>
            <div>
              <span className="text-sm text-gray-500 dark:text-gray-400">{t('monthlyCharges')}</span>
              <p className="text-lg font-semibold text-gray-900 dark:text-white mt-1">
                {data?.whatsapp_monthly_charges?.total?.toLocaleString('ar-EG') ?? 0} {t('egp')}/{t('perMonth')}
              </p>
              {(data?.whatsapp_monthly_charges?.individual ?? 0) > 0 && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Individual: {data.whatsapp_monthly_charges.individual} {t('egp')}
                </p>
              )}
              {(data?.whatsapp_monthly_charges?.group ?? 0) > 0 && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Group: {data.whatsapp_monthly_charges.group} {t('egp')}
                </p>
              )}
              {(data?.whatsapp_monthly_charges?.parent_checkup ?? 0) > 0 && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Parent Check-up: {data.whatsapp_monthly_charges.parent_checkup} {t('egp')}
                </p>
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
