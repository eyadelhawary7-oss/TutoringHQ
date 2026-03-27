'use client';

import { useState, useEffect, useCallback } from 'react';
import { Link, useRouter, usePathname } from '@/i18n/routing';
import { useLocale, useTranslations } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { dbSelect, dbInsert, dbUpdate, auditLog } from '@/lib/db-proxy';
import QRCode from 'qrcode';
import Step1Profile from '@/components/onboarding/steps/Step1Profile';
import Step2Students from '@/components/onboarding/steps/Step2Students';
import Step3QR from '@/components/onboarding/steps/Step3QR';
import Step4Scanner from '@/components/onboarding/steps/Step4Scanner';
import { Confetti } from '@/components/onboarding/Confetti';
import { AnimatedCounter } from '@/components/onboarding/AnimatedCounter';
import { WhatsAppConfirmation } from '@/components/onboarding/WhatsAppConfirmation';
import { LoadingButton } from '@/components/ui/LoadingButton';

const STEP_LABELS = ['step1Label', 'step2Label', 'step3Label', 'step4Label'] as const;

const TOTAL_STEPS = 4;

interface CenterData {
  id: string;
  name: string;
  phone?: string | null;
}

interface StudentRow {
  id: string;
  name: string;
  phone: string;
  groupId: string;
  student_number?: string | null;
  qr_code?: string | null;
}

interface Group {
  id: string;
  name: string;
}

export default function OnboardingPage() {
  const to = useTranslations('onboarding');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  const toggleLocale = () => {
    router.replace(pathname, { locale: locale === 'ar' ? 'en' : 'ar' });
  };

  const [loading, setLoading] = useState(true);
  const [advancing, setAdvancing] = useState(false);
  const [centerId, setCenterId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [center, setCenter] = useState<CenterData | null>(null);
  const [profileName, setProfileName] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  const [step, setStep] = useState(0);
  const [completed, setCompleted] = useState(false);

  const [students, setStudents] = useState<StudentRow[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [step3Checked, setStep3Checked] = useState(false);

  const [direction, setDirection] = useState<'forward' | 'backward'>('forward');
  const [stepKey, setStepKey] = useState(0);
  const [showConfetti, setShowConfetti] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [whatsappSent, setWhatsappSent] = useState(false);

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

    const cid = meData.user.center_id;
    setCenterId(cid);

    const { data: centerData } = await dbSelect({
      table: 'centers',
      select: 'id, name, phone, onboarding_step, onboarding_completed',
      filters: [{ column: 'id', op: 'eq', value: cid }],
      single: true,
    });

    if (centerData) {
      const c = centerData as CenterData & { onboarding_step?: number; onboarding_completed?: boolean };
      setCenter({ id: c.id, name: c.name || '', phone: c.phone });
      setProfileName(c.name || '');
      setProfilePhone(c.phone || '');
      if (c.onboarding_completed) {
        router.replace('/dashboard');
        return;
      }
      setStep(Math.min(Math.max(c.onboarding_step ?? 0, 1), 4));
    }

    const [{ data: studentsData }, { data: groupsData }] = await Promise.all([
      dbSelect({
        table: 'students',
        select: 'id, name, phone, student_number, qr_code',
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
      const withGroups = await Promise.all(
        (
          studentsData as {
            id: string;
            name: string;
            phone?: string | null;
            student_number?: string | null;
            qr_code?: string | null;
          }[]
        ).map(async (s) => {
          const { data: members } = await dbSelect({
            table: 'student_group_members',
            select: 'group_id',
            filters: [{ column: 'student_id', op: 'eq', value: s.id }],
          });
          const gid =
            Array.isArray(members) && members.length > 0 ? (members[0] as { group_id: string }).group_id : '';
          return { ...s, groupId: gid, phone: s.phone || '' };
        })
      );
      setStudents(withGroups);
    }
    if (Array.isArray(groupsData)) {
      setGroups(groupsData as Group[]);
    }

    setLoading(false);
  }, [router]);

  useEffect(() => {
    loadAuth();
  }, [loadAuth]);

  useEffect(() => {
    if (!completed || !centerId) return;
    const phone = (profilePhone || center?.phone || '').trim();
    if (!phone) return;

    let cancelled = false;
    (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.access_token || cancelled) return;
        const res = await fetch('/api/whatsapp/schedule-onboarding', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ centerId, centerPhone: phone }),
        });
        if (!cancelled && res.ok) setWhatsappSent(true);
      } catch {
        /* keep pending */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [completed, centerId, profilePhone, center?.phone]);

  const advanceStep = async (nextStep: number) => {
    if (!centerId) return;
    setAdvancing(true);
    try {
      await dbUpdate({
        table: 'centers',
        data: {
          onboarding_step: nextStep,
          onboarding_started_at: step === 1 ? new Date().toISOString() : undefined,
        },
        filters: [{ column: 'id', op: 'eq', value: centerId }],
      });
      setStep(nextStep);
    } finally {
      setAdvancing(false);
    }
  };

  const retreatStep = async (prevStep: number) => {
    if (!centerId) return;
    setAdvancing(true);
    try {
      await dbUpdate({
        table: 'centers',
        data: { onboarding_step: prevStep },
        filters: [{ column: 'id', op: 'eq', value: centerId }],
      });
      setStep(prevStep);
    } finally {
      setAdvancing(false);
    }
  };

  const handleStep1Next = async () => {
    if (!centerId) return;
    await dbUpdate({
      table: 'centers',
      data: { name: profileName.trim(), phone: profilePhone.trim() || null },
      filters: [{ column: 'id', op: 'eq', value: centerId }],
    });
    setCenter((prev) => (prev ? { ...prev, name: profileName.trim(), phone: profilePhone.trim() || null } : null));
    await advanceStep(2);
  };

  const handleStep2Add = async (name: string, phone: string, groupId: string) => {
    if (!centerId || !userId) return;
    const { data: inserted, error } = await dbInsert({
      table: 'students',
      data: {
        center_id: centerId,
        name: name.trim(),
        phone: phone.trim() || null,
        fee: 0,
        payment_status: 'unpaid',
      },
      select: 'id, name, student_number',
      single: true,
    });
    if (error || !inserted) throw new Error('Failed to add student');
    const s = inserted as { id: string; name: string; student_number: string };
    let qrDataURL = '';
    try {
      qrDataURL = await QRCode.toDataURL(s.id, { width: 300, margin: 2, errorCorrectionLevel: 'H' });
      await dbUpdate({
        table: 'students',
        data: { qr_code: qrDataURL },
        filters: [{ column: 'id', op: 'eq', value: s.id }],
      });
    } catch {
      /* non-critical */
    }
    if (groupId) {
      await dbInsert({
        table: 'student_group_members',
        data: { group_id: groupId, student_id: s.id },
        select: false,
      });
    }
    await auditLog({
      centerId,
      userId,
      action: 'student_create',
      entityType: 'students',
      entityId: s.id,
      details: { name: s.name },
    });
    setStudents((prev) => [
      ...prev,
      { id: s.id, name: s.name, phone, groupId, student_number: s.student_number, qr_code: qrDataURL },
    ]);
  };

  const handleStep2Next = () => advanceStep(3);

  const handleStep3Print = () => {
    router.push('/students/print');
  };

  const handleStep3Next = () => advanceStep(4);

  const handleStep4Complete = async () => {
    if (!centerId || !userId) return;
    setAdvancing(true);
    setIsCompleting(true);
    try {
      await dbUpdate({
        table: 'centers',
        data: { onboarding_step: 5, onboarding_completed: true, onboarded: true },
        filters: [{ column: 'id', op: 'eq', value: centerId }],
      });
      await auditLog({ centerId, userId, action: 'onboarding_complete', entityType: 'centers', details: {} });
      setShowConfetti(true);
      setCompleted(true);
    } finally {
      setAdvancing(false);
      setIsCompleting(false);
    }
  };

  const handleFooterNext = async () => {
    setDirection('forward');
    setStepKey((k) => k + 1);
    if (step === 1) await handleStep1Next();
    else if (step === 2) await handleStep2Next();
    else if (step === 3) await handleStep3Next();
  };

  const handleFooterBack = async () => {
    if (step <= 1) return;
    setDirection('backward');
    setStepKey((k) => k + 1);
    await retreatStep(step - 1);
  };

  const progressPct = Math.round((step / TOTAL_STEPS) * 100);
  const currentStepIndex = Math.max(0, step - 1);
  const firstStudent = students[0];

  const footerNextDisabled =
    advancing ||
    (step === 1 && !profileName.trim()) ||
    (step === 2 && students.length < 1) ||
    (step === 3 && !step3Checked);

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--color-surface-0)] flex items-center justify-center">
        <div className="animate-spin h-12 w-12 border-2 border-[var(--color-brand-500)] border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!centerId) {
    return (
      <div className="min-h-screen bg-[var(--color-surface-0)] flex items-center justify-center p-4">
        <p className="text-[var(--color-text-secondary)]">{tCommon('error')}</p>
      </div>
    );
  }

  const completionCenterName = profileName.trim() || center?.name || '';
  const completionPhone = profilePhone || center?.phone || '';

  return (
    <div
      className="bg-[var(--color-surface-0)] min-h-screen flex flex-col pb-[calc(56px+env(safe-area-inset-bottom,0px))] md:pb-0"
    >
      <Confetti active={showConfetti} />

      {showConfetti ? (
        <span className="sr-only" aria-live="polite">
          {to('confetti_alt')}
        </span>
      ) : null}

      {!completed && (
        <>
          <div className="px-4 pt-3 flex justify-end max-w-lg mx-auto w-full">
            <button
              type="button"
              onClick={toggleLocale}
              className="text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors duration-fast px-3 py-1.5 rounded-badge bg-[var(--color-surface-2)] border border-[var(--color-border-default)]"
            >
              {locale === 'ar' ? 'English' : 'العربية'}
            </button>
          </div>
          <div className="px-4 pt-4 pb-2">
            <div className="max-w-lg mx-auto w-full">
              <span className="sr-only">{to('progress_label')}</span>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-[var(--color-text-secondary)]">
                  {to('step_of', { current: step, total: TOTAL_STEPS })}
                </span>
                <span className="text-xs font-medium text-[var(--color-brand-500)]">{progressPct}%</span>
              </div>

              <div
                className="onboarding-progress-bar"
                role="progressbar"
                aria-valuenow={progressPct}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div className="onboarding-progress-fill" style={{ width: `${progressPct}%` }} />
              </div>

              <div className="flex items-center justify-center gap-2 mt-3" aria-hidden="true">
                {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
                  <div
                    key={STEP_LABELS[i]}
                    className={`rounded-full transition-all duration-normal ease-spring ${i < currentStepIndex ? 'w-6 h-2 bg-[var(--color-brand-500)]' : i === currentStepIndex ? 'w-4 h-2 bg-[var(--color-brand-500)]' : 'w-2 h-2 bg-[var(--color-surface-3)]'}`}
                  />
                ))}
              </div>

              <div className="flex justify-between gap-1 mt-2 text-[10px] sm:text-xs text-[var(--color-text-secondary)]">
                {STEP_LABELS.map((key, i) => (
                  <span key={key} className={i <= currentStepIndex ? 'text-[var(--color-brand-500)] font-medium' : ''}>
                    {to(key)}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      <div
        key={stepKey}
        className={`flex-1 px-4 py-4 max-w-lg mx-auto w-full flex flex-col ${direction === 'forward' ? 'onboarding-step-forward' : 'onboarding-step-backward'}`}
      >
        {completed ? (
          <div className="flex flex-col items-center gap-6 py-8">
            <div className="w-20 h-20 rounded-full bg-[rgba(13,148,136,0.12)] flex items-center justify-center modal-spring-in">
              <svg
                width="40"
                height="40"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--color-brand-500)"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
                <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
                <path d="M4 22h16" />
                <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
                <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
                <path d="M18 2H6v7a6 6 0 0 0 12 0V2z" />
              </svg>
            </div>

            <div className="text-center">
              <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">{to('completion_title')}</h1>
              <p className="text-sm text-[var(--color-text-secondary)]">{to('completion_subtitle')}</p>
            </div>

            <div className="card p-6 w-full text-center">
              <AnimatedCounter
                target={students.length}
                className="text-4xl font-bold text-[var(--color-brand-500)] counter-pop"
              />
              <p className="text-sm text-[var(--color-text-secondary)] mt-1">{to('completion_students')}</p>
            </div>

            <WhatsAppConfirmation
              sent={whatsappSent}
              centerName={completionCenterName}
              phoneNumber={completionPhone}
            />

            <Link href="/dashboard" className="btn btn-primary w-full text-center">
              {to('go_to_dashboard')}
            </Link>
          </div>
        ) : (
          <div className="flex-1 flex flex-col">
            {step === 1 && (
              <Step1Profile
                centerName={profileName}
                centerPhone={profilePhone}
                onNameChange={setProfileName}
                onPhoneChange={setProfilePhone}
              />
            )}

            {step === 2 && (
              <Step2Students
                students={students}
                groups={groups}
                onAdd={handleStep2Add}
                canProceed={students.length >= 1}
                onSkip={() => void handleStep2Next()}
              />
            )}

            {step === 3 && (
              <Step3QR
                studentName={firstStudent?.name}
                studentNumber={firstStudent?.student_number ?? undefined}
                qrDataUrl={firstStudent?.qr_code ?? null}
                centerName={center?.name ?? undefined}
                onPrint={handleStep3Print}
                checked={step3Checked}
                onCheckedChange={setStep3Checked}
              />
            )}

            {step === 4 && <Step4Scanner isActive={step === 4} onScanSuccess={handleStep4Complete} />}
          </div>
        )}
      </div>

      {!completed && step < 4 && (
        <div className="px-4 pb-4 flex gap-3 max-w-lg mx-auto w-full">
          {step > 1 && (
            <button type="button" onClick={() => void handleFooterBack()} disabled={advancing} className="btn btn-ghost flex-1">
              {to('back')}
            </button>
          )}
          <LoadingButton
            state={advancing || isCompleting ? 'loading' : 'idle'}
            loadingText={to('completing')}
            onClick={() => void handleFooterNext()}
            disabled={footerNextDisabled}
            className={`btn-primary ${step > 1 ? 'flex-1' : 'w-full'}`}
          >
            {to('next')}
          </LoadingButton>
        </div>
      )}

      {!completed && step === 4 && (
        <div className="px-4 pb-4 max-w-lg mx-auto w-full">
          <button type="button" onClick={() => void handleFooterBack()} disabled={advancing} className="btn btn-ghost w-full">
            {to('back')}
          </button>
        </div>
      )}
    </div>
  );
}
