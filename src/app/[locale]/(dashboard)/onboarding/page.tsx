'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter, usePathname } from '@/i18n/routing';
import { useLocale, useTranslations } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { dbSelect, auditLog } from '@/lib/db-proxy';
import { LoadingButton } from '@/components/ui/LoadingButton';
import { SuccessCheck } from '@/components/ui/SuccessCheck';
import { Lock } from 'lucide-react';

const TOTAL_STEPS = 4;

type WAState = 'idle' | 'sending' | 'sent' | 'confirmed' | 'support';

const GOVERNORATE_KEYS = ['cairo', 'giza', 'alexandria', 'qalyubia', 'sharkia', 'other'] as const;

const STEP_BADGE_KEYS = ['stepBadge1', 'stepBadge2', 'stepBadge3', 'stepBadge4'] as const;

interface CenterData {
  id: string;
  name: string;
  phone?: string | null;
  city?: string | null;
  governorate?: string | null;
}

interface StudentRow {
  id: string;
  name: string;
  phone: string;
  student_number?: string | null;
}

interface Group {
  id: string;
  name: string;
}

function formatArabicIndic(n: number): string {
  return new Intl.NumberFormat('ar-EG', { numberingSystem: 'arab' }).format(n);
}

export default function OnboardingPage() {
  const to = useTranslations('onboarding');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  const [loading, setLoading] = useState(true);
  const [advancing, setAdvancing] = useState(false);
  const [centerId, setCenterId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [center, setCenter] = useState<CenterData | null>(null);
  const [centerName, setCenterName] = useState('');
  const [city, setCity] = useState('');
  const [governorate, setGovernorate] = useState<string>('cairo');
  const [step, setStep] = useState(1);

  const [students, setStudents] = useState<StudentRow[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);

  const [firstStudentName, setFirstStudentName] = useState('');
  const [firstStudentPhone, setFirstStudentPhone] = useState('');
  const [addingStudent, setAddingStudent] = useState(false);

  const [waState, setWaState] = useState<WAState>('idle');
  const [waSentAt, setWaSentAt] = useState<number | null>(null);

  const [direction, setDirection] = useState<'forward' | 'backward'>('forward');
  const [stepKey, setStepKey] = useState(0);

  const [animatedCount, setAnimatedCount] = useState(0);
  const rafRef = useRef<number | null>(null);

  const toggleLocale = useCallback(() => {
    router.replace(pathname, { locale: locale === 'ar' ? 'en' : 'ar' });
  }, [router, pathname, locale]);

  const patchCenter = useCallback(async (data: Record<string, unknown>) => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('Not authenticated');
    const res = await fetch('/api/centers/me', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(j.error ?? 'Update failed');
    }
  }, []);

  const loadAuth = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      router.replace('/login');
      return;
    }
    setUserId(session.user.id);

    const meRes = await fetch('/api/me', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const meData = await meRes.json();
    if (!meData?.user?.center_id) {
      setLoading(false);
      return;
    }

    const cid = meData.user.center_id as string;
    setCenterId(cid);

    const { data: centerData } = await dbSelect({
      table: 'centers',
      select: 'id, name, phone, city, governorate, onboarding_step, onboarding_completed',
      filters: [{ column: 'id', op: 'eq', value: cid }],
      single: true,
    });

    if (centerData) {
      const c = centerData as CenterData & { onboarding_step?: number; onboarding_completed?: boolean };
      setCenter({
        id: c.id,
        name: c.name || '',
        phone: c.phone,
        city: c.city ?? null,
        governorate: c.governorate ?? null,
      });
      setCenterName((c.name || '').trim());
      setCity((c.city || '').trim());
      {
        const g = (c.governorate || 'cairo').toLowerCase();
        setGovernorate(
          (GOVERNORATE_KEYS as readonly string[]).includes(g) ? g : 'cairo'
        );
      }
      if (c.onboarding_completed) {
        router.replace('/dashboard');
        return;
      }
      setStep(Math.min(Math.max(c.onboarding_step ?? 1, 1), 4));
    }

    const [{ data: studentsData }, { data: groupsData }] = await Promise.all([
      dbSelect({
        table: 'students',
        select: 'id, name, phone, student_number',
        filters: [{ column: 'center_id', op: 'eq', value: cid }],
        order: { column: 'name' },
      }),
      dbSelect({
        table: 'student_groups',
        select: 'id, name',
        filters: [{ column: 'center_id', op: 'eq', value: cid }],
        order: { column: 'name' },
      }),
    ]);

    if (Array.isArray(studentsData)) {
      setStudents(
        (studentsData as { id: string; name: string; phone?: string | null; student_number?: string | null }[]).map(
          (s) => ({
            id: s.id,
            name: s.name,
            phone: s.phone || '',
            student_number: s.student_number,
          })
        )
      );
    }
    if (Array.isArray(groupsData)) {
      setGroups(groupsData as Group[]);
    }

    setLoading(false);
  }, [router]);

  useEffect(() => {
    loadAuth();
  }, [loadAuth]);

  const advanceStep = useCallback(
    async (nextStep: number) => {
      if (!centerId) return;
      setAdvancing(true);
      try {
        const payload: Record<string, unknown> = {
          onboarding_step: nextStep,
        };
        if (step === 1 && nextStep > 1) {
          payload.onboarding_started_at = new Date().toISOString();
        }
        await patchCenter(payload);
        setStep(nextStep);
      } finally {
        setAdvancing(false);
      }
    },
    [centerId, patchCenter, step]
  );

  const retreatStep = useCallback(
    async (prevStep: number) => {
      if (!centerId) return;
      setAdvancing(true);
      try {
        await patchCenter({ onboarding_step: prevStep });
        setStep(prevStep);
      } finally {
        setAdvancing(false);
      }
    },
    [centerId, patchCenter]
  );

  const handleStep1Next = useCallback(async () => {
    if (!centerId || centerName.trim().length < 2) return;
    await patchCenter({
      name: centerName.trim(),
      city: city.trim() || null,
      governorate: governorate || 'cairo',
    });
    setCenter((prev) =>
      prev
        ? {
            ...prev,
            name: centerName.trim(),
            city: city.trim() || null,
            governorate,
          }
        : null
    );
    setDirection('forward');
    setStepKey((k) => k + 1);
    await advanceStep(2);
  }, [centerId, centerName, city, governorate, patchCenter, advanceStep]);

  const handleAddFirstStudent = useCallback(async () => {
    if (firstStudentName.trim().length < 2) return;
    setAddingStudent(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      const res = await fetch('/api/onboarding/first-student', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          name: firstStudentName.trim(),
          phone: firstStudentPhone.trim() || null,
        }),
      });
      if (!res.ok) return;
      const json = (await res.json()) as {
        student: { id: string; name: string; phone: string; student_number: string | null };
      };
      setStudents((prev) => [
        ...prev,
        {
          id: json.student.id,
          name: json.student.name,
          phone: json.student.phone,
          student_number: json.student.student_number,
        },
      ]);
      setFirstStudentName('');
      setFirstStudentPhone('');
    } finally {
      setAddingStudent(false);
    }
  }, [firstStudentName, firstStudentPhone]);

  const handleStep2Skip = useCallback(async () => {
    setDirection('forward');
    setStepKey((k) => k + 1);
    await advanceStep(3);
  }, [advanceStep]);

  const handleStep2Next = useCallback(async () => {
    if (students.length < 1) return;
    setDirection('forward');
    setStepKey((k) => k + 1);
    await advanceStep(3);
  }, [advanceStep, students.length]);

  const sendWelcomeWhatsApp = useCallback(async () => {
    setWaState('sending');
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setWaState('idle');
        return;
      }
      const res = await fetch('/api/whatsapp/send-welcome-test', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        setWaState('sent');
        setWaSentAt(Date.now());
      } else {
        setWaState('idle');
      }
    } catch {
      setWaState('idle');
    }
  }, []);

  const handleStep3Next = useCallback(async () => {
    if (waState !== 'confirmed' || !centerId || !userId) return;
    setAdvancing(true);
    try {
      await patchCenter({
        onboarding_step: 4,
        onboarding_completed: true,
      });
      await auditLog({
        centerId,
        userId,
        action: 'onboarding_complete',
        entityType: 'centers',
        details: {},
      });
      setDirection('forward');
      setStepKey((k) => k + 1);
      setStep(4);
    } finally {
      setAdvancing(false);
    }
  }, [waState, centerId, userId, patchCenter]);

  const handleFooterBack = useCallback(async () => {
    if (step <= 1) return;
    setDirection('backward');
    setStepKey((k) => k + 1);
    if (step === 3) setWaState('idle');
    await retreatStep(step - 1);
  }, [step, retreatStep]);

  const handleGoDashboard = useCallback(() => {
    router.push('/dashboard');
  }, [router]);

  useEffect(() => {
    if (step !== 4) {
      setAnimatedCount(0);
      return;
    }
    const target = students.length;
    let start: number | null = null;
    const duration = 800;
    const tick = (now: number) => {
      if (start === null) start = now;
      const p = Math.min(1, (now - start) / duration);
      setAnimatedCount(Math.round(target * p));
      if (p < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [step, students.length]);

  const progressWidthPct = useMemo(() => (step / TOTAL_STEPS) * 100, [step]);

  const stepCounterText = useMemo(() => {
    if (locale === 'ar') {
      return `${formatArabicIndic(step)} / ${formatArabicIndic(TOTAL_STEPS)}`;
    }
    return `${step} / ${TOTAL_STEPS}`;
  }, [locale, step]);

  const governorateOptions = useMemo(() => {
    const labels: Record<(typeof GOVERNORATE_KEYS)[number], string> = {
      cairo: to('gov_cairo'),
      giza: to('gov_giza'),
      alexandria: to('gov_alexandria'),
      qalyubia: to('gov_qalyubia'),
      sharkia: to('gov_sharkia'),
      other: to('gov_other'),
    };
    return GOVERNORATE_KEYS.map((k) => ({ value: k, label: labels[k] }));
  }, [to]);

  const stepBadgeLabel = useMemo(() => to(STEP_BADGE_KEYS[step - 1]), [to, step]);

  const nameValid = centerName.trim().length >= 2;
  const step1NextDisabled = advancing || !nameValid;

  const step2NextDisabled = advancing || students.length < 1;

  const step3NextDisabled = waState !== 'confirmed' || advancing;

  const stateDotClass =
    waState === 'confirmed'
      ? 'bg-teal-500 chq-fade-in'
      : waState === 'idle'
        ? 'bg-slate-600'
        : 'bg-amber-400';

  const waBoxBorderClass =
    waState === 'confirmed' ? 'border-teal-600/40' : 'border-slate-700';

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--color-surface-0)] flex items-center justify-center">
        <div
          className="animate-spin h-12 w-12 border-2 border-teal-600 border-t-transparent rounded-full"
          aria-hidden
        />
      </div>
    );
  }

  if (!centerId) {
    return (
      <div className="min-h-screen bg-[var(--color-surface-0)] flex items-center justify-center p-4">
        <p className="text-slate-400">{tCommon('error')}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[var(--color-surface-0)] pb-[calc(56px+env(safe-area-inset-bottom,0px))] md:pb-6">
      {step < 4 ? (
        <header className="shrink-0 bg-[var(--color-surface-1)] border-b border-slate-800/80">
          <div className="max-w-lg mx-auto w-full px-4 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <div
                className="shrink-0 w-7 h-7 rounded-md bg-teal-600 flex items-center justify-center text-[10px] font-bold text-white"
                aria-hidden
              >
                CH
              </div>
              <span className="text-sm font-semibold text-slate-100 truncate" style={{ fontFamily: 'Georgia, serif' }}>
                CenterHQ
              </span>
            </div>
            <span className="text-xs font-medium text-slate-400 tabular-nums shrink-0" aria-live="polite">
              {stepCounterText}
            </span>
          </div>
          <div className="max-w-lg mx-auto w-full px-4 pb-3">
            <div className="h-[3px] rounded-full bg-slate-800 overflow-hidden" role="progressbar" aria-valuenow={step} aria-valuemin={1} aria-valuemax={4}>
              <div
                className="h-full rounded-full bg-[#0D9488] transition-[width] duration-[400ms] ease-out"
                style={{ width: `${progressWidthPct}%` }}
              />
            </div>
            <div className="flex justify-end gap-2 mt-2.5" aria-hidden>
              {Array.from({ length: TOTAL_STEPS }).map((_, i) => {
                const idx = i + 1;
                const done = step > idx;
                const active = step === idx;
                return (
                  <div
                    key={idx}
                    className={`h-1.5 rounded-full transition-all duration-300 ${
                      done
                        ? 'w-6 bg-teal-600'
                        : active
                          ? 'w-10 bg-teal-600/50'
                          : 'w-6 bg-slate-700'
                    }`}
                  />
                );
              })}
            </div>
          </div>
        </header>
      ) : null}

      <div className="px-4 pt-3 flex justify-end max-w-lg mx-auto w-full">
        <button
          type="button"
          onClick={toggleLocale}
          className="text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700 btn-press chq-focus"
        >
          {locale === 'ar' ? 'English' : 'العربية'}
        </button>
      </div>

      <main className="flex-1 flex flex-col max-w-lg mx-auto w-full px-4 py-4 min-h-0">
        {step < 4 ? (
          <div
            key={stepKey}
            className={`flex-1 flex flex-col min-h-0 ${stepKey > 0 && direction === 'forward' ? 'chq-slide-up' : ''}`}
          >
            <div
              className="inline-flex items-center gap-2 rounded-full bg-teal-600/15 border border-teal-600/30 px-3 py-1 text-xs font-medium text-teal-300 w-fit chq-fade-in"
              style={{ animationDelay: '0ms' }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-teal-500" aria-hidden />
              {stepBadgeLabel}
            </div>
            {step === 1 ? (
              <>
                <h1
                  className="text-xl font-bold text-slate-100 mt-3 chq-fade-in"
                  style={{ animationDelay: '80ms' }}
                >
                  {to('step1Title')}
                </h1>
                <p
                  className="text-sm text-slate-500 mt-1 chq-fade-in"
                  style={{ animationDelay: '160ms' }}
                >
                  {to('step1Desc')}
                </p>
                <div className="mt-6 space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">{to('centerName')}</label>
                    <input
                      type="text"
                      value={centerName}
                      onChange={(e) => setCenterName(e.target.value)}
                      placeholder={to('centerNamePlaceholder')}
                      className={`w-full bg-slate-800 border rounded-lg text-slate-100 px-3 py-2.5 text-sm outline-none transition-colors chq-focus ${
                        nameValid ? 'border-teal-600' : 'border-slate-700'
                      }`}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">{to('cityLabel')}</label>
                    <input
                      type="text"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder={to('cityPlaceholder')}
                      className={`w-full bg-slate-800 border rounded-lg text-slate-100 px-3 py-2.5 text-sm outline-none transition-colors chq-focus ${
                        city.trim() ? 'border-teal-600' : 'border-slate-700'
                      }`}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">{to('governorateLabel')}</label>
                    <select
                      value={governorate}
                      onChange={(e) => setGovernorate(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg text-slate-100 px-3 py-2.5 text-sm outline-none focus:border-teal-600 chq-focus"
                    >
                      {governorateOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </>
            ) : null}

            {step === 2 ? (
              <>
                <h1 className="text-xl font-bold text-slate-100 mt-3 chq-fade-in" style={{ animationDelay: '80ms' }}>
                  {to('step2Title')}
                </h1>
                <p className="text-sm text-slate-500 mt-1 chq-fade-in" style={{ animationDelay: '160ms' }}>
                  {to('step2Desc')}
                </p>
                <p className="text-sm text-teal-400/90 mt-3">{to('firstStudentEncourage')}</p>
                <div className="mt-4 space-y-3">
                  <input
                    type="text"
                    value={firstStudentName}
                    onChange={(e) => setFirstStudentName(e.target.value)}
                    placeholder={to('studentNamePlaceholder')}
                    className={`w-full bg-slate-800 border rounded-lg text-slate-100 px-3 py-2.5 text-sm outline-none chq-focus ${
                      firstStudentName.trim().length >= 2 ? 'border-teal-600' : 'border-slate-700'
                    }`}
                  />
                  <input
                    type="tel"
                    value={firstStudentPhone}
                    onChange={(e) => setFirstStudentPhone(e.target.value)}
                    placeholder={to('phoneOptional')}
                    dir="ltr"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg text-slate-100 px-3 py-2.5 text-sm outline-none focus:border-teal-600 chq-focus"
                  />
                  <LoadingButton
                    type="button"
                    variant="primary"
                    state={addingStudent ? 'loading' : 'idle'}
                    loadingText={to('addingStudent')}
                    onClick={() => void handleAddFirstStudent()}
                    disabled={firstStudentName.trim().length < 2 || addingStudent}
                    className="w-full !bg-teal-600 hover:!bg-teal-500"
                  >
                    {to('addFirstStudentBtn')}
                  </LoadingButton>
                </div>
              </>
            ) : null}

            {step === 3 ? (
              <>
                <h1 className="text-xl font-bold text-slate-100 mt-3 chq-fade-in" style={{ animationDelay: '80ms' }}>
                  {to('waConfirmTitle')}
                </h1>
                <p className="text-sm text-slate-500 mt-1 chq-fade-in" style={{ animationDelay: '160ms' }}>
                  {to('waConfirmDesc')}
                </p>

                <div className={`mt-5 rounded-xl p-3 bg-slate-800 border ${waBoxBorderClass} transition-colors`}>
                  <p className="text-xs text-slate-500 mb-2">{to('whatsapp_preview_label')}</p>
                  <div className="bg-[#0D9488] rounded-lg rounded-br-sm px-3 py-2 inline-block max-w-[95%]">
                    <p className="text-sm text-white leading-relaxed whitespace-pre-wrap">{to('waPreviewBody')}</p>
                  </div>
                </div>

                <div className="mt-4">
                  <LoadingButton
                    type="button"
                    variant="primary"
                    state={waState === 'sending' ? 'loading' : 'idle'}
                    loadingText={to('waSending')}
                    onClick={() => void sendWelcomeWhatsApp()}
                    disabled={waState === 'sending' || waState === 'sent' || waState === 'confirmed'}
                    className="w-full !bg-[#25D366] hover:!brightness-110 !text-white border-0 shadow-none disabled:!opacity-60"
                  >
                    {to('waSendBtn')}
                  </LoadingButton>
                </div>

                {waState !== 'idle' && waState !== 'sending' ? (
                  <div className="mt-4 space-y-3 chq-spring-in">
                    <div className="bg-slate-800 rounded-lg px-3 py-2 flex items-center gap-2 border border-slate-700">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${stateDotClass}`} aria-hidden />
                      <span className="text-sm text-slate-300">
                        {waState === 'confirmed' ? (
                          to('waConfirmed')
                        ) : (
                          <>
                            <span aria-hidden>✓ </span>
                            {to('waSent')}
                          </>
                        )}
                        {waSentAt ? (
                          <span className="text-slate-500 ms-2 tabular-nums">
                            {new Date(waSentAt).toLocaleString('en-US', {
                              hour: '2-digit',
                              minute: '2-digit',
                              hour12: true,
                            })}
                          </span>
                        ) : null}
                      </span>
                    </div>

                    <p className="text-sm font-medium text-slate-200">{to('waGateQuestion')}</p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setWaState('confirmed')}
                        className="flex-1 min-w-[8rem] px-4 py-2.5 rounded-lg bg-teal-600 text-white text-sm font-medium btn-press chq-focus"
                      >
                        {to('waYes')} ✓
                      </button>
                      <button
                        type="button"
                        onClick={() => setWaState('support')}
                        className={`flex-1 min-w-[8rem] px-4 py-2.5 rounded-lg text-sm font-medium border bg-transparent btn-press chq-focus ${
                          waState === 'support'
                            ? 'border-amber-500/60 text-amber-400'
                            : 'border-slate-700 text-slate-500'
                        }`}
                      >
                        {to('waNo')}
                      </button>
                    </div>

                    {waState === 'support' ? (
                      <div className="rounded-xl p-4 bg-amber-950/20 border border-amber-800/30 chq-spring-in">
                        <p className="text-amber-400 font-semibold text-sm">{to('waSupportTitle')}</p>
                        <p className="text-slate-500 text-sm mt-2 leading-relaxed">{to('waSupportDesc')}</p>
                        <button
                          type="button"
                          onClick={() =>
                            window.open('https://wa.me/+201220601410', '_blank', 'noopener,noreferrer')
                          }
                          className="mt-3 w-full py-2.5 rounded-lg bg-amber-900/20 border border-amber-700/30 text-amber-400 text-sm font-medium btn-press chq-focus"
                        >
                          {to('waSupportBtn')}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col items-center py-6">
            <div className="chq-spring-in">
              <SuccessCheck size={64} color="#0D9488" />
            </div>
            <h1 className="text-2xl font-bold text-slate-100 mt-6 text-center">{to('completionTitle')}</h1>
            <p className="text-sm text-slate-500 mt-2 text-center max-w-sm">{to('completionDesc')}</p>

            <div className="grid grid-cols-3 gap-2 w-full mt-8">
              <div
                className="bg-slate-800 rounded-xl p-3 text-center border border-slate-700/80 chq-slide-up"
                style={{ animationDelay: '0ms' }}
              >
                <p className="text-teal-400 text-xl font-medium tabular-nums">
                  {animatedCount.toLocaleString('en-US')}
                </p>
                <p className="text-slate-500 text-xs mt-1">{to('statStudents')}</p>
              </div>
              <div
                className="bg-slate-800 rounded-xl p-3 text-center border border-slate-700/80 chq-slide-up"
                style={{ animationDelay: '100ms' }}
              >
                <p className="text-teal-400 text-xl font-medium tabular-nums">
                  {groups.length.toLocaleString('en-US')}
                </p>
                <p className="text-slate-500 text-xs mt-1">{to('statGroups')}</p>
              </div>
              <div
                className="bg-slate-800 rounded-xl p-3 text-center border border-slate-700/80 chq-slide-up"
                style={{ animationDelay: '200ms' }}
              >
                <p className="text-teal-400 text-xl font-medium tabular-nums">100%</p>
                <p className="text-slate-500 text-xs mt-1">{to('statComplete')}</p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleGoDashboard}
              className="mt-10 w-full py-3 rounded-xl bg-teal-600 text-white text-sm font-semibold btn-press chq-focus"
            >
              {to('goToDashboard')} ←
            </button>
          </div>
        )}
      </main>

      {step < 4 ? (
        <footer className="shrink-0 px-4 pb-4 max-w-lg mx-auto w-full flex gap-3">
          {step > 1 ? (
            <button
              type="button"
              onClick={() => void handleFooterBack()}
              disabled={advancing}
              className="flex-1 py-2.5 rounded-lg border border-slate-700 text-slate-300 text-sm font-medium btn-press chq-focus disabled:opacity-50"
            >
              {to('back')}
            </button>
          ) : null}

          {step === 2 ? (
            <button
              type="button"
              onClick={() => void handleStep2Skip()}
              disabled={advancing}
              className="py-2.5 px-3 rounded-lg border border-slate-700 bg-transparent text-slate-500 text-sm font-medium btn-press chq-focus disabled:opacity-50"
            >
              {to('skip')}
            </button>
          ) : null}

          {step === 3 ? (
            <button
              type="button"
              onClick={() => void handleStep3Next()}
              disabled={step3NextDisabled}
              className={`flex-1 inline-flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold border transition-colors btn-press chq-focus ${
                waState === 'confirmed'
                  ? 'bg-teal-600 border-teal-600 text-white'
                  : 'bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed opacity-60'
              }`}
            >
              {waState !== 'confirmed' ? <Lock className="w-4 h-4 shrink-0" aria-hidden /> : null}
              <span>{waState === 'confirmed' ? to('nextToFinalStep') : to('waNextLocked')}</span>
            </button>
          ) : step === 1 && step1NextDisabled ? (
            <button
              type="button"
              disabled
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold bg-slate-800 border border-slate-700 text-slate-500 cursor-not-allowed opacity-60"
            >
              {to('next')}
            </button>
          ) : step === 2 && step2NextDisabled ? (
            <button
              type="button"
              disabled
              className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold bg-slate-800 border border-slate-700 text-slate-500 cursor-not-allowed opacity-60"
            >
              {to('next')}
            </button>
          ) : (
            <LoadingButton
              type="button"
              variant="primary"
              state={advancing ? 'loading' : 'idle'}
              loadingText={to('completing')}
              onClick={() => {
                if (step === 1) void handleStep1Next();
                else if (step === 2) void handleStep2Next();
              }}
              disabled={false}
              className={step > 1 ? 'flex-1' : 'w-full'}
            >
              {to('next')}
            </LoadingButton>
          )}
        </footer>
      ) : null}
    </div>
  );
}
