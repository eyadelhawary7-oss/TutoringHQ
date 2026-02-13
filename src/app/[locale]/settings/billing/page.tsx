'use client';

import { useState, useEffect, useMemo } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/contexts/UserContext';
import Navbar from '@/components/Navbar';
import { Link } from '@/i18n/routing';

interface PricingPlan {
  id: string;
  name_en: string;
  name_ar: string;
  students_per_week_limit: number;
  monthly_fee: number;
  per_student_at_capacity_egp: number;
  setup_fee_egp: number;
  is_custom: boolean;
}

interface PaygRate {
  min_students_per_week: number;
  max_students_per_week: number;
  rate_per_student_egp: number;
}

const FALLBACK_PLANS: PricingPlan[] = [
  { id: 'starter', name_en: 'Starter', name_ar: 'أساسي', students_per_week_limit: 200, monthly_fee: 4000, per_student_at_capacity_egp: 5, setup_fee_egp: 2500, is_custom: false },
  { id: 'pro', name_en: 'Pro', name_ar: 'محترف', students_per_week_limit: 600, monthly_fee: 7200, per_student_at_capacity_egp: 3, setup_fee_egp: 5000, is_custom: false },
  { id: 'enterprise', name_en: 'Enterprise', name_ar: 'مؤسسات', students_per_week_limit: 1500, monthly_fee: 9000, per_student_at_capacity_egp: 1.5, setup_fee_egp: 10000, is_custom: false },
  { id: 'top_centers', name_en: 'Top Centers', name_ar: 'كبار السناتر', students_per_week_limit: 1500, monthly_fee: 0, per_student_at_capacity_egp: 0, setup_fee_egp: 0, is_custom: true },
];

const FALLBACK_PAYG: PaygRate[] = [
  { min_students_per_week: 0, max_students_per_week: 200, rate_per_student_egp: 6 },
  { min_students_per_week: 201, max_students_per_week: 600, rate_per_student_egp: 3.75 },
  { min_students_per_week: 601, max_students_per_week: 1500, rate_per_student_egp: 2 },
  { min_students_per_week: 1501, max_students_per_week: 10000, rate_per_student_egp: 1.25 },
];

const MONTHLY_MULTIPLIER = 4.333;

/** Graduated (marginal) pricing with 4.333 weekly-to-monthly multiplier */
function calculatePaygCost(rates: PaygRate[], students: number): { weekly: number; monthly: number; effectiveRate: number; breakdown: { from: number; to: number; count: number; rate: number; cost: number }[] } {
  const tierDefs = [
    { upTo: 200, rate: 6.0 },
    { upTo: 600, rate: 3.75 },
    { upTo: 1500, rate: 2.0 },
    { upTo: Infinity, rate: 1.25 },
  ];
  let weeklyCost = 0;
  const breakdown: { from: number; to: number; count: number; rate: number; cost: number }[] = [];
  let remaining = students;
  let prevLimit = 0;

  for (const tier of tierDefs) {
    const studentsInTier = Math.min(remaining, tier.upTo - prevLimit);
    if (studentsInTier <= 0) break;
    const tierCost = studentsInTier * tier.rate;
    weeklyCost += tierCost;
    breakdown.push({ from: prevLimit + 1, to: prevLimit + studentsInTier, count: studentsInTier, rate: tier.rate, cost: tierCost });
    remaining -= studentsInTier;
    prevLimit = tier.upTo;
  }

  const monthly = Math.round(weeklyCost * MONTHLY_MULTIPLIER);
  const effectiveRate = students > 0 ? Math.round((weeklyCost / students) * 100) / 100 : 0;
  return { weekly: weeklyCost, monthly, effectiveRate, breakdown };
}

function getFixedPlanComparison(plans: PricingPlan[], students: number): { planName: string; planNameAr: string; planFee: number; isCustom: boolean } {
  const starter = plans.find(p => p.id === 'starter');
  const pro = plans.find(p => p.id === 'pro');
  const enterprise = plans.find(p => p.id === 'enterprise');
  const top = plans.find(p => p.id === 'top_centers');
  if (students <= 200) return { planName: starter?.name_en ?? 'Starter', planNameAr: starter?.name_ar ?? 'أساسي', planFee: starter?.monthly_fee ?? 4000, isCustom: false };
  if (students <= 600) return { planName: pro?.name_en ?? 'Pro', planNameAr: pro?.name_ar ?? 'محترف', planFee: pro?.monthly_fee ?? 7200, isCustom: false };
  if (students <= 1500) return { planName: enterprise?.name_en ?? 'Enterprise', planNameAr: enterprise?.name_ar ?? 'مؤسسات', planFee: enterprise?.monthly_fee ?? 9000, isCustom: false };
  return { planName: top?.name_en ?? 'Top Centers', planNameAr: top?.name_ar ?? 'كبار السناتر', planFee: 0, isCustom: true };
}

export default function BillingPage() {
  const t = useTranslations('billing');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { user: currentUser } = useUser();
  const [data, setData] = useState<{
    plan: string;
    pricing_type: string;
    billing_type?: string;
    weekly_student_limit: number;
    plans: PricingPlan[];
    payg_rates: PaygRate[];
    current_plan_details?: PricingPlan;
    pending_plan_change?: string;
    pending_billing_type?: string;
    center_name?: string;
    invoices?: { id: string; invoice_number: string; period_start: string; period_end: string; billing_type: string; total_amount: number; status: string; paid_at?: string }[];
    current_usage?: { total_checkins: number; weekly_average: number; estimated_bill: number };
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [paygSlider, setPaygSlider] = useState(200);
  const [savedMessage, setSavedMessage] = useState('');

  useEffect(() => {
    if (currentUser?.role === 'assistant') {
      router.replace('/dashboard');
    }
  }, [currentUser, router]);

  useEffect(() => {
    fetchBilling();
  }, []);

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
        setData({
          plan: 'starter',
          pricing_type: 'fixed',
          weekly_student_limit: 200,
          plans: FALLBACK_PLANS,
          payg_rates: FALLBACK_PAYG,
        });
        return;
      }
      const json = await res.json();
      const plans = (json.plans?.length ? json.plans : FALLBACK_PLANS) as PricingPlan[];
      const paygRates = (json.payg_rates?.length ? json.payg_rates : FALLBACK_PAYG) as PaygRate[];
      setData({
        plan: json.plan || 'starter',
        pricing_type: json.pricing_type || json.billing_type || 'fixed',
        billing_type: json.billing_type || json.pricing_type,
        weekly_student_limit: json.weekly_student_limit ?? 200,
        plans,
        payg_rates: paygRates,
        current_plan_details: json.current_plan_details,
        pending_plan_change: json.pending_plan_change,
        pending_billing_type: json.pending_billing_type,
        center_name: json.center_name,
        invoices: json.invoices || [],
        current_usage: json.current_usage,
      });
      setPaygSlider(json.weekly_student_limit ?? 200);
    } catch (err) {
      console.error('Fetch billing error:', err);
      setData({
        plan: 'starter',
        pricing_type: 'fixed',
        weekly_student_limit: 200,
        plans: FALLBACK_PLANS,
        payg_rates: FALLBACK_PAYG,
      });
    } finally {
      setLoading(false);
    }
  }

  const [changePlanSelect, setChangePlanSelect] = useState('');
  const [paymentRef, setPaymentRef] = useState('');

  async function handleRequestChange() {
    if (!changePlanSelect) return;
    if (saving || currentUser?.role !== 'owner') return;
    try {
      setSaving(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const isPayg = changePlanSelect === 'payg';
      const res = await fetch('/api/settings/billing', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          action: 'request_change',
          new_plan: isPayg ? undefined : changePlanSelect,
          new_billing_type: isPayg ? 'payg' : 'fixed',
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      setData(prev => prev ? {
        ...prev,
        pending_plan_change: changePlanSelect,
        pending_billing_type: isPayg ? 'payg' : 'fixed',
      } : null);
      setSavedMessage(t('requestSubmitted', { defaultValue: 'Request submitted. Change takes effect from 1st of next month.' }));
      setChangePlanSelect('');
      setTimeout(() => setSavedMessage(''), 4000);
    } catch (err) {
      alert(err instanceof Error ? err.message : t('updateFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function handleCancelChange() {
    if (saving) return;
    try {
      setSaving(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch('/api/settings/billing', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ action: 'cancel_change' }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      setData(prev => prev ? { ...prev, pending_plan_change: undefined, pending_billing_type: undefined } : null);
      setSavedMessage(t('cancelRequestSuccess', { defaultValue: 'Change request cancelled.' }));
      setTimeout(() => setSavedMessage(''), 3000);
    } catch (err) {
      alert(err instanceof Error ? err.message : t('updateFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmitPaymentRef() {
    if (!paymentRef.trim() || saving) return;
    try {
      setSaving(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch('/api/settings/billing', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ action: 'submit_payment_reference', reference: paymentRef.trim() }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      setSavedMessage(t('referenceSubmitted', { defaultValue: 'Reference submitted. Admin will verify.' }));
      setPaymentRef('');
      setTimeout(() => setSavedMessage(''), 3000);
    } catch (err) {
      alert(err instanceof Error ? err.message : t('updateFailed'));
    } finally {
      setSaving(false);
    }
  }

  const plans = data?.plans ?? FALLBACK_PLANS;
  const paygRates = data?.payg_rates ?? FALLBACK_PAYG;
  const currentPlanDetails = data?.current_plan_details ?? plans.find(p => p.id === data?.plan);
  const locale = useLocale();
  const isRTL = locale === 'ar';
  const isOwner = currentUser?.role === 'owner';

  const paygResult = useMemo(() => calculatePaygCost(paygRates, paygSlider), [paygRates, paygSlider]);
  const fixedComparison = useMemo(() => getFixedPlanComparison(plans, paygSlider), [plans, paygSlider]);
  const paygSavesMoney = fixedComparison.isCustom ? false : paygResult.monthly < fixedComparison.planFee;
  const fixedSavesMoney = !fixedComparison.isCustom && fixedComparison.planFee < paygResult.monthly;
  const savingsAmount = fixedSavesMoney ? fixedComparison.planFee - paygResult.monthly : paygResult.monthly - fixedComparison.planFee;

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
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900" dir={isRTL ? 'rtl' : 'ltr'}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
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

          {data?.pending_plan_change && (
            <div className="mb-4 p-3 bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 rounded-lg text-sm flex items-center justify-between gap-4">
              <span>
                {t('pendingChange', { defaultValue: 'Pending plan change to' })} {data.pending_plan_change} / {data.pending_billing_type === 'payg' ? 'PAYG' : data.pending_billing_type || 'fixed'}. {t('changeNotice', { defaultValue: 'Takes effect from 1st of next month.' })}
              </span>
              {currentUser?.role === 'owner' && (
                <button
                  onClick={handleCancelChange}
                  disabled={saving}
                  className="px-3 py-1.5 text-sm font-medium rounded-lg bg-amber-200 dark:bg-amber-800 hover:bg-amber-300 dark:hover:bg-amber-700"
                >
                  {t('cancelRequest', { defaultValue: 'Cancel Request' })}
                </button>
              )}
            </div>
          )}

          {/* SECTION 1 - Current Plan Card */}
          <section className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 mb-8 border-2 border-indigo-500 dark:border-indigo-400">
            <div className="flex items-center gap-2 mb-4">
              <span className="inline-block px-3 py-1 text-xs font-semibold rounded-full bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-200">
                {t('currentPlan')}
              </span>
            </div>
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">
              {t('currentPlanCard')}
            </h2>
            {data?.pricing_type === 'payg' || data?.billing_type === 'payg' ? (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <span className="text-sm text-gray-500 dark:text-gray-400">{t('plan')}</span>
                  <p className="font-semibold text-gray-900 dark:text-white">Pay-As-You-Go</p>
                </div>
                <div>
                  <span className="text-sm text-gray-500 dark:text-gray-400">{t('studentsPerWeek')}</span>
                  <p className="font-semibold text-gray-900 dark:text-white">~{(data?.current_usage?.weekly_average ?? data?.weekly_student_limit ?? 0).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-EG')}</p>
                </div>
                <div>
                  <span className="text-sm text-gray-500 dark:text-gray-400">{t('estimatedBill', { defaultValue: 'Estimated bill' })}</span>
                  <p className="font-semibold text-gray-900 dark:text-white">
                    {(data?.current_usage?.estimated_bill ?? 0).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-EG')} {t('egp')}
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <span className="text-sm text-gray-500 dark:text-gray-400">{t('plan')}</span>
                  <p className="font-semibold text-gray-900 dark:text-white">
                    {currentPlanDetails?.name_en ?? data?.plan} / {currentPlanDetails?.name_ar ?? ''}
                  </p>
                </div>
                <div>
                  <span className="text-sm text-gray-500 dark:text-gray-400">{t('monthlyFeeLabel')}</span>
                  <p className="font-semibold text-gray-900 dark:text-white">
                    {currentPlanDetails?.is_custom ? t('custom') : `${Number(currentPlanDetails?.monthly_fee ?? 0).toLocaleString('ar-EG')} ${t('egp')}`}
                  </p>
                </div>
                <div>
                  <span className="text-sm text-gray-500 dark:text-gray-400">{t('studentsPerWeek')}</span>
                  <p className="font-semibold text-gray-900 dark:text-white">
                    {currentPlanDetails?.is_custom ? '1,500+' : `≤${currentPlanDetails?.students_per_week_limit?.toLocaleString('ar-EG') ?? 0}`}
                  </p>
                </div>
                <div>
                  <span className="text-sm text-gray-500 dark:text-gray-400">{t('costPerStudent')}</span>
                  <p className="font-semibold text-gray-900 dark:text-white">
                    {currentPlanDetails?.is_custom ? t('negotiated') : `${Number(currentPlanDetails?.per_student_at_capacity_egp ?? 0).toLocaleString('ar-EG')} ${t('egp')}`}
                  </p>
                </div>
              </div>
            )}
          </section>

          {/* SECTION 2 - Fixed Monthly Plans */}
          <section className="mb-8">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">
              {t('fixedPlans')}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {plans.map((plan) => {
                const isCurrent = data?.plan === plan.id && data?.pricing_type === 'fixed';
                const isBestValue = plan.id === 'enterprise';
                const isTopCenters = plan.id === 'top_centers';

                return (
                  <div
                    key={plan.id}
                    className={`relative rounded-xl p-6 shadow-lg border-2 transition-all ${
                      isCurrent
                        ? 'border-indigo-500 dark:border-indigo-400 bg-indigo-50/50 dark:bg-indigo-950/30'
                        : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-500'
                    }`}
                  >
                    {isBestValue && !isTopCenters && (
                      <span className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 px-3 py-0.5 text-xs font-semibold rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
                        {t('bestValue')}
                      </span>
                    )}
                    <div className="text-center mb-4">
                      <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                        {plan.name_en}
                      </h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400">{plan.name_ar}</p>
                    </div>
                    <div className="space-y-2 text-sm mb-6">
                      <div className="flex justify-between">
                        <span className="text-gray-500 dark:text-gray-400">{t('studentsPerWeek')}</span>
                        <span className="font-medium text-gray-900 dark:text-white">
                          {plan.is_custom ? '1,500+' : `≤${plan.students_per_week_limit.toLocaleString('ar-EG')}`}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500 dark:text-gray-400">{t('monthlyFeeLabel')}</span>
                        <span className="font-medium text-gray-900 dark:text-white">
                          {plan.is_custom ? t('custom') : `${Number(plan.monthly_fee).toLocaleString('ar-EG')} ${t('egp')}`}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500 dark:text-gray-400">{t('perStudent')}</span>
                        <span className="font-medium text-gray-900 dark:text-white">
                          {plan.is_custom ? t('negotiated') : `${Number(plan.per_student_at_capacity_egp).toLocaleString('ar-EG')} ${t('egp')}`}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500 dark:text-gray-400">{t('setup')}</span>
                        <span className="font-medium text-gray-900 dark:text-white">
                          {plan.is_custom ? t('custom') : `${Number(plan.setup_fee_egp).toLocaleString('ar-EG')} ${t('egp')}`}
                        </span>
                      </div>
                    </div>
                    {isCurrent && (
                      <div className="text-center py-2 text-sm font-medium text-indigo-600 dark:text-indigo-400">
                        ✓ {t('currentPlan')}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* SECTION 3 - Pay-As-You-Go Slider */}
          <section className="bg-white dark:bg-gray-800 rounded-xl shadow p-6">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-2">
              {t('paygTitle')}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
              {t('paygSubtitle')}
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('studentsPerWeekSlider')}: <strong>{paygSlider.toLocaleString('ar-EG')}</strong>
                </label>
                <input
                  type="range"
                  min={50}
                  max={2000}
                  step={10}
                  value={paygSlider}
                  onChange={(e) => setPaygSlider(Number(e.target.value))}
                  className="w-full h-3 bg-gray-200 dark:bg-gray-600 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                <div>
                  <span className="text-xs text-gray-500 dark:text-gray-400">{t('weeklyCost')}</span>
                  <p className="text-xl font-bold text-gray-900 dark:text-white">
                    {paygResult.weekly.toLocaleString('ar-EG')} {t('egp')}/<span className="text-sm">week</span>
                  </p>
                </div>
                <div>
                  <span className="text-xs text-gray-500 dark:text-gray-400">{t('monthlyFeeLabel')}</span>
                  <p className="font-semibold text-gray-900 dark:text-white">
                    {(paygResult.monthly).toLocaleString('ar-EG')} {t('egp')}/month
                  </p>
                </div>
                <div>
                  <span className="text-xs text-gray-500 dark:text-gray-400">{t('rateTier')}</span>
                  <p className="font-semibold text-gray-900 dark:text-white">
                    {paygResult.effectiveRate > 0 ? `${Number(paygResult.effectiveRate).toLocaleString('ar-EG')} ${t('egp')}/${t('perStudent')}` : '—'}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-gray-500 dark:text-gray-400">{t('premiumVsFixed')}</span>
                  <p className={`font-semibold ${fixedSavesMoney ? 'text-green-600 dark:text-green-400' : fixedComparison.isCustom ? 'text-gray-500' : 'text-amber-600 dark:text-amber-400'}`}>
                    {fixedComparison.isCustom ? t('contactUs') : fixedSavesMoney ? t('fixedPlanBetter') : t('paygCostsMore', { amount: `${savingsAmount.toLocaleString('ar-EG')} ${t('egp')}` })}
                  </p>
                </div>
              </div>

              {paygResult.breakdown.length > 0 && (
                <div className="p-4 bg-white dark:bg-gray-700/30 rounded-lg text-sm">
                  <span className="text-xs text-gray-500 dark:text-gray-400 block mb-2">Tier breakdown</span>
                  <div className="space-y-1">
                    {paygResult.breakdown.map((tier, i) => {
                      const range = tier.to > 10000 ? `${tier.from}+` : tier.from === tier.to ? `${tier.from}` : `${tier.from}-${tier.to}`;
                      return (
                        <div key={i} className="flex justify-between">
                          <span>{range} × {Number(tier.rate).toLocaleString('ar-EG')} {t('egp')} =</span>
                          <span>{Number(tier.cost).toLocaleString('ar-EG')} {t('egp')}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {fixedSavesMoney && !fixedComparison.isCustom && (
                <div className="p-3 rounded-lg bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 text-sm flex items-center gap-2">
                  <span>✓</span>
                  <span>PAYG: {paygResult.monthly.toLocaleString('ar-EG')} {t('egp')}/month vs {fixedComparison.planName}: {fixedComparison.planFee.toLocaleString('ar-EG')} {t('egp')}/month. You save {savingsAmount.toLocaleString('ar-EG')} {t('egp')} with the fixed plan.</span>
                </div>
              )}
            </div>
            <p className="mt-4 text-sm text-gray-500 dark:text-gray-400 italic">
              {t('sliderInfoOnly', { defaultValue: 'For information only. Use Request Plan Change to switch.' })}
            </p>
          </section>

          {/* SECTION 4 - Request Plan Change */}
          {currentUser?.role === 'owner' && (
            <section className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 mb-8">
              <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">
                {t('changeQuestion', { defaultValue: 'Want to change your plan?' })}
              </h2>
              <div className="flex flex-wrap gap-4 items-end">
                <div>
                  <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">{t('selectPlan', { defaultValue: 'Select plan' })}</label>
                  <select
                    value={changePlanSelect}
                    onChange={(e) => setChangePlanSelect(e.target.value)}
                    className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                  >
                    <option value="">—</option>
                    {plans.filter(p => p.id !== 'top_centers').map(p => (
                      <option key={p.id} value={p.id}>{p.name_en} / {p.name_ar}</option>
                    ))}
                    <option value="payg">Pay-As-You-Go</option>
                  </select>
                </div>
                <button
                  onClick={handleRequestChange}
                  disabled={saving || !changePlanSelect}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg"
                >
                  {t('submitRequest', { defaultValue: 'Request Change' })}
                </button>
              </div>
              <div className="mt-4">
                <a
                  href={`https://wa.me/201001963432?text=${encodeURIComponent(`مرحباً، أريد تغيير خطة سنتر ${data?.center_name || ''}`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  {t('requestViaWhatsapp', { defaultValue: 'Request via WhatsApp' })}
                </a>
              </div>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                {t('changeNotice', { defaultValue: 'Changes take effect from the 1st of next month only.' })}
              </p>
            </section>
          )}

          {/* SECTION 5 - Invoice History */}
          <section className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 mb-8">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">
              {t('invoiceHistory', { defaultValue: 'Invoice History' })}
            </h2>
            {(data?.invoices?.length ?? 0) > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-600">
                      <th className="text-left py-2">{t('invoiceNumber', { defaultValue: 'Invoice #' })}</th>
                      <th className="text-left py-2">{t('period', { defaultValue: 'Period' })}</th>
                      <th className="text-left py-2">{t('amount', { defaultValue: 'Amount' })}</th>
                      <th className="text-left py-2">{t('status', { defaultValue: 'Status' })}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data?.invoices?.map((inv: { invoice_number?: string; period_start: string; period_end: string; total_amount: number; status: string; paid_at?: string }) => (
                      <tr key={inv.invoice_number || inv.period_start} className="border-b border-gray-100 dark:border-gray-700">
                        <td className="py-2">{inv.invoice_number || '—'}</td>
                        <td className="py-2">{inv.period_start} – {inv.period_end}</td>
                        <td className="py-2">{Number(inv.total_amount).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-EG')} {t('egp')}</td>
                        <td className="py-2">
                          {inv.status === 'paid' && t('paidStatus')}
                          {inv.status === 'pending' && t('pendingStatus')}
                          {inv.status === 'overdue' && t('overdueStatus')}
                          {inv.status === 'due' && t('dueStatus')}
                          {!['paid','pending','overdue','due'].includes(inv.status) && inv.status}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-gray-500 dark:text-gray-400">{t('noInvoices', { defaultValue: 'No invoices yet.' })}</p>
            )}
          </section>

          {/* SECTION 6 - Payment Methods */}
          <section className="bg-white dark:bg-gray-800 rounded-xl shadow p-6">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">
              {t('paymentMethods', { defaultValue: 'Payment Methods' })}
            </h2>
            <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300 mb-6">
              <div className="flex items-center gap-2 flex-wrap">
                <strong>{t('instapay')}:</strong>
                <span className="font-mono text-base">{t('instapayNumber')}</span>
                <button
                  type="button"
                  onClick={() => { navigator.clipboard.writeText('01001963432'); setSavedMessage(locale === 'ar' ? 'تم النسخ!' : 'Copied!'); setTimeout(() => setSavedMessage(''), 2000); }}
                  className="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-600 rounded hover:bg-gray-300 dark:hover:bg-gray-500"
                >
                  {tCommon('copy')}
                </button>
              </div>
              <p className="text-gray-500 dark:text-gray-400"><strong>{t('bankTransfer')}:</strong> {t('bankTransferComingSoon')}</p>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
              {t('enterReference', { defaultValue: 'After transfer, enter transaction reference below:' })}
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={paymentRef}
                onChange={(e) => setPaymentRef(e.target.value)}
                placeholder={t('instapayRef', { defaultValue: 'InstaPay reference' })}
                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
              />
              <button
                onClick={handleSubmitPaymentRef}
                disabled={saving || !paymentRef.trim()}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg"
              >
                {t('submitReference', { defaultValue: 'Submit' })}
              </button>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
