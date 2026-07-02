'use client';

import {
  useState,
  useLayoutEffect,
  useCallback,
  useMemo,
  type FormEvent,
} from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { createBrowserClient } from '@supabase/ssr';
import { formatNumber, formatCurrency } from '@/lib/formatNumber';
import SummerFirstInvoiceCard from '@/components/summer/SummerFirstInvoiceCard';

type Step = 1 | 2 | 3 | 4;

export default function OnboardingPage() {
  const [currentStep, setCurrentStep] = useState<Step>(1);
  const [studentAdded, setStudentAdded] = useState(false);
  const [groupCreated, setGroupCreated] = useState(false);
  const [scanSimulated, setScanSimulated] = useState(false);
  const [studentCount, setStudentCount] = useState(0);
  const [centerName, setCenterName] = useState('');
  const [centerId, setCenterId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [studentName, setStudentName] = useState('');
  const [studentPhone, setStudentPhone] = useState('');
  const [guardianConsent, setGuardianConsent] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupSubject, setGroupSubject] = useState('');

  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations('onboarding');
  const tConsent = useTranslations('guardianConsent');

  const supabase = useMemo(
    () =>
      createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      ),
    [],
  );

  const advanceStep = useCallback(
    async (completedStep: Step) => {
      setLoading(true);
      setError(null);
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.access_token) {
          setError('Not authenticated');
          setLoading(false);
          return;
        }
        const res = await fetch('/api/onboarding/complete-step', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ step: completedStep }),
        });
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setError(typeof j.error === 'string' ? j.error : 'Request failed');
          setLoading(false);
          return;
        }
        if (completedStep === 1) setStudentAdded(true);
        if (completedStep === 2) setGroupCreated(true);
        if (completedStep === 3) setScanSimulated(true);
        if (completedStep === 4) {
          router.replace(`/${locale}/dashboard`);
          setLoading(false);
          return;
        }
        setCurrentStep((completedStep + 1) as Step);
      } catch {
        setError('Request failed');
      } finally {
        setLoading(false);
      }
    },
    [locale, router, supabase],
  );

  useLayoutEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.replace(`/${locale}/login`);
        return;
      }

      const { data: userRow, error: userErr } = await supabase
        .from('users')
        .select('center_id')
        .eq('id', session.user.id)
        .single();

      if (cancelled) return;
      if (userErr || !userRow?.center_id) {
        setLoading(false);
        setError('Could not load your center.');
        return;
      }

      const cid = userRow.center_id as string;

      const { data: center, error: centerErr } = await supabase
        .from('centers')
        .select('name, onboarding_step, onboarding_completed_at')
        .eq('id', cid)
        .single();

      if (cancelled) return;
      if (centerErr || !center) {
        setLoading(false);
        setError('Could not load center.');
        return;
      }

      if (
        center.onboarding_completed_at != null ||
        (center.onboarding_step ?? 0) >= 4
      ) {
        router.replace(`/${locale}/dashboard`);
        return;
      }

      const step = Math.max(
        1,
        Math.min(4, (center.onboarding_step ?? 0) + 1),
      ) as Step;
      setCurrentStep(step);
      setCenterName((center.name as string) ?? '');
      setCenterId(cid);

      const os = center.onboarding_step ?? 0;
      if (os >= 1) setStudentAdded(true);
      if (os >= 2) setGroupCreated(true);
      if (os >= 3) setScanSimulated(true);

      const { count } = await supabase
        .from('students')
        .select('id', { count: 'exact', head: true })
        .eq('center_id', cid);
      if (!cancelled) setStudentCount(count ?? 0);

      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [locale, router, supabase]);

  const stepTitleKey =
    `step${currentStep}Title` as 'step1Title' | 'step2Title' | 'step3Title' | 'step4Title';
  const stepTitle = t(stepTitleKey);

  const hoursSaved = Math.round(Math.max(studentCount, 10) * 0.5 * 12);
  const valueSaved = hoursSaved * 150;

  const authHeaders = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (session?.access_token) {
      h.Authorization = `Bearer ${session.access_token}`;
    }
    return h;
  };

  const onSubmitStep1 = async (e: FormEvent) => {
    e.preventDefault();
    const name = studentName.trim();
    if (name.length < 2) {
      setError('Name is required');
      return;
    }
    if (!guardianConsent) {
      setError(tConsent('required'));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch('/api/onboarding/add-student', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name,
          phone: studentPhone.trim() || undefined,
          guardianConsentConfirmed: guardianConsent,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        studentCount?: number;
      };
      if (!res.ok) {
        setError(typeof j.error === 'string' ? j.error : 'Request failed');
        setLoading(false);
        return;
      }
      if (typeof j.studentCount === 'number') setStudentCount(j.studentCount);
      await advanceStep(1);
    } catch {
      setError('Request failed');
      setLoading(false);
    }
  };

  const onSubmitStep2 = async (e: FormEvent) => {
    e.preventDefault();
    const name = groupName.trim();
    if (name.length < 2) {
      setError('Group name is required');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch('/api/onboarding/create-group', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name,
          subject: groupSubject.trim() || undefined,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(typeof j.error === 'string' ? j.error : 'Request failed');
        setLoading(false);
        return;
      }
      await advanceStep(2);
    } catch {
      setError('Request failed');
      setLoading(false);
    }
  };

  const onSimulateScan = async () => {
    setLoading(true);
    setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch('/api/onboarding/simulate-scan', {
        method: 'POST',
        headers,
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(typeof j.error === 'string' ? j.error : 'Request failed');
        setLoading(false);
        return;
      }
      await advanceStep(3);
    } catch {
      setError('Request failed');
      setLoading(false);
    }
  };

  return (
    <div className="chq-page flex min-h-screen items-center justify-center p-4">
      <div className="chq-card p-6 w-full max-w-md">
        {/* Summer 2026: payment-step explainer — active now for free, first invoice
            on the computed date via Paymob, no card captured. Renders only when on. */}
        <div className="mb-6">
          <SummerFirstInvoiceCard locale={locale} portal="combined" explainer />
        </div>
        <div
          className="flex gap-2 mb-6"
          role="progressbar"
          aria-valuenow={currentStep}
          aria-valuemin={1}
          aria-valuemax={4}
        >
          {[0, 1, 2, 3].map((i) => {
            const seg = (i + 1) as Step;
            const isDone = seg < currentStep;
            const isCurrent = seg === currentStep;
            return (
              <div
                key={seg}
                className={`flex-1 h-2 rounded-full ${
                  isDone
                    ? 'bg-[var(--color-teal)]'
                    : isCurrent
                      ? 'bg-[var(--color-teal)] opacity-60'
                      : 'bg-[var(--color-border)]'
                }`}
                title={t(`step${seg}Label` as 'step1Label')}
              />
            );
          })}
        </div>
        <div className="flex justify-between gap-2 mb-1 text-xs text-[var(--color-text-muted)]">
          <span>{t('step1Label')}</span>
          <span>{t('step2Label')}</span>
          <span>{t('step3Label')}</span>
          <span>{t('step4Label')}</span>
        </div>

        <p className="text-sm text-[var(--color-text-secondary)] mb-1">
          {t('stepCounter', { current: currentStep, total: 4 })}
        </p>
        <h1 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">
          {stepTitle}
        </h1>
        {centerName ? (
          <p className="text-sm text-[var(--color-text-secondary)] mb-4">
            {centerName}
          </p>
        ) : null}

        {error ? (
          <div
            className="mb-4 rounded-lg px-3 py-2 text-sm bg-red-500/10 text-red-400"
            role="alert"
          >
            {error}
          </div>
        ) : null}

        {currentStep === 1 ? (
          <form onSubmit={onSubmitStep1} className="space-y-4">
            <div>
              <label
                className="block text-sm text-[var(--color-text-secondary)] mb-1"
                htmlFor="student-name"
              >
                {t('studentNamePlaceholder')}
              </label>
              <input
                id="student-name"
                dir="auto"
                required
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] text-[var(--color-text-primary)] ps-3 pe-3 py-2"
              />
            </div>
            <div>
              <label
                className="block text-sm text-[var(--color-text-secondary)] mb-1"
                htmlFor="student-phone"
              >
                {t('phoneOptional')}
              </label>
              <input
                id="student-phone"
                dir="ltr"
                type="tel"
                value={studentPhone}
                onChange={(e) => setStudentPhone(e.target.value)}
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] text-[var(--color-text-primary)] ps-3 pe-3 py-2"
              />
            </div>
            <label className="flex items-start gap-2 cursor-pointer rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-3">
              <input
                type="checkbox"
                required
                checked={guardianConsent}
                onChange={(e) => setGuardianConsent(e.target.checked)}
                className="mt-0.5 rounded accent-teal-600"
              />
              <span className="text-sm text-[var(--color-text-primary)]">{tConsent('checkboxLabel')}</span>
            </label>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-[var(--color-teal)] text-[var(--color-surface-1)] py-2.5 font-medium disabled:opacity-50"
            >
              {loading ? t('saving') : t('continue')}
            </button>
          </form>
        ) : null}

        {currentStep === 2 ? (
          <form onSubmit={onSubmitStep2} className="space-y-4">
            <div>
              <label
                className="block text-sm text-[var(--color-text-secondary)] mb-1"
                htmlFor="group-name"
              >
                {t('groupNamePlaceholder')}
              </label>
              <input
                id="group-name"
                dir="auto"
                required
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] text-[var(--color-text-primary)] ps-3 pe-3 py-2"
              />
            </div>
            <div>
              <label
                className="block text-sm text-[var(--color-text-secondary)] mb-1"
                htmlFor="group-subject"
              >
                {t('selectSubject')}
              </label>
              <input
                id="group-subject"
                dir="auto"
                value={groupSubject}
                onChange={(e) => setGroupSubject(e.target.value)}
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] text-[var(--color-text-primary)] ps-3 pe-3 py-2"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-[var(--color-teal)] text-[var(--color-surface-1)] py-2.5 font-medium disabled:opacity-50"
            >
              {loading ? t('saving') : t('continue')}
            </button>
          </form>
        ) : null}

        {currentStep === 3 ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-6 text-center">
              <div className="text-4xl mb-2" aria-hidden>
                📷
              </div>
              <p className="text-[var(--color-text-secondary)] text-sm">
                {t('step3ScanHint')}
              </p>
            </div>
            <button
              type="button"
              disabled={loading}
              onClick={onSimulateScan}
              className="w-full rounded-lg bg-[var(--color-teal)] text-[var(--color-surface-1)] py-2.5 font-medium disabled:opacity-50"
            >
              {loading ? t('saving') : t('continue')}
            </button>
          </div>
        ) : null}

        {currentStep === 4 ? (
          <div className="space-y-4">
            <div className="grid gap-3">
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
                <p className="text-sm text-[var(--color-text-secondary)]">
                  {t('roiHoursSaved')}
                </p>
                <p
                  className="text-2xl font-semibold text-[var(--color-text-primary)] tabular-nums"
                  style={{
                    fontFamily: 'var(--font-playfair)',
                    fontFeatureSettings: '"zero" 1, "tnum" 1',
                  }}
                >
                  {formatNumber(hoursSaved, locale)}
                </p>
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  {t('hoursPerYear')}
                </p>
              </div>
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
                <p className="text-sm text-[var(--color-text-secondary)]">
                  {t('roiValue')}
                </p>
                <p
                  className="text-2xl font-semibold text-[var(--color-text-primary)] tabular-nums"
                  style={{
                    fontFamily: 'var(--font-playfair)',
                    fontFeatureSettings: '"zero" 1, "tnum" 1',
                  }}
                >
                  {formatCurrency(valueSaved, locale)}
                </p>
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  {t('savedPerYear')}
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={loading}
              onClick={() => void advanceStep(4)}
              className="w-full rounded-lg bg-[var(--color-teal)] text-[var(--color-surface-1)] py-2.5 font-medium disabled:opacity-50"
            >
              {loading ? t('saving') : t('goToDashboard')}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
