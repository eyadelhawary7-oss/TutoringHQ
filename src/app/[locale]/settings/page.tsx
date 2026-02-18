'use client';

import Image from 'next/image';
import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { dbSelect, dbInsert, dbUpdate, dbDelete, auditLog } from '@/lib/db-proxy';
import { useUser } from '@/contexts/UserContext';
import { Link } from '@/i18n/routing';

interface Subject {
  id: string;
  name: string;
  monthly_fee?: number; // deprecated - fee is now on groups
}

interface CenterInfo {
  id: string;
  name: string;
  logo_url: string | null;
  scanner_default_mode: string;
  max_teachers?: number;
}

export default function SettingsPage() {
  const t = useTranslations('settings');
  const tCommon = useTranslations('common');
  const tReferral = useTranslations('referral');
  const router = useRouter();
  const { user: currentUser, hasPermission } = useUser();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.replace('/login');
    router.refresh();
  };

  const [center, setCenter] = useState<CenterInfo | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [centerId, setCenterId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [savedMessage, setSavedMessage] = useState('');

  // Form states
  const [centerName, setCenterName] = useState('');
  const [newSubjectName, setNewSubjectName] = useState('');
  const [scannerMode, setScannerMode] = useState('camera');
  const [editingSubject, setEditingSubject] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [referralData, setReferralData] = useState<{ referralCode: string; rewards: { id: string; referred_center_name: string; referred_center_plan: string; reward_amount: number; reward_status: string; created_at: string; status?: string }[]; pending?: { referred_center_name: string; referred_center_plan: string; reward_status: string; status?: string }[]; totalEarned: number } | null>(null);
  const [referralCopied, setReferralCopied] = useState(false);
  const [logoLoadFailed, setLogoLoadFailed] = useState(false);

  // Redirect assistants/teachers without can_view_settings
  useEffect(() => {
    if (currentUser && (currentUser.role === 'assistant' || currentUser.role === 'teacher') && !hasPermission('can_view_settings')) {
      router.replace('/dashboard');
    }
  }, [currentUser, hasPermission, router]);

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      setUserId(session.user.id);

      // Use /api/me to bypass RLS on users table
      const meRes = await fetch('/api/me', {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      const meData = await meRes.json();

      if (!meData?.user?.center_id) return;
      setCenterId(meData.user.center_id);
      const userCenterId = meData.user.center_id;

      // Load center info (bypass RLS)
      const { data: centerData } = await dbSelect({
        table: 'centers',
        select: '*',
        filters: [{ column: 'id', op: 'eq', value: userCenterId }],
        single: true,
      });

      if (centerData) {
        setCenter(centerData as CenterInfo);
        setCenterName((centerData as CenterInfo).name || '');
        setScannerMode((centerData as CenterInfo).scanner_default_mode || 'camera');
        setLogoLoadFailed(false);
      }

      // Load subjects (bypass RLS)
      const { data: subjectsData } = await dbSelect({
        table: 'subjects',
        select: '*',
        filters: [{ column: 'center_id', op: 'eq', value: userCenterId }],
        order: { column: 'name' },
      });

      if (subjectsData) setSubjects(subjectsData as Subject[]);

      setIsLoading(false);
    };
    load();
  }, []);

  useEffect(() => {
    const fetchReferral = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || !centerId) return;
      try {
        const res = await fetch('/api/referral', {
          headers: { 'Authorization': `Bearer ${session.access_token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setReferralData(data);
        }
      } catch (err) {
        console.error('Referral fetch error:', err);
      }
    };
    if (centerId) fetchReferral();
  }, [centerId]);

  const showSaved = () => {
    setSavedMessage(t('saved'));
    setTimeout(() => setSavedMessage(''), 2000);
  };

  const handleSaveCenterName = async () => {
    if (!centerId || !userId || !centerName.trim()) return;
    const { error } = await dbUpdate({
      table: 'centers',
      data: { name: centerName.trim() },
      filters: [{ column: 'id', op: 'eq', value: centerId }],
    });
    if (!error) {
      await auditLog({ centerId, userId, action: 'center_update', entityType: 'centers', details: { field: 'name', value: centerName.trim() } });
      showSaved();
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !centerId || !userId) return;

    const ext = file.name.split('.').pop();
    const path = `${centerId}/logo.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('center-logos')
      .upload(path, file, { upsert: true });

    if (uploadError) {
      console.error('Logo upload error:', uploadError);
      return;
    }

    const { data: publicData } = supabase.storage.from('center-logos').getPublicUrl(path);
    const { error } = await dbUpdate({
      table: 'centers',
      data: { logo_url: publicData.publicUrl },
      filters: [{ column: 'id', op: 'eq', value: centerId }],
    });
    if (!error) {
      await auditLog({ centerId, userId, action: 'center_update', entityType: 'centers', details: { field: 'logo' } });
      setCenter(prev => prev ? { ...prev, logo_url: publicData.publicUrl } : null);
      setLogoLoadFailed(false);
      showSaved();
    }
  };

  const handleAddSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!centerId || !userId || !newSubjectName.trim()) return;

    const { data, error } = await dbInsert({
      table: 'subjects',
      data: {
        center_id: centerId,
        name: newSubjectName.trim(),
      },
      single: true,
    });

    if (!error && data) {
      const subject = data as Subject;
      await auditLog({
        centerId,
        userId,
        action: 'subject_create',
        entityType: 'subjects',
        entityId: subject.id,
        details: { name: subject.name },
      });
      setSubjects(prev => [...prev, { ...subject, monthly_fee: 0 }]);
      setNewSubjectName('');
      showSaved();
    }
  };

  const handleUpdateSubject = async (id: string) => {
    if (!centerId || !userId) return;
    const { error } = await dbUpdate({
      table: 'subjects',
      data: { name: editName.trim() },
      filters: [{ column: 'id', op: 'eq', value: id }],
    });

    if (!error) {
      await auditLog({
        centerId,
        userId,
        action: 'subject_update',
        entityType: 'subjects',
        entityId: id,
        details: { name: editName.trim() },
      });
      setSubjects(prev => prev.map(s => s.id === id ? { ...s, name: editName.trim() } : s));
      setEditingSubject(null);
      showSaved();
    }
  };

  const handleDeleteSubject = async (id: string) => {
    if (!confirm(t('deleteConfirm')) || !centerId || !userId) return;

    // Check if any students use this subject (by subject, not subject_id - students have subject string)
    const { data: studentsWithSubject } = await dbSelect({
      table: 'students',
      select: 'id',
      filters: [{ column: 'subject', op: 'eq', value: subjects.find(s => s.id === id)?.name ?? '' }],
      limit: 1,
    });
    if (studentsWithSubject && (studentsWithSubject as unknown[]).length > 0) {
      alert(t('subjectInUse'));
      return;
    }

    const { error } = await dbDelete({
      table: 'subjects',
      filters: [{ column: 'id', op: 'eq', value: id }],
    });
    if (!error) {
      await auditLog({
        centerId,
        userId,
        action: 'subject_delete',
        entityType: 'subjects',
        entityId: id,
        details: { name: subjects.find(s => s.id === id)?.name },
      });
      setSubjects(prev => prev.filter(s => s.id !== id));
    }
  };

  const handleScannerMode = async (mode: string) => {
    if (!centerId || !userId) return;
    setScannerMode(mode);
    const { error } = await dbUpdate({
      table: 'centers',
      data: { scanner_default_mode: mode },
      filters: [{ column: 'id', op: 'eq', value: centerId }],
    });
    if (!error) {
      await auditLog({ centerId, userId, action: 'center_update', entityType: 'centers', details: { field: 'scanner_mode', value: mode } });
      showSaved();
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="h-8 bg-bg-tertiary rounded w-48 mb-6 animate-pulse" />
            <div className="space-y-8">
              <section className="glass p-6">
                <div className="h-6 bg-bg-tertiary rounded w-32 mb-4 animate-pulse" />
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-16 glass/50 rounded-lg animate-pulse" />
                  ))}
                </div>
              </section>
            </div>
          </div>
        </div>
    );
  }

  return (
    <div className="min-h-screen">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <h1 className="text-2xl font-bold text-text-primary mb-6">{t('title')}</h1>

          {/* Sub-navigation: General | Billing | Team Members */}
          <div className="flex flex-wrap gap-2 mb-6">
            <span className="px-3 py-1.5 rounded-lg bg-indigo-100 dark:bg-indigo-900/50 text-indigo-800 dark:text-indigo-200 text-sm font-medium">
              {t('general', { defaultValue: 'General' })}
            </span>
            <Link
              href="/settings/billing"
              className="px-3 py-1.5 rounded-lg glass text-text-primary hover:bg-bg-secondary text-sm font-medium transition-colors"
            >
              {t('billing')}
            </Link>
            <Link
              href="/settings/team"
              className="px-3 py-1.5 rounded-lg glass text-text-primary hover:bg-bg-secondary text-sm font-medium transition-colors"
            >
              {t('teamMembers')}
            </Link>
          </div>

          {/* Success message */}
          {savedMessage && (
            <div className="mb-4 p-3 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-lg text-sm text-center">
              {savedMessage}
            </div>
          )}

          <div className="space-y-8">
            {/* Center Info */}
            <section className="glass p-6">
              <h2 className="text-lg font-semibold text-text-primary mb-4">{t('centerInfo')}</h2>
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  {center?.logo_url && !logoLoadFailed ? (
                    <img
                      src={center.logo_url}
                      alt="Logo"
                      className="w-16 h-16 rounded-lg object-cover"
                      onError={() => setLogoLoadFailed(true)}
                    />
                  ) : (
                    <Image src="/logo-icon.png" alt="CenterHQ" width={44} height={44} className="w-11 h-11 rounded-xl object-contain" />
                  )}
                  <label className="cursor-pointer px-4 py-2 text-sm font-medium border border-indigo-600 text-indigo-600 dark:text-indigo-400 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-950 transition-colors">
                    {(center?.logo_url && !logoLoadFailed) ? t('logoChange') : t('logoUpload')}
                    <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
                  </label>
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-1">{t('centerName')}</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={centerName}
                      onChange={(e) => setCenterName(e.target.value)}
                      className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-bg-tertiary text-text-primary text-sm"
                    />
                    <button
                      onClick={handleSaveCenterName}
                      className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
                    >
                      {tCommon('save')}
                    </button>
                  </div>
                </div>
              </div>
            </section>

            {/* Subjects */}
            <section className="glass p-6">
              <h2 className="text-lg font-semibold text-text-primary mb-4">{t('subjects')}</h2>
              
              {/* Existing subjects */}
              <div className="space-y-2 mb-4">
                {subjects.map((subject) => (
                  <div key={subject.id} className="flex items-center gap-3 p-3 bg-[var(--bg-card)] rounded-lg">
                    {editingSubject === subject.id ? (
                      <>
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="flex-1 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-sm bg-bg-tertiary text-text-primary"
                        />
                        <button onClick={() => handleUpdateSubject(subject.id)} className="text-green-600 text-sm font-medium">
                          {tCommon('save')}
                        </button>
                        <button onClick={() => setEditingSubject(null)} className="text-text-tertiary text-sm">
                          {tCommon('cancel')}
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="flex-1 text-sm text-text-primary font-medium">{subject.name}</span>
                        <button
                          onClick={() => { setEditingSubject(subject.id); setEditName(subject.name); }}
                          className="text-indigo-600 dark:text-indigo-400 text-xs"
                        >
                          {tCommon('edit')}
                        </button>
                        <button
                          onClick={() => handleDeleteSubject(subject.id)}
                          className="text-red-600 dark:text-red-400 text-xs"
                        >
                          {tCommon('delete')}
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>

              {/* Add subject form - subjects are categories only, fee is set per group */}
              <form onSubmit={handleAddSubject} className="flex gap-2">
                <input
                  type="text"
                  value={newSubjectName}
                  onChange={(e) => setNewSubjectName(e.target.value)}
                  placeholder={t('subjectName')}
                  className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-bg-tertiary text-text-primary text-sm"
                  required
                />
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors whitespace-nowrap"
                >
                  {t('addSubject')}
                </button>
              </form>
            </section>

            {/* Team Members - link to dedicated page */}
            <section className="glass p-6">
              <h2 className="text-lg font-semibold text-text-primary mb-2">{t('teamMembers')}</h2>
              <p className="text-sm text-text-secondary mb-4">{t('manageTeamDesc', { defaultValue: 'Manage assistants & teachers' })}</p>
              <Link
                href="/settings/team"
                className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg"
              >
                👥 {t('manageTeam', { defaultValue: 'Manage Team' })} →
              </Link>
            </section>

            {/* Scanner Config */}
            <section className="glass p-6">
              <h2 className="text-lg font-semibold text-text-primary mb-4">{t('scanner')}</h2>
              <p className="text-sm text-text-secondary mb-3">{t('defaultMode')}</p>
              <div className="flex gap-3">
                <button
                  onClick={() => handleScannerMode('camera')}
                  className={`flex-1 py-3 px-4 rounded-lg text-sm font-medium border-2 transition-colors ${
                    scannerMode === 'camera'
                      ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300'
                      : 'border-gray-300 dark:border-gray-600 text-text-secondary'
                  }`}
                >
                  {t('camera')}
                </button>
                <button
                  onClick={() => handleScannerMode('bluetooth')}
                  className={`flex-1 py-3 px-4 rounded-lg text-sm font-medium border-2 transition-colors ${
                    scannerMode === 'bluetooth'
                      ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300'
                      : 'border-gray-300 dark:border-gray-600 text-text-secondary'
                  }`}
                >
                  {t('bluetooth')}
                </button>
              </div>
            </section>

            {/* Referral */}
            <section className="glass rounded-xl shadow p-6 mb-6">
              <h2 className="text-lg font-semibold text-text-primary mb-4">{tReferral('title')}</h2>
              <p className="text-sm text-text-secondary mb-4" dir="ltr">
                {tReferral('shareText')}
              </p>
              <p className="text-sm text-text-secondary mb-4" dir="rtl">
                {tReferral('shareTextAr')}
              </p>
              {referralData && (
                <>
                  <div className="flex items-center gap-3 mb-4">
                    <code className="text-2xl font-mono font-bold text-indigo-600 dark:text-indigo-400 tracking-widest glass px-4 py-2 rounded-lg">
                      {referralData.referralCode || '—'}
                    </code>
                    <button
                      type="button"
                      onClick={async () => {
                        if (referralData.referralCode) {
                          await navigator.clipboard.writeText(referralData.referralCode);
                          setReferralCopied(true);
                          setTimeout(() => setReferralCopied(false), 2000);
                        }
                      }}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg"
                    >
                      {referralCopied ? tReferral('copied') : tReferral('copyCode')}
                    </button>
                  </div>
                  <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                    <span className="text-sm text-text-secondary">{tReferral('totalEarned')}</span>
                    <p className="text-xl font-bold text-text-primary">
                      {Number(referralData.totalEarned || 0).toLocaleString('ar-EG')} EGP
                    </p>
                  </div>
                  {(referralData.pending?.length ?? 0) > 0 && (
                    <div className="mb-4">
                      <h3 className="text-sm font-medium text-amber-700 dark:text-amber-400 mb-2">{tReferral('pendingReferrals', { defaultValue: 'Pending (awaiting first payment)' })}</h3>
                      <div className="space-y-2 text-sm">
                        {referralData.pending?.map((p, i) => (
                          <div key={i} className="flex justify-between items-center p-2 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
                            <span className="text-text-primary">{p.referred_center_name}</span>
                            <span className="text-amber-600 dark:text-amber-400 text-xs">{tReferral('awaitingPayment', { defaultValue: 'Awaiting first payment' })}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <h3 className="text-sm font-medium text-text-primary mb-2">{tReferral('rewardsTable')}</h3>
                  {(referralData.rewards?.length ?? 0) === 0 && (referralData.pending?.length ?? 0) === 0 ? (
                    <p className="text-sm text-text-secondary">{tReferral('noRewards')}</p>
                  ) : (referralData.rewards?.length ?? 0) > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-200 dark:border-gray-600">
                            <th className="text-start py-2 text-sm font-medium italic text-text-secondary">{tReferral('referredCenter')}</th>
                            <th className="text-start py-2 text-sm font-medium italic text-text-secondary">{tReferral('plan')}</th>
                            <th className="text-start py-2 text-sm font-medium italic text-text-secondary">{tReferral('rewardAmount')}</th>
                            <th className="text-start py-2 text-sm font-medium italic text-text-secondary">{tReferral('status')}</th>
                            <th className="text-start py-2 text-sm font-medium italic text-text-secondary">{tReferral('date')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(referralData.rewards ?? []).map((r) => (
                            <tr key={r.id || r.created_at + r.referred_center_name} className="border-b border-gray-100 dark:border-gray-700/50">
                              <td className="py-2 text-text-primary">{r.referred_center_name}</td>
                              <td className="py-2 text-text-secondary">{r.referred_center_plan}</td>
                              <td className="py-2 font-mono italic text-text-primary">{Number(r.reward_amount).toLocaleString('ar-EG')} EGP</td>
                              <td className="py-2">
                                <span className={`px-2 py-0.5 text-xs font-medium italic rounded-full ${
                                  r.reward_status === 'paid' ? 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300' :
                                  r.reward_status === 'pending' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300' :
                                  'bg-gray-100 text-gray-800'
                                }`}>
                                  {r.reward_status}
                                </span>
                              </td>
                              <td className="py-2 text-text-secondary">
                                {new Date(r.created_at).toLocaleDateString('ar-EG')}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </>
              )}
            </section>

            {/* Billing link */}
            <section className="glass p-6">
              <h2 className="text-lg font-semibold text-text-primary mb-4">{t('billing')}</h2>
              <p className="text-sm text-text-secondary mb-4">{t('billingDesc')}</p>
              <Link
                href="/settings/billing"
                className="inline-flex items-center px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg"
              >
                {t('billingLink')} →
              </Link>
            </section>

            {/* WhatsApp Integration Placeholder */}
            <section className="glass p-6">
              <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-700">
                <p className="text-amber-800 dark:text-amber-200 text-sm" dir="ltr">
                  For WhatsApp integration, contact our support team: support@centerhq.com
                </p>
                <p className="text-amber-700 dark:text-amber-300 text-sm mt-2" dir="rtl">
                  لتفعيل خدمة الواتساب، تواصل مع فريق الدعم: support@centerhq.com
                </p>
              </div>
            </section>

            {/* Account / Logout */}
            <section className="glass p-6">
              <h2 className="text-lg font-semibold text-text-primary mb-4">
                {t('account', { defaultValue: 'Account' })}
              </h2>
              <div className="flex flex-wrap gap-3">
                <Link
                  href="/settings/reset-password"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {t('resetPassword', { defaultValue: 'Reset Password' })}
                </Link>
                <button
                  onClick={handleLogout}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {t('logout', { defaultValue: 'Logout' })}
                </button>
              </div>
            </section>
          </div>
        </div>
      </div>
  );
}
