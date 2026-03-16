'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from '@/i18n/routing';
import { useTranslations } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { dbSelect, dbInsert, dbUpdate, auditLog } from '@/lib/db-proxy';
import QRCode from 'qrcode';
import Step1Profile from '@/components/onboarding/steps/Step1Profile';
import Step2Students from '@/components/onboarding/steps/Step2Students';
import Step3QR from '@/components/onboarding/steps/Step3QR';
import Step4Scanner from '@/components/onboarding/steps/Step4Scanner';
import CompletionScreen from '@/components/onboarding/CompletionScreen';

const STEP_LABELS = ['step1Label', 'step2Label', 'step3Label', 'step4Label'] as const;

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
  const t = useTranslations('onboarding');
  const tCommon = useTranslations('common');
  const router = useRouter();

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

  const loadAuth = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
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
        (studentsData as { id: string; name: string; phone?: string | null; student_number?: string | null; qr_code?: string | null }[]).map(async (s) => {
          const { data: members } = await dbSelect({
            table: 'student_group_members',
            select: 'group_id',
            filters: [{ column: 'student_id', op: 'eq', value: s.id }],
          });
          const gid = Array.isArray(members) && members.length > 0 ? (members[0] as { group_id: string }).group_id : '';
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
    await auditLog({ centerId, userId, action: 'student_create', entityType: 'students', entityId: s.id, details: { name: s.name } });
    setStudents((prev) => [...prev, { id: s.id, name: s.name, phone, groupId, student_number: s.student_number, qr_code: qrDataURL }]);
  };

  const handleStep2Next = () => advanceStep(3);

  const handleStep3Print = () => {
    router.push('/students/print');
  };

  const handleStep3Next = () => advanceStep(4);

  const handleStep4Complete = async () => {
    if (!centerId || !userId) return;
    setAdvancing(true);
    try {
      await dbUpdate({
        table: 'centers',
        data: { onboarding_step: 5, onboarding_completed: true, onboarded: true },
        filters: [{ column: 'id', op: 'eq', value: centerId }],
      });
      await auditLog({ centerId, userId, action: 'onboarding_complete', entityType: 'centers', details: {} });
      setCompleted(true);
    } finally {
      setAdvancing(false);
    }
  };

  const handleGoToDashboard = () => router.replace('/dashboard');

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin h-12 w-12 border-2 border-teal-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!centerId) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <p className="text-slate-500">{tCommon('error')}</p>
      </div>
    );
  }

  if (completed) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <div className="flex-1 flex items-center justify-center p-6">
          <CompletionScreen
            centerId={centerId}
            centerPhone={profilePhone || center?.phone || ''}
            onGoToDashboard={handleGoToDashboard}
          />
        </div>
      </div>
    );
  }

  const currentStepIndex = Math.max(0, step - 1);
  const firstStudent = students[0];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Progress bar */}
      <div className="p-4 border-b border-slate-200 bg-white">
        <div className="max-w-lg mx-auto">
          <div className="flex gap-1 mb-2">
            {STEP_LABELS.map((key, i) => {
              const done = i < currentStepIndex;
              const current = i === currentStepIndex;
              return (
                <div
                  key={key}
                  className={`flex-1 h-2 rounded-full transition-all ${
                    done ? 'bg-teal-500' : current ? 'bg-teal-500 animate-pulse' : 'bg-slate-200'
                  }`}
                />
              );
            })}
          </div>
          <div className="flex justify-between text-xs text-slate-500">
            {STEP_LABELS.map((key, i) => (
              <span key={key} className={i <= currentStepIndex ? 'text-teal-600 font-medium' : ''}>
                {t(key)}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col p-6">
        <div className="max-w-lg mx-auto w-full flex-1 flex flex-col">
          {step === 1 && (
            <>
              <Step1Profile
                centerName={profileName}
                centerPhone={profilePhone}
                onNameChange={setProfileName}
                onPhoneChange={setProfilePhone}
              />
              <div className="mt-6">
                <button
                  onClick={handleStep1Next}
                  disabled={advancing || !profileName.trim()}
                  className="w-full py-3 rounded-xl text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50"
                >
                  {advancing ? tCommon('loading') : t('next')}
                </button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <Step2Students
                students={students}
                groups={groups}
                onAdd={handleStep2Add}
                canProceed={students.length >= 1}
              />
              <div className="mt-6">
                <button
                  onClick={handleStep2Next}
                  disabled={advancing || students.length < 1}
                  className="w-full py-3 rounded-xl text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50"
                >
                  {advancing ? tCommon('loading') : t('next')}
                </button>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <Step3QR
                studentName={firstStudent?.name}
                studentNumber={firstStudent?.student_number ?? undefined}
                qrDataUrl={firstStudent?.qr_code ?? null}
                centerName={center?.name ?? undefined}
                onPrint={handleStep3Print}
                checked={step3Checked}
                onCheckedChange={setStep3Checked}
              />
              <div className="mt-6">
                <button
                  onClick={handleStep3Next}
                  disabled={advancing || !step3Checked}
                  className="w-full py-3 rounded-xl text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50"
                >
                  {advancing ? tCommon('loading') : t('next')}
                </button>
              </div>
            </>
          )}

          {step === 4 && (
            <>
              <Step4Scanner isActive={step === 4} onScanSuccess={handleStep4Complete} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
