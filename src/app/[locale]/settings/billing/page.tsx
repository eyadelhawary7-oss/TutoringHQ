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
  monthly_fee_egp: number;
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
  { id: 'starter', name_en: 'Starter', name_ar: 'أساسي', students_per_week_limit: 200, monthly_fee_egp: 4000, per_student_at_capacity_egp: 5, setup_fee_egp: 2500, is_custom: false },
  { id: 'pro', name_en: 'Pro', name_ar: 'محترف', students_per_week_limit: 600, monthly_fee_egp: 7200, per_student_at_capacity_egp: 3, setup_fee_egp: 5000, is_custom: false },
  { id: 'enterprise', name_en: 'Enterprise', name_ar: 'مؤسسات', students_per_week_limit: 1500, monthly_fee_egp: 9000, per_student_at_capacity_egp: 1.5, setup_fee_egp: 10000, is_custom: false },
  { id: 'top_centers', name_en: 'Top Centers', name_ar: 'كبار السناتر', students_per_week_limit: 1500, monthly_fee_egp: 0, per_student_at_capacity_egp: 0, setup_fee_egp: 0, is_custom: true },
];

const FALLBACK_PAYG: PaygRate[] = [
  { min_students_per_week: 0, max_students_per_week: 200, rate_per_student_egp: 6 },
  { min_students_per_week: 201, max_students_per_week: 600, rate_per_student_egp: 3.75 },
  { min_students_per_week: 601, max_students_per_week: 1500, rate_per_student_egp: 2 },
  { min_students_per_week: 1501, max_students_per_week: 10000, rate_per_student_egp: 1.25 },
];

/** Graduated (marginal) pricing: each tier applies only to students in that tier */
function calculatePaygCost(rates: PaygRate[], students: number): { weekly: number; monthly: number; effectiveRate: number; breakdown: { from: number; to: number; count: number; rate: number; cost: number }[] } {
  const sortedRates = [...rates].sort((a, b) => a.min_students_per_week - b.min_students_per_week);
  let weeklyCost = 0;
  const breakdown: { from: number; to: number; count: number; rate: number; cost: number }[] = [];
  let remaining = students;
  let prevLimit = 0;

  for (const tier of sortedRates) {
    const tierSize = tier.max_students_per_week - prevLimit;
    const studentsInTier = Math.min(remaining, tierSize);
    if (studentsInTier <= 0) break;
    const tierCost = studentsInTier * tier.rate_per_student_egp;
    weeklyCost += tierCost;
    breakdown.push({ from: prevLimit + 1, to: prevLimit + studentsInTier, count: studentsInTier, rate: tier.rate_per_student_egp, cost: tierCost });
    remaining -= studentsInTier;
    prevLimit = tier.max_students_per_week;
  }

  const monthly = weeklyCost * 4;
  const effectiveRate = students > 0 ? weeklyCost / students : 0;
  return { weekly: weeklyCost, monthly, effectiveRate, breakdown };
}

function getFixedPlanComparison(plans: PricingPlan[], students: number): { planName: string; planNameAr: string; planFee: number; isCustom: boolean } {
  const starter = plans.find(p => p.id === 'starter');
  const pro = plans.find(p => p.id === 'pro');
  const enterprise = plans.find(p => p.id === 'enterprise');
  const top = plans.find(p => p.id === 'top_centers');
  if (students <= 200) return { planName: starter?.name_en ?? 'Starter', planNameAr: starter?.name_ar ?? 'أساسي', planFee: starter?.monthly_fee_egp ?? 4000, isCustom: false };
  if (students <= 600) return { planName: pro?.name_en ?? 'Pro', planNameAr: pro?.name_ar ?? 'محترف', planFee: pro?.monthly_fee_egp ?? 7200, isCustom: false };
  if (students <= 1500) return { planName: enterprise?.name_en ?? 'Enterprise', planNameAr: enterprise?.name_ar ?? 'مؤسسات', planFee: enterprise?.monthly_fee_egp ?? 9000, isCustom: false };
  return { planName: top?.name_en ?? 'Top Centers', planNameAr: top?.name_ar ?? 'كبار السناتر', planFee: 0, isCustom: true };
}

export default function BillingPage() {
  const t = useTranslations('billing');
  const router = useRouter();
  const { user: currentUser } = useUser();
  const [data, setData] = useState<{
    plan: string;
    pricing_type: string;
    weekly_student_limit: number;
    plans: PricingPlan[];
    payg_rates: PaygRate[];
    current_plan_details?: PricingPlan;
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
        pricing_type: json.pricing_type || 'fixed',
        weekly_student_limit: json.weekly_student_limit ?? 200,
        plans,
        payg_rates: paygRates,
        current_plan_details: json.current_plan_details,
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

  async function handleChoosePlan(planId: string) {
    if (planId === 'top_centers') {
      window.location.href = 'mailto:support@centerhq.com?subject=Top Centers Plan Inquiry';
      return;
    }
    if (saving || currentUser?.role !== 'owner') return;

    try {
      setSaving(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const plan = plans.find(p => p.id === planId);
      const res = await fetch('/api/settings/billing', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          plan: planId,
          pricing_type: 'fixed',
          weekly_student_limit: plan?.students_per_week_limit ?? 200,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to update');
      }
      setData(prev => prev ? { ...prev, plan: planId, pricing_type: 'fixed', weekly_student_limit: plan?.students_per_week_limit ?? 200 } : null);
      setSavedMessage(t('planUpdated'));
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
            {data?.pricing_type === 'payg' ? (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <span className="text-sm text-gray-500 dark:text-gray-400">{t('plan')}</span>
                  <p className="font-semibold text-gray-900 dark:text-white">Pay-As-You-Go</p>
                </div>
                <div>
                  <span className="text-sm text-gray-500 dark:text-gray-400">{t('studentsPerWeek')}</span>
                  <p className="font-semibold text-gray-900 dark:text-white">{data.weekly_student_limit?.toLocaleString('ar-EG') ?? 0}</p>
                </div>
                <div>
                  <span className="text-sm text-gray-500 dark:text-gray-400">{t('rateTier')}</span>
                  <p className="font-semibold text-gray-900 dark:text-white">
                    {(() => {
                      const r = calculatePaygCost(paygRates, data.weekly_student_limit ?? 0);
                      return r.effectiveRate > 0 ? `${Number(r.effectiveRate).toLocaleString('ar-EG')} ${t('egp')}/${t('perStudent')}` : '—';
                    })()}
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
                    {currentPlanDetails?.is_custom ? t('custom') : `${Number(currentPlanDetails?.monthly_fee_egp ?? 0).toLocaleString('ar-EG')} ${t('egp')}`}
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
                          {plan.is_custom ? t('custom') : `${Number(plan.monthly_fee_egp).toLocaleString('ar-EG')} ${t('egp')}`}
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
                    {isOwner && (
                      <button
                        type="button"
                        onClick={() => handleChoosePlan(plan.id)}
                        disabled={saving || isCurrent}
                        className={`w-full py-2.5 rounded-lg font-medium transition-colors ${
                          isTopCenters
                            ? 'bg-gray-600 hover:bg-gray-700 text-white'
                            : isCurrent
                            ? 'bg-indigo-200 dark:bg-indigo-800 text-indigo-800 dark:text-indigo-200 cursor-default'
                            : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                        } disabled:opacity-60`}
                      >
                        {isTopCenters ? t('contactUs') : isCurrent ? '✓ ' + t('currentPlan') : t('choosePlan')}
                      </button>
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
            {isOwner && (
              <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-600">
                <button
                  type="button"
                  onClick={async () => {
                    if (saving) return;
                    setSaving(true);
                    try {
                      const { data: { session } } = await supabase.auth.getSession();
                      if (!session) return;
                      const res = await fetch('/api/settings/billing', {
                        method: 'PUT',
                        headers: {
                          'Content-Type': 'application/json',
                          Authorization: `Bearer ${session.access_token}`,
                        },
                        body: JSON.stringify({
                          pricing_type: 'payg',
                          weekly_student_limit: paygSlider,
                        }),
                      });
                      if (!res.ok) {
                        const err = await res.json();
                        throw new Error(err.error || 'Failed');
                      }
                      setData(prev => prev ? { ...prev, pricing_type: 'payg', weekly_student_limit: paygSlider } : null);
                      setSavedMessage(t('planUpdated'));
                      setTimeout(() => setSavedMessage(''), 3000);
                    } catch (err) {
                      alert(err instanceof Error ? err.message : t('updateFailed'));
                    } finally {
                      setSaving(false);
                    }
                  }}
                  disabled={saving || (data?.pricing_type === 'payg' && data?.weekly_student_limit === paygSlider)}
                  className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-medium rounded-lg transition-colors"
                >
                  {data?.pricing_type === 'payg' ? t('currentPlan') + ' (PAYG)' : `Switch to Pay-As-You-Go (${paygSlider} students/week)`}
                </button>
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
