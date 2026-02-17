'use client';

import { useState, useEffect, useMemo } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/contexts/UserContext';
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
  { id: 'starter', name_en: 'Starter', name_ar: 'أساسي', students_per_week_limit: 150, monthly_fee: 2000, per_student_at_capacity_egp: 13.33, setup_fee_egp: 1000, is_custom: false },
  { id: 'pro', name_en: 'Pro', name_ar: 'محترف', students_per_week_limit: 500, monthly_fee: 4500, per_student_at_capacity_egp: 9, setup_fee_egp: 2000, is_custom: false },
  { id: 'business', name_en: 'Business', name_ar: 'أعمال', students_per_week_limit: 1000, monthly_fee: 6500, per_student_at_capacity_egp: 6.5, setup_fee_egp: 3000, is_custom: false },
  { id: 'enterprise', name_en: 'Enterprise', name_ar: 'مؤسسات', students_per_week_limit: 2000, monthly_fee: 9000, per_student_at_capacity_egp: 4.5, setup_fee_egp: 5000, is_custom: false },
  { id: 'top_centers', name_en: 'Top Centers', name_ar: 'كبار السناتر', students_per_week_limit: 999999, monthly_fee: 0, per_student_at_capacity_egp: 0, setup_fee_egp: 0, is_custom: true },
];

const FALLBACK_PAYG: PaygRate[] = [
  { min_students_per_week: 0, max_students_per_week: 150, rate_per_student_egp: 4 },
  { min_students_per_week: 151, max_students_per_week: 500, rate_per_student_egp: 3 },
  { min_students_per_week: 501, max_students_per_week: 1000, rate_per_student_egp: 2.5 },
  { min_students_per_week: 1001, max_students_per_week: 2000, rate_per_student_egp: 2 },
  { min_students_per_week: 2001, max_students_per_week: 10000, rate_per_student_egp: 1.75 },
];

const MONTHLY_MULTIPLIER = 4.333;

/** Admin WhatsApp number for payment proof notifications */
const ADMIN_NOTIFICATION_PHONE = '201220601410';

/** Flat rate per bracket: entire student count uses the rate of the bracket it falls into. 5 brackets matching fixed plans. */
function getBracketRate(students: number): number {
  if (students <= 150) return 4;
  if (students <= 500) return 3;
  if (students <= 1000) return 2.5;
  if (students <= 2000) return 2;
  return 1.75;
}

function calculatePaygCost(_rates: PaygRate[], students: number): { weekly: number; monthly: number; effectiveRate: number; breakdown: { from: number; to: number; count: number; rate: number; cost: number }[] } {
  const rate = getBracketRate(students);
  const weeklyCost = students * rate;
  const monthly = Math.round(weeklyCost * MONTHLY_MULTIPLIER);
  const breakdown: { from: number; to: number; count: number; rate: number; cost: number }[] =
    students > 0 ? [{ from: 1, to: students, count: students, rate, cost: weeklyCost }] : [];
  return { weekly: weeklyCost, monthly, effectiveRate: rate, breakdown };
}

function getFixedPlanComparison(plans: PricingPlan[], students: number): { planName: string; planNameAr: string; planFee: number; isCustom: boolean } {
  const starter = plans.find(p => p.id === 'starter');
  const pro = plans.find(p => p.id === 'pro');
  const business = plans.find(p => p.id === 'business');
  const enterprise = plans.find(p => p.id === 'enterprise');
  const top = plans.find(p => p.id === 'top_centers');
  if (students <= 150) return { planName: starter?.name_en ?? 'Starter', planNameAr: starter?.name_ar ?? 'أساسي', planFee: starter?.monthly_fee ?? 2000, isCustom: false };
  if (students <= 500) return { planName: pro?.name_en ?? 'Pro', planNameAr: pro?.name_ar ?? 'محترف', planFee: pro?.monthly_fee ?? 4500, isCustom: false };
  if (students <= 1000) return { planName: business?.name_en ?? 'Business', planNameAr: business?.name_ar ?? 'أعمال', planFee: business?.monthly_fee ?? 6500, isCustom: false };
  if (students <= 2000) return { planName: enterprise?.name_en ?? 'Enterprise', planNameAr: enterprise?.name_ar ?? 'مؤسسات', planFee: enterprise?.monthly_fee ?? 9000, isCustom: false };
  return { planName: top?.name_en ?? 'Top Centers', planNameAr: top?.name_ar ?? 'كبار السناتر', planFee: 0, isCustom: true };
}

export default function BillingPage() {
  const t = useTranslations('billing');
  const tSettings = useTranslations('settings');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const locale = useLocale();
  const { user: currentUser } = useUser();
  const [data, setData] = useState<{
    is_early_adopter?: boolean;
    early_adopter_price?: number;
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
    payg_this_week?: { students_scanned: number; weekly_cost: number; monthly_estimate: number; rate_per_student: number };
    payg_weekly_charges?: { week_start_date: string; week_end_date: string; student_count: number; total_charge: number; paid: boolean }[];
    payg_fixed_plan_savings?: { plan: string; price: number; savings: number };
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

      console.log('Fetching billing from:', '/api/settings/billing');
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
      console.log('Billing GET response:', json);
      console.log('Invoices query result:', json.invoices, json.error);
      const plans = (json.plans?.length ? json.plans : FALLBACK_PLANS) as PricingPlan[];
      const paygRates = (json.payg_rates?.length ? json.payg_rates : FALLBACK_PAYG) as PaygRate[];
      setData({
        is_early_adopter: json.is_early_adopter,
        early_adopter_price: json.early_adopter_price,
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
        payg_this_week: json.payg_this_week,
        payg_weekly_charges: json.payg_weekly_charges || [],
        payg_fixed_plan_savings: json.payg_fixed_plan_savings,
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
  const [showPlanRequestModal, setShowPlanRequestModal] = useState(false);
  const [paymentRef, setPaymentRef] = useState('');
  const [proofAmount, setProofAmount] = useState('');
  const [proofReference, setProofReference] = useState('');
  const [proofPaymentMethod, setProofPaymentMethod] = useState('instapay');
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);
  const [proofUploading, setProofUploading] = useState(false);

  async function uploadProof(file: File, cId: string): Promise<string> {
    const fileName = `${cId}/${Date.now()}_${file.name}`;
    const { error } = await supabase.storage.from('payment-proofs').upload(fileName, file);
    if (error) throw error;
    const { data: { publicUrl } } = supabase.storage.from('payment-proofs').getPublicUrl(fileName);
    return publicUrl;
  }

  async function handleSubmitPaymentProof() {
    const amount = parseFloat(proofAmount);
    if (isNaN(amount) || amount <= 0 || !proofReference.trim() || saving) return;
    try {
      setSaving(true);
      let proofUrl: string | null = null;
      if (proofFile) {
        setProofUploading(true);
        const centerId = currentUser?.center_id;
        if (!centerId) throw new Error('Center not found');
        proofUrl = await uploadProof(proofFile, centerId);
        setProofUploading(false);
      }
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      console.log('Fetching billing from:', '/api/settings/billing', '(POST)');
      const res = await fetch('/api/settings/billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          amount,
          reference: proofReference.trim(),
          proofUrl: proofUrl || null,
          paymentMethod: proofPaymentMethod,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.log('Invoice insert result:', null, json?.error);
        alert(json?.error || 'Failed');
        return;
      }
      console.log('Invoice insert result: success');
      setSavedMessage(t('paymentSubmittedForReview', { defaultValue: 'Payment submitted for review. Your account will be reactivated once approved.' }));
      setProofAmount('');
      setProofReference('');
      setProofFile(null);
      setProofPreview(null);
      await fetchBilling();
      setTimeout(() => setSavedMessage(''), 5000);

      // Open WhatsApp to notify admin
      const centerName = data?.center_name || currentUser?.name || 'Unknown';
      const message = encodeURIComponent(
        '🔔 إثبات دفع جديد - CenterHQ\n' +
        '━━━━━━━━━━━━━━━\n' +
        `💰 المبلغ: ${amount} EGP\n` +
        `📝 المرجع: ${proofReference.trim()}\n` +
        `🏢 السنتر: ${centerName}\n` +
        `📅 التاريخ: ${new Date().toLocaleDateString('ar-EG')}\n` +
        '━━━━━━━━━━━━━━━\n' +
        '⏳ في انتظار المراجعة على لوحة التحكم'
      );
      window.open(`https://wa.me/${ADMIN_NOTIFICATION_PHONE}?text=${message}`, '_blank');
    } catch (err) {
      alert(err instanceof Error ? err.message : t('updateFailed'));
    } finally {
      setSaving(false);
      setProofUploading(false);
    }
  }

  async function handleRequestPlanChange() {
    if (!changePlanSelect) return;
    if (saving || currentUser?.role !== 'owner') return;
    try {
      setSaving(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      console.log('Fetching from:', '/api/settings/plan-request');
      const res = await fetch('/api/settings/plan-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ requested_plan: changePlanSelect }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      setSavedMessage(json.message || t('requestSubmitted', { defaultValue: 'Your request has been submitted. It will be reviewed within 24 hours.' }));
      setChangePlanSelect('');
      setShowPlanRequestModal(false);
      setTimeout(() => setSavedMessage(''), 5000);
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
      console.log('Fetching billing from:', '/api/settings/billing', '(PUT)');
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
  const isRTL = locale === 'ar';
  const isOwner = currentUser?.role === 'owner';

  const paygResult = useMemo(() => calculatePaygCost(paygRates, paygSlider), [paygRates, paygSlider]);
  const fixedComparison = useMemo(() => getFixedPlanComparison(plans, paygSlider), [plans, paygSlider]);
  const paygSavesMoney = fixedComparison.isCustom ? false : paygResult.monthly < fixedComparison.planFee;
  const fixedSavesMoney = !fixedComparison.isCustom && fixedComparison.planFee < paygResult.monthly;
  const savingsAmount = fixedSavesMoney ? fixedComparison.planFee - paygResult.monthly : paygResult.monthly - fixedComparison.planFee;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
          <div className="animate-spin h-8 w-8 border-2 border-indigo-600 border-t-transparent rounded-full" />
        </div>
    );
  }

  return (
    <div className="min-h-screen" dir={isRTL ? 'rtl' : 'ltr'}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="mb-6">
            <Link
              href="/settings"
              className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              ← {t('backToSettings')}
            </Link>
          </div>

          {/* Sub-navigation */}
          <div className="flex flex-wrap gap-2 mb-6">
            <Link
              href="/settings"
              className="px-3 py-1.5 rounded-lg bg-bg-tertiary text-text-primary hover:bg-bg-secondary text-sm font-medium transition-colors"
            >
              {tSettings('general')}
            </Link>
            <span className="px-3 py-1.5 rounded-lg bg-indigo-100 dark:bg-indigo-900/50 text-indigo-800 dark:text-indigo-200 text-sm font-medium">
              {tSettings('billing')}
            </span>
            <Link
              href="/settings/team"
              className="px-3 py-1.5 rounded-lg bg-bg-tertiary text-text-primary hover:bg-bg-secondary text-sm font-medium transition-colors"
            >
              {tSettings('teamMembers')}
            </Link>
          </div>

          <h1 className="text-2xl sm:text-3xl font-bold text-text-primary mb-6">
            {t('title')}
          </h1>

          {savedMessage && (
            <div className="mb-4 p-3 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-lg text-sm text-center">
              {savedMessage}
            </div>
          )}


          {/* SECTION 1 - Current Plan Card */}
          <section className="bg-bg-primary rounded-xl shadow-lg p-6 mb-8 border-2 border-indigo-500 dark:border-indigo-400">
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              <span className="inline-block px-3 py-1 text-xs font-semibold rounded-full bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-200">
                {t('currentPlan')}
              </span>
              {data?.is_early_adopter && (
                <span className="inline-block px-3 py-1 text-xs font-semibold rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200" title="Early Adopter - Price Locked Forever">
                  🔒 {t('earlyAdopterBadge', { defaultValue: 'Early Adopter - Price Locked' })}
                </span>
              )}
            </div>
            <h2 className="text-lg font-semibold text-text-primary mb-4">
              {t('currentPlanCard')}
            </h2>
            {data?.pricing_type === 'payg' || data?.billing_type === 'payg' ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div>
                    <span className="text-sm text-text-secondary">{t('studentsScannedThisWeek', { defaultValue: 'Students this week' })}</span>
                    <p className="font-semibold text-text-primary">
                      {(data?.payg_this_week?.students_scanned ?? data?.current_usage?.weekly_average ?? 0).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-EG')}
                    </p>
                  </div>
                  <div>
                    <span className="text-sm text-text-secondary">{t('currentWeekCost', { defaultValue: 'This week cost' })}</span>
                    <p className="font-semibold text-text-primary">
                      {(data?.payg_this_week?.weekly_cost ?? 0).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-EG')} {t('egp')}
                    </p>
                  </div>
                  <div>
                    <span className="text-sm text-text-secondary">{t('estimatedMonthly', { defaultValue: 'Est. monthly' })}</span>
                    <p className="font-semibold text-text-primary">
                      {(data?.payg_this_week?.monthly_estimate ?? data?.current_usage?.estimated_bill ?? 0).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-EG')} {t('egp')}
                    </p>
                  </div>
                  <div>
                    <span className="text-sm text-text-secondary">{t('ratePerStudent', { defaultValue: 'Rate/student' })}</span>
                    <p className="font-semibold text-text-primary">
                      {(data?.payg_this_week?.rate_per_student ?? 4).toLocaleString('ar-EG')} EGP/week
                    </p>
                  </div>
                </div>
                {data?.payg_fixed_plan_savings?.savings && data.payg_fixed_plan_savings.savings > 0 && (
                  <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                    <p className="text-sm text-amber-800 dark:text-amber-300">
                      {t('paygSwitchSuggestion', { defaultValue: 'Switch to a fixed plan and save' })} {data.payg_fixed_plan_savings.savings.toLocaleString('ar-EG')} EGP/month ({t('plan')}: {data.payg_fixed_plan_savings.plan.toUpperCase()} @ {data.payg_fixed_plan_savings.price.toLocaleString('ar-EG')} EGP)
                    </p>
                    {isOwner && (
                      <button
                        onClick={() => { setChangePlanSelect(data.payg_fixed_plan_savings!.plan); setShowPlanRequestModal(true); }}
                        className="mt-2 px-3 py-1.5 text-sm font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700"
                      >
                        {t('switchToFixedPlan', { defaultValue: 'Switch to Fixed Plan' })}
                      </button>
                    )}
                  </div>
                )}
                {(data?.payg_weekly_charges?.length ?? 0) > 0 && (
                  <div>
                    <p className="text-sm text-text-secondary mb-2">{t('last4Weeks', { defaultValue: 'Last 4 weeks' })}</p>
                    <ul className="space-y-1 text-sm">
                      {(data.payg_weekly_charges ?? []).map((w, i) => (
                        <li key={i} className="flex justify-between">
                          <span>{w.week_start_date} – {w.week_end_date}: {w.student_count} {t('students', { defaultValue: 'students' })}</span>
                          <span className="font-mono">{Number(w.total_charge).toLocaleString('ar-EG')} EGP {w.paid && '✓'}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <span className="text-sm text-text-secondary">{t('plan')}</span>
                  <p className="font-semibold text-text-primary">
                    {currentPlanDetails?.name_en ?? data?.plan} / {currentPlanDetails?.name_ar ?? ''}
                  </p>
                </div>
                <div>
                  <span className="text-sm text-text-secondary">{t('monthlyFeeLabel')}</span>
                  <p className="font-semibold text-text-primary">
                    {currentPlanDetails?.is_custom ? t('custom') : `${Number(data?.is_early_adopter && typeof data?.early_adopter_price === 'number' ? data.early_adopter_price : currentPlanDetails?.monthly_fee ?? 0).toLocaleString('ar-EG')} ${t('egp')}`}
                  </p>
                </div>
                <div>
                  <span className="text-sm text-text-secondary">{t('studentsPerWeek')}</span>
                  <p className="font-semibold text-text-primary">
                    {currentPlanDetails?.is_custom ? '2,000+' : `≤${currentPlanDetails?.students_per_week_limit?.toLocaleString('ar-EG') ?? 0}`}
                  </p>
                </div>
                <div>
                  <span className="text-sm text-text-secondary">{t('costPerStudent')}</span>
                  <p className="font-semibold text-text-primary">
                    {currentPlanDetails?.is_custom ? t('negotiated') : `${Number(currentPlanDetails?.per_student_at_capacity_egp ?? 0).toLocaleString('ar-EG')} ${t('egp')}`}
                  </p>
                </div>
              </div>
            )}
          </section>

          {/* SECTION 2 - Fixed Monthly Plans */}
          <section className="mb-8">
            <h2 className="text-lg font-semibold text-text-primary mb-4">
              {t('fixedPlans')}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {plans.map((plan) => {
                const isCurrent = data?.plan === plan.id && data?.pricing_type === 'fixed';
                const isBestValue = plan.id === 'pro';
                const isTopCenters = plan.id === 'top_centers';

                return (
                  <div
                    key={plan.id}
                    className={`relative rounded-xl p-6 shadow-lg border-2 transition-all ${
                      isCurrent
                        ? 'border-indigo-500 dark:border-indigo-400 bg-indigo-50/50 dark:bg-indigo-950/30'
                        : 'border-gray-200 dark:border-gray-600 bg-bg-primary hover:border-gray-300 dark:hover:border-gray-500'
                    }`}
                  >
                    {isBestValue && !isTopCenters && (
                      <span className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 px-3 py-0.5 text-xs font-semibold rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
                        {t('bestValue')}
                      </span>
                    )}
                    <div className="text-center mb-4">
                      <h3 className="text-lg font-bold text-text-primary">
                        {plan.name_en}
                      </h3>
                      <p className="text-sm text-text-secondary">{plan.name_ar}</p>
                    </div>
                    <div className="space-y-2 text-sm mb-6">
                      <div className="flex justify-between">
                        <span className="text-text-secondary">{t('studentsPerWeek')}</span>
                        <span className="font-medium text-text-primary">
                          {plan.is_custom ? '2,000+' : `≤${plan.students_per_week_limit.toLocaleString('ar-EG')}`}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-text-secondary">{t('monthlyFeeLabel')}</span>
                        <span className="font-medium text-text-primary">
                          {plan.is_custom ? t('custom') : `${Number(plan.monthly_fee).toLocaleString('ar-EG')} ${t('egp')}`}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-text-secondary">{t('perStudent')}</span>
                        <span className="font-medium text-text-primary">
                          {plan.is_custom ? t('negotiated') : `${Number(plan.per_student_at_capacity_egp).toLocaleString('ar-EG')} ${t('egp')}`}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-text-secondary">{t('setup')}</span>
                        <span className="font-medium text-text-primary">
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
          <section className="bg-bg-primary rounded-xl shadow p-6">
            <h2 className="text-lg font-semibold text-text-primary mb-2">
              {t('paygTitle')}
            </h2>
            <p className="text-sm text-text-secondary mb-6">
              {t('paygSubtitle')}
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">
                  {t('studentsPerWeekSlider')}: <strong>{paygSlider.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-EG')}</strong>
                </label>
                <input
                  type="range"
                  min={0}
                  max={2500}
                  step={10}
                  value={paygSlider}
                  onChange={(e) => setPaygSlider(Number(e.target.value))}
                  className="w-full h-3 bg-bg-tertiary rounded-lg appearance-none cursor-pointer accent-indigo-600"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 p-4 bg-bg-secondary rounded-lg">
                <div>
                  <span className="text-xs text-text-secondary">{t('weeklyCost')}</span>
                  <p className="text-xl font-bold text-text-primary">
                    {paygResult.weekly.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-EG')} {t('egp')}/<span className="text-sm">week</span>
                  </p>
                </div>
                <div>
                  <span className="text-xs text-text-secondary">{t('monthlyFeeLabel')}</span>
                  <p className="font-semibold text-text-primary">
                    {(paygResult.monthly).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-EG')} {t('egp')}/month
                  </p>
                </div>
                <div>
                  <span className="text-xs text-text-secondary">{t('rateTier')}</span>
                  <p className="font-semibold text-text-primary">
                    {paygResult.effectiveRate > 0 ? `${Number(paygResult.effectiveRate).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-EG')} ${t('egp')}/${t('perStudent')}` : '—'}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-text-secondary">{t('premiumVsFixed')}</span>
                  <p className={`font-semibold ${fixedSavesMoney ? 'text-green-600 dark:text-green-400' : fixedComparison.isCustom ? 'text-text-secondary' : 'text-amber-600 dark:text-amber-400'}`}>
                    {fixedComparison.isCustom ? t('contactUs') : fixedSavesMoney ? t('fixedPlanBetter') : t('paygCostsMore', { amount: `${savingsAmount.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-EG')} ${t('egp')}` })}
                  </p>
                </div>
              </div>

              {paygResult.breakdown.length > 0 && (
                <div className="p-4 bg-bg-tertiary rounded-lg text-sm">
                  <span className="text-xs text-text-secondary block mb-2">Tier breakdown</span>
                  <div className="space-y-1">
                    {paygResult.breakdown.map((tier, i) => (
                      <div key={i} className="flex justify-between">
                        <span>{tier.count.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-EG')} × {Number(tier.rate).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-EG')} {t('egp')} =</span>
                        <span>{Number(tier.cost).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-EG')} {t('egp')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {fixedSavesMoney && !fixedComparison.isCustom && (
                <div className="p-3 rounded-lg bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 text-sm flex items-center gap-2">
                  <span>✓</span>
                  <span>{t('paygSavingsLine', {
                    payg: paygResult.monthly.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-EG'),
                    plan: fixedComparison.planName,
                    planFee: fixedComparison.planFee.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-EG'),
                    savings: savingsAmount.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-EG'),
                    egp: t('egp'),
                  })}</span>
                </div>
              )}
            </div>
            <p className="mt-4 text-sm text-text-secondary italic">
              {t('sliderInfoOnly', { defaultValue: 'For information only. Use Request Plan Change to switch.' })}
            </p>
          </section>

          {/* SECTION 4 - Request Plan Change */}
          {currentUser?.role === 'owner' && (
            <section className="bg-bg-primary rounded-xl shadow p-6 mb-8">
              <h2 className="text-lg font-semibold text-text-primary mb-4">
                {t('changeQuestion', { defaultValue: 'Want to change your plan?' })}
              </h2>
              <p className="text-sm text-text-secondary mb-4">
                {t('changeNotice', { defaultValue: 'Submit a request and we will review it within 24 hours.' })}
              </p>
              <button
                onClick={() => setShowPlanRequestModal(true)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium"
              >
                {t('requestPlanChange')}
              </button>
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
            </section>
          )}

          {showPlanRequestModal && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowPlanRequestModal(false)}>
              <div className="bg-bg-primary rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
                <h3 className="text-lg font-semibold text-text-primary mb-4">{t('requestPlanChange')}</h3>
                <p className="text-sm text-text-secondary mb-4">{t('selectPlan')}</p>
                <div className="space-y-2 mb-6">
                  {plans.filter(p => p.id !== 'top_centers').map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setChangePlanSelect(p.id)}
                      className={`w-full px-3 py-2 text-left rounded-lg border ${
                        changePlanSelect === p.id
                          ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30'
                          : 'border-gray-200 dark:border-gray-600 hover:bg-bg-secondary'
                      }`}
                    >
                      {p.name_en} / {p.name_ar} — {p.monthly_fee > 0 ? `${Number(p.monthly_fee).toLocaleString('ar-EG')} ${t('egp')}/mo` : t('custom')}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setChangePlanSelect('payg')}
                    className={`w-full px-3 py-2 text-left rounded-lg border ${
                      changePlanSelect === 'payg'
                        ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30'
                        : 'border-gray-200 dark:border-gray-600 hover:bg-bg-secondary'
                    }`}
                  >
                    Pay-As-You-Go
                  </button>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleRequestPlanChange}
                    disabled={saving || !changePlanSelect}
                    className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg"
                  >
                    {saving ? t('saving') : t('submitRequest')}
                  </button>
                  <button
                    onClick={() => { setShowPlanRequestModal(false); setChangePlanSelect(''); }}
                    className="px-4 py-2 bg-bg-tertiary rounded-lg"
                  >
                    {tCommon('cancel')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* SECTION 5 - Invoice History */}
          <section className="bg-bg-primary rounded-xl shadow p-6 mb-8">
            <h2 className="text-lg font-semibold text-text-primary mb-4">
              {t('invoiceHistory', { defaultValue: 'Invoice History' })}
            </h2>
            {(data?.invoices?.length ?? 0) > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-600">
                      <th className="text-left py-2 text-sm font-medium italic text-text-secondary">{t('invoiceNumber', { defaultValue: 'Invoice #' })}</th>
                      <th className="text-left py-2 text-sm font-medium italic text-text-secondary">{t('date', { defaultValue: 'Date' })}</th>
                      <th className="text-left py-2 text-sm font-medium italic text-text-secondary">{t('amount', { defaultValue: 'Amount' })}</th>
                      <th className="text-left py-2 text-sm font-medium italic text-text-secondary">{t('reference', { defaultValue: 'Reference' })}</th>
                      <th className="text-left py-2 text-sm font-medium italic text-text-secondary">{t('status', { defaultValue: 'Status' })}</th>
                      <th className="text-left py-2 text-sm font-medium italic text-text-secondary">{t('proof', { defaultValue: 'Proof' })}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data?.invoices?.map((inv: { id?: string; invoice_number?: string; period_start?: string; period_end?: string; billing_period_start?: string; billing_period_end?: string; total_amount?: number; payment_amount?: number; payment_reference?: string; payment_proof_url?: string; status: string; paid_at?: string; created_at?: string }) => (
                      <tr key={inv.id || inv.invoice_number || String(inv.created_at)} className="border-b border-gray-100 dark:border-gray-700">
                        <td className="py-2">{inv.invoice_number || '—'}</td>
                        <td className="py-2">
                          {(inv.created_at ? new Date(inv.created_at).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-GB') : '') || (inv.period_start && inv.period_end ? `${inv.period_start} – ${inv.period_end}` : inv.billing_period_start && inv.billing_period_end ? `${inv.billing_period_start} – ${inv.billing_period_end}` : '—')}
                        </td>
                        <td className="py-2 font-mono italic">{Number(inv.payment_amount ?? inv.total_amount ?? 0).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-EG')} {t('egp')}</td>
                        <td className="py-2">{inv.payment_reference || '—'}</td>
                        <td className="py-2">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium italic ${
                            inv.status === 'paid' || inv.status === 'approved' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300' :
                            inv.status === 'rejected' ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300' :
                            'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300'
                          }`}>
                            {inv.status === 'paid' && t('paidStatus')}
                            {inv.status === 'pending' && t('pendingStatus')}
                            {(inv.status === 'approved' || inv.status === 'confirmed') && (t('paidStatus') || 'Approved')}
                            {inv.status === 'rejected' && (t('rejectedStatus', { defaultValue: 'Rejected' }) || 'Rejected')}
                            {inv.status === 'overdue' && t('overdueStatus')}
                            {inv.status === 'due' && t('dueStatus')}
                            {!['paid','pending','overdue','due','approved','rejected','confirmed'].includes(inv.status) && inv.status}
                          </span>
                        </td>
                        <td className="py-2">
                          {inv.payment_proof_url ? (
                            <a href={inv.payment_proof_url} target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-indigo-400 hover:underline">
                              {t('viewProof', { defaultValue: 'View' })}
                            </a>
                          ) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-text-secondary">{t('noInvoices', { defaultValue: 'No invoices yet.' })}</p>
            )}
          </section>

          {/* SECTION 6 - Payment Methods & Proof Submission */}
          <section className="bg-bg-primary rounded-xl shadow p-6">
            <h2 className="text-lg font-semibold text-text-primary mb-4">
              {t('paymentMethods', { defaultValue: 'Payment Methods' })}
            </h2>

            {/* InstaPay Info - always visible */}
            <div className="mb-6">
              <p className="text-sm font-medium text-text-primary mb-2">
                {locale === 'ar' ? 'حوّل على إنستاباي (رقم الموبايل):' : 'Transfer to InstaPay (Mobile Number):'}
              </p>
              <div className="flex items-center gap-2 flex-wrap items-baseline">
                <span className="font-mono text-xl font-bold text-indigo-600 dark:text-indigo-400">01001963432</span>
                <button
                  type="button"
                  onClick={() => { navigator.clipboard.writeText('01001963432'); setSavedMessage(locale === 'ar' ? 'تم النسخ!' : 'Copied!'); setTimeout(() => setSavedMessage(''), 2000); }}
                  className="px-3 py-1.5 text-sm bg-bg-tertiary rounded-lg hover:bg-bg-secondary"
                >
                  {tCommon('copy')}
                </button>
              </div>
            </div>

            {/* Bank Transfer - Coming Soon */}
            <p className="text-sm text-text-secondary mb-6">
              <strong>{t('bankTransfer')}:</strong> {locale === 'ar' ? 'قريباً' : 'Coming Soon'}
            </p>

            {/* Payment Proof Form */}
            <div className="space-y-4">
                <h3 className="text-base font-semibold text-text-primary">
                  {t('submitProofTitle', { defaultValue: 'Submit Payment Proof' })}
                </h3>
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-1">
                    {t('transferAmountLabel', { defaultValue: 'Transfer Amount (EGP)' })} *
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={proofAmount}
                    onChange={(e) => setProofAmount(e.target.value)}
                    placeholder={t('transferAmountPlaceholder', { defaultValue: '0.00' })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-bg-tertiary text-text-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-1">
                    {t('paymentMethodLabel', { defaultValue: 'Payment Method' })} *
                  </label>
                  <select
                    value={proofPaymentMethod}
                    onChange={(e) => setProofPaymentMethod(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-bg-tertiary text-text-primary"
                  >
                    <option value="instapay">InstaPay</option>
                    <option value="bank_transfer">Bank Transfer</option>
                    <option value="vodafone_cash">Vodafone Cash</option>
                    <option value="orange_cash">Orange Cash</option>
                    <option value="fawry">Fawry</option>
                    <option value="cash">Cash</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-1">
                    {t('instapayRefLabel', { defaultValue: 'Transaction Reference' })} *
                  </label>
                  <input
                    type="text"
                    value={proofReference}
                    onChange={(e) => setProofReference(e.target.value)}
                    placeholder={t('instapayRef', { defaultValue: 'e.g. 123456789' })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-bg-tertiary text-text-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-1">
                    {t('proofLabel', { defaultValue: 'Transfer Screenshot' })} ({locale === 'ar' ? 'اختياري' : 'optional'})
                  </label>
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f && f.size <= 5 * 1024 * 1024) {
                        setProofFile(f);
                        setProofPreview(f.type.startsWith('image/') ? URL.createObjectURL(f) : null);
                      }
                      e.target.value = '';
                    }}
                    className="w-full text-sm text-text-secondary file:mr-2 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 dark:file:bg-indigo-900/30 dark:file:text-indigo-300"
                  />
                  {proofPreview && (
                    <img src={proofPreview} alt="Preview" className="mt-2 max-h-32 rounded-lg border border-gray-200 dark:border-gray-600" />
                  )}
                  {proofFile && !proofPreview && (
                    <p className="mt-2 text-sm text-text-secondary">{proofFile.name}</p>
                  )}
                </div>
                <button
                  onClick={handleSubmitPaymentProof}
                  disabled={saving || proofUploading || !proofAmount || parseFloat(proofAmount) <= 0 || !proofReference.trim()}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium rounded-lg"
                >
                  {proofUploading ? tCommon('loading') : t('submitPaymentProof')}
                </button>
                <p className="text-xs text-text-secondary mt-2">
                  {t('paymentProofWhatsappNote', { defaultValue: "After submitting, you'll be asked to send a WhatsApp confirmation to our team for faster processing." })}
                </p>
              </div>

            {/* Payment Status Summary - one line instead of badge flood */}
            {data?.invoices && (data.invoices as { status?: string }[]).length > 0 && (() => {
              const invoices = data.invoices as { status?: string }[];
              const approved = invoices.filter(inv => ['paid', 'approved', 'confirmed'].includes(inv.status || '')).length;
              const rejected = invoices.filter(inv => ['rejected', 'overdue'].includes(inv.status || '')).length;
              const pending = invoices.filter(inv => !['paid', 'approved', 'confirmed', 'rejected', 'overdue'].includes(inv.status || '')).length;
              if (pending + approved + rejected === 0) return null;
              return (
                <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-600">
                  <p className="text-sm text-text-secondary">
                    {pending > 0 && <span className="text-amber-600 dark:text-amber-400">{pending.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-EG')} {t('pendingStatus')}</span>}
                    {pending > 0 && (approved > 0 || rejected > 0) && <span className="mx-1">·</span>}
                    {approved > 0 && <span className="text-green-600 dark:text-green-400">{approved.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-EG')} {t('statusApproved', { defaultValue: 'approved' })}</span>}
                    {approved > 0 && rejected > 0 && <span className="mx-1">·</span>}
                    {rejected > 0 && <span className="text-red-600 dark:text-red-400">{rejected.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-EG')} {t('rejectedStatus')}</span>}
                  </p>
                </div>
              );
            })()}
          </section>
        </div>
      </div>
  );
}

