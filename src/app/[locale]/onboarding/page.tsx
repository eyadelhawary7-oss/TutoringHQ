'use client';

import Image from 'next/image';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from '@/i18n/routing';
import { useTranslations, useLocale } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { dbSelect, dbInsert, dbUpdate, auditLog } from '@/lib/db-proxy';
import { Link } from '@/i18n/routing';
import QRCode from 'qrcode';
import { Users, Upload, QrCode, Check } from 'lucide-react';

const STEPS = ['welcome', 'students', 'groups', 'print'] as const;

interface GroupRow {
  id?: string;
  name: string;
  subject: string;
  fee: string;
}

export default function OnboardingPage() {
  const t = useTranslations('onboarding');
  const tCommon = useTranslations('common');
  const tReferral = useTranslations('referral');
  const locale = useLocale();
  const router = useRouter();

  const [step, setStep] = useState(0);
  const [isChecking, setIsChecking] = useState(true);
  const [centerId, setCenterId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [centerName, setCenterName] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [onboarded, setOnboarded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Step 2 - students
  const [studentName, setStudentName] = useState('');
  const [studentPhone, setStudentPhone] = useState('');
  const [studentCount, setStudentCount] = useState(0);
  const [subjects, setSubjects] = useState<{ id: string; name: string }[]>([]);

  // Step 3 - groups
  const [groupName, setGroupName] = useState('');
  const [groupSubject, setGroupSubject] = useState('');
  const [groupFee, setGroupFee] = useState('');
  const [groups, setGroups] = useState<GroupRow[]>([]);

  const progress = ((step + 1) / STEPS.length) * 100;

  const loadAuth = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      router.replace('/login');
      return;
    }
    setUserId(session.user.id);

    try {
      const meRes = await fetch('/api/me', { headers: { 'Authorization': `Bearer ${session.access_token}` } });
      const meData = await meRes.json();
      if (!meData?.user?.center_id) {
        setIsChecking(false);
        return;
      }
      setCenterId(meData.user.center_id);

      const { data: centerData } = await dbSelect({
        table: 'centers',
        select: 'name, onboarded',
        filters: [{ column: 'id', op: 'eq', value: meData.user.center_id }],
        single: true,
      });
      if (centerData) {
        const c = centerData as { name?: string; onboarded?: boolean };
        setCenterName(c.name || '');
        setOnboarded(c.onboarded === true);
      }

      const { data: subjectsData } = await dbSelect({
        table: 'subjects',
        select: 'id, name',
        filters: [{ column: 'center_id', op: 'eq', value: meData.user.center_id }],
        order: { column: 'name' },
      });
      if (subjectsData) setSubjects(subjectsData as { id: string; name: string }[]);

      const { data: countData } = await dbSelect({
        table: 'students',
        select: 'id',
        filters: [{ column: 'center_id', op: 'eq', value: meData.user.center_id }],
      });
      setStudentCount(Array.isArray(countData) ? countData.length : 0);
    } catch {
      // New user may not be in users table yet - show center creation form
    }
    setIsChecking(false);
  }, [router]);

  useEffect(() => {
    loadAuth();
  }, [loadAuth]);

  // Refresh student count when on step 2 (e.g. after returning from import)
  useEffect(() => {
    if (step === 1 && centerId) {
      dbSelect({ table: 'students', select: 'id', filters: [{ column: 'center_id', op: 'eq', value: centerId }] })
        .then(({ data }) => setStudentCount(Array.isArray(data) ? data.length : 0));
    }
  }, [step, centerId]);

  useEffect(() => {
    if (!isChecking && onboarded) {
      router.replace('/dashboard');
    }
  }, [isChecking, onboarded, router]);

  const handleGetStarted = async () => {
    if (!centerId) {
      if (!centerName.trim()) {
        setError(t('centerName') + ' is required');
        return;
      }
      setLoading(true);
      setError('');
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) throw new Error('Not authenticated');
        const res = await fetch('/api/onboarding', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
          body: JSON.stringify({ centerName: centerName.trim(), referralCode: referralCode.trim() || undefined }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error === 'Invalid code' ? tReferral('invalidCode') : data?.error || 'Failed');
        if (data.success && data.centerId) {
          setCenterId(data.centerId);
          setCenterName(centerName.trim());
          setStep(1);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed');
      } finally {
        setLoading(false);
      }
    } else {
      setStep(1);
    }
  };

  const handleAddStudent = async () => {
    if (!centerId || !userId || !studentName.trim()) return;
    setLoading(true);
    try {
      const { data: inserted, error: insertError } = await dbInsert({
        table: 'students',
        data: {
          center_id: centerId,
          name: studentName.trim(),
          phone: studentPhone.trim() || null,
          fee: 0,
          payment_status: 'unpaid',
        },
        single: true,
      });
      if (insertError) throw insertError;
      if (inserted && (inserted as { id: string }).id) {
        const studentId = (inserted as { id: string }).id;
        try {
          const qrDataURL = await QRCode.toDataURL(studentId, { width: 300, margin: 2, errorCorrectionLevel: 'H' });
          await dbUpdate({ table: 'students', data: { qr_code: qrDataURL }, filters: [{ column: 'id', op: 'eq', value: studentId }] });
        } catch { /* QR non-critical */ }
        await auditLog({ centerId, userId, action: 'student_create', entityType: 'students', entityId: studentId, details: { name: studentName.trim() } });
        setStudentCount(c => c + 1);
        setStudentName('');
        setStudentPhone('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add student');
    } finally {
      setLoading(false);
    }
  };

  const handleAddGroup = async () => {
    if (!centerId || !userId || !groupName.trim()) return;
    setLoading(true);
    try {
      const feeNum = groupFee ? parseFloat(groupFee) : 0;
      const { data: inserted, error: insertError } = await dbInsert({
        table: 'student_groups',
        data: {
          center_id: centerId,
          name: groupName.trim(),
          subject: groupSubject.trim() || null,
          fee: isNaN(feeNum) ? 0 : feeNum,
        },
        single: true,
      });
      if (insertError) throw insertError;
      if (inserted) {
        const g = inserted as { id: string; name: string; subject?: string; fee?: number };
        setGroups(prev => [...prev, { id: g.id, name: g.name, subject: g.subject || groupSubject, fee: groupFee }]);
        await auditLog({ centerId, userId, action: 'group_create', entityType: 'student_groups', entityId: g.id, details: { name: g.name } });
        setGroupName('');
        setGroupSubject('');
        setGroupFee('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add group');
    } finally {
      setLoading(false);
    }
  };

  const handleFinishSetup = async () => {
    if (!centerId || !userId) return;
    setLoading(true);
    try {
      const { error: updateError } = await dbUpdate({
        table: 'centers',
        data: { onboarded: true },
        filters: [{ column: 'id', op: 'eq', value: centerId }],
      });
      if (updateError) throw updateError;
      await auditLog({ centerId, userId, action: 'onboarding_complete', entityType: 'centers', details: {} });
      router.replace('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  };

  if (isChecking) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="animate-spin h-12 w-12 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Progress */}
      <div className="p-4 border-b border-[var(--border-color)] bg-[var(--bg-card)]">
        <div className="max-w-lg mx-auto">
          <div className="flex justify-between text-xs text-[var(--text-muted)] mb-2">
            <span>{t('stepOf', { current: step + 1, total: STEPS.length })}</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div className="h-2 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
          <div className="flex justify-between mt-2">
            {STEPS.map((s, i) => (
              <div key={s} className={`text-[10px] font-medium ${i <= step ? 'text-primary' : 'text-[var(--text-muted)]'}`}>
                {i === 0 ? t('stepWelcome') : i === 1 ? t('stepStudents') : i === 2 ? t('stepGroups') : t('stepPrint')}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-lg">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
              {error}
            </div>
          )}

          {/* Step 1: Welcome */}
          {step === 0 && (
            <div className="text-center space-y-6">
              <div className="w-20 h-20 rounded-2xl mx-auto flex items-center justify-center bg-primary overflow-hidden">
                <Image src="/logo-icon.png" alt="CenterHQ" width={56} height={56} className="object-contain" />
              </div>
              <h1 className="text-3xl font-black text-[var(--text-primary)]" dir="rtl">
                {locale === 'ar' ? t('titleAr') : t('title')}
              </h1>
              {centerId ? (
                <p className="text-lg text-[var(--text-secondary)]">{centerName || '\u2014'}</p>
              ) : (
                <div className="space-y-3 text-start">
                  <label className="block text-sm text-[var(--text-secondary)]">{t('centerName')}</label>
                  <input
                    type="text"
                    value={centerName}
                    onChange={(e) => { setCenterName(e.target.value); setError(''); }}
                    placeholder={t('centerNamePlaceholder')}
                    className="w-full px-4 py-3 rounded-xl glass-input text-sm"
                  />
                  <label className="block text-sm text-[var(--text-secondary)]">{tReferral('referralCodeOptional')}</label>
                  <input
                    type="text"
                    value={referralCode}
                    onChange={(e) => setReferralCode(e.target.value.toUpperCase().slice(0, 8))}
                    placeholder="XXXXXXXX"
                    maxLength={8}
                    className="w-full px-4 py-3 rounded-xl glass-input text-sm font-mono tracking-widest uppercase"
                  />
                </div>
              )}
              <p className="text-sm text-[var(--text-muted)]">{t('introText')}</p>
              <button
                onClick={handleGetStarted}
                disabled={loading || (!centerId && !centerName.trim())}
                className="btn-primary px-8 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? tCommon('loading') : t('getStarted')}
              </button>
            </div>
          )}

          {/* Step 2: Add Students */}
          {step === 1 && (
            <div className="space-y-5">
              <h2 className="text-xl font-bold text-[var(--text-primary)]">{t('addStudents')}</h2>
              <div className="grid grid-cols-2 gap-3">
                <Link href="/students/import" className="glass p-5 text-center hover:shadow-md transition-shadow">
                  <Upload size={24} className="mx-auto mb-2 text-primary" />
                  <div className="font-semibold text-[var(--text-primary)] text-sm">{t('importFromFile')}</div>
                  <div className="text-xs text-[var(--text-muted)] mt-1">{t('importFromFileDesc')}</div>
                </Link>
                <div className="glass p-5 text-center border-primary/30">
                  <Users size={24} className="mx-auto mb-2 text-primary" />
                  <div className="font-semibold text-[var(--text-primary)] text-sm">{t('addManually')}</div>
                  <div className="text-xs text-[var(--text-muted)] mt-1">{t('addManuallyDesc')}</div>
                </div>
              </div>
              <div className="glass p-4 space-y-3">
                <input
                  value={studentName}
                  onChange={(e) => setStudentName(e.target.value)}
                  placeholder={t('studentNamePlaceholder')}
                  className="w-full px-3 py-2.5 rounded-lg glass-input text-sm"
                />
                <input
                  value={studentPhone}
                  onChange={(e) => setStudentPhone(e.target.value)}
                  placeholder={t('phoneOptional')}
                  type="tel"
                  dir="ltr"
                  className="w-full px-3 py-2.5 rounded-lg glass-input text-sm"
                />
                <button
                  onClick={handleAddStudent}
                  disabled={loading || !studentName.trim()}
                  className="btn-primary w-full py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
                >
                  {loading ? tCommon('loading') : tCommon('add')}
                </button>
              </div>
              <p className="text-sm text-[var(--text-muted)] text-center">{t('studentsAdded', { count: studentCount })}</p>
              <div className="flex justify-between">
                <button onClick={() => setStep(2)} className="text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]">{t('skip')}</button>
                <button onClick={() => setStep(2)} className="btn-primary px-6 py-2.5 rounded-xl text-sm font-semibold text-white">{t('next')}</button>
              </div>
            </div>
          )}

          {/* Step 3: Create Groups */}
          {step === 2 && (
            <div className="space-y-5">
              <h2 className="text-xl font-bold text-[var(--text-primary)]">{t('createGroups')}</h2>
              <div className="glass p-4 space-y-3">
                <input
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder={t('groupNamePlaceholder')}
                  className="w-full px-3 py-2.5 rounded-lg glass-input text-sm"
                />
                <select
                  value={groupSubject}
                  onChange={(e) => setGroupSubject(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg glass-input text-sm"
                >
                  <option value="">{t('selectSubject')}</option>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.name}>{s.name}</option>
                  ))}
                  {subjects.length === 0 && (
                    <>
                      <option value="Math">Math</option>
                      <option value="Physics">Physics</option>
                      <option value="Chemistry">Chemistry</option>
                      <option value="English">English</option>
                      <option value="Arabic">Arabic</option>
                    </>
                  )}
                </select>
                <input
                  value={groupFee}
                  onChange={(e) => setGroupFee(e.target.value)}
                  placeholder={t('feePerLessonPlaceholder')}
                  type="number"
                  min="0"
                  className="w-full px-3 py-2.5 rounded-lg glass-input text-sm font-mono"
                />
                <button
                  onClick={handleAddGroup}
                  disabled={loading || !groupName.trim()}
                  className="btn-primary w-full py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
                >
                  {loading ? tCommon('loading') : t('addGroup')}
                </button>
              </div>
              {groups.length > 0 && (
                <div className="space-y-2">
                  {groups.map((g, i) => (
                    <div key={i} className="glass p-3 flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-[var(--text-primary)] text-sm">{g.name}</div>
                        <div className="text-xs text-[var(--text-muted)]">{g.subject || '\u2014'} &mdash; {g.fee || '0'} EGP</div>
                      </div>
                      <Check size={16} className="text-green-600" />
                    </div>
                  ))}
                </div>
              )}
              <div className="flex justify-between">
                <button onClick={() => setStep(3)} className="text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]">{t('skip')}</button>
                <button onClick={() => setStep(3)} className="btn-primary px-6 py-2.5 rounded-xl text-sm font-semibold text-white">{t('next')}</button>
              </div>
            </div>
          )}

          {/* Step 4: Print QR Cards */}
          {step === 3 && (
            <div className="text-center space-y-6">
              <QrCode size={64} className="mx-auto text-primary" />
              <h2 className="text-xl font-bold text-[var(--text-primary)]">{t('qrReady')}</h2>
              <p className="text-[var(--text-muted)]">{t('qrMessage')}</p>
              <Link
                href="/students/print"
                className="inline-flex items-center justify-center px-6 py-3 rounded-xl text-sm font-semibold border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                {t('printQrCards')}
              </Link>
              <div>
                <button
                  onClick={handleFinishSetup}
                  disabled={loading}
                  className="btn-primary px-8 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                >
                  {loading ? tCommon('loading') : t('finishSetup')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
