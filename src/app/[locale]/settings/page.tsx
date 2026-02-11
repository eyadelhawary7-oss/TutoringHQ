'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { dbSelect, dbInsert, dbUpdate, dbDelete, dbCount } from '@/lib/db-proxy';
import { useUser } from '@/contexts/UserContext';
import Navbar from '@/components/Navbar';

interface Subject {
  id: string;
  name: string;
  monthly_fee: number;
}

interface Assistant {
  id: string;
  phone: string;
  role: string;
}

interface CenterInfo {
  id: string;
  name: string;
  logo_url: string | null;
  scanner_default_mode: string;
}

export default function SettingsPage() {
  const t = useTranslations('settings');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { user: currentUser } = useUser();

  const [center, setCenter] = useState<CenterInfo | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [centerId, setCenterId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [savedMessage, setSavedMessage] = useState('');

  // Form states
  const [centerName, setCenterName] = useState('');
  const [newSubjectName, setNewSubjectName] = useState('');
  const [newSubjectFee, setNewSubjectFee] = useState('');
  const [invitePhone, setInvitePhone] = useState('');
  const [inviteRole, setInviteRole] = useState('assistant');
  const [scannerMode, setScannerMode] = useState('camera');
  const [editingSubject, setEditingSubject] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editFee, setEditFee] = useState('');

  // Redirect assistants away from settings
  useEffect(() => {
    if (currentUser && currentUser.role === 'assistant') {
      router.replace('/dashboard');
    }
  }, [currentUser, router]);

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
      }

      // Load subjects (bypass RLS)
      const { data: subjectsData } = await dbSelect({
        table: 'subjects',
        select: '*',
        filters: [{ column: 'center_id', op: 'eq', value: userCenterId }],
        order: { column: 'name' },
      });

      if (subjectsData) setSubjects(subjectsData as Subject[]);

      // Load assistants (bypass RLS)
      const { data: assistantsData } = await dbSelect({
        table: 'users',
        select: 'id, phone, role',
        filters: [
          { column: 'center_id', op: 'eq', value: userCenterId },
          { column: 'id', op: 'neq', value: session.user.id },
        ],
      });

      if (assistantsData) setAssistants(assistantsData as Assistant[]);

      setIsLoading(false);
    };
    load();
  }, []);

  const showSaved = () => {
    setSavedMessage(t('saved'));
    setTimeout(() => setSavedMessage(''), 2000);
  };

  const handleSaveCenterName = async () => {
    if (!centerId || !centerName.trim()) return;
    const { error } = await dbUpdate({
      table: 'centers',
      data: { name: centerName.trim() },
      filters: [{ column: 'id', op: 'eq', value: centerId }],
    });
    if (!error) showSaved();
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !centerId) return;

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
    await dbUpdate({
      table: 'centers',
      data: { logo_url: publicData.publicUrl },
      filters: [{ column: 'id', op: 'eq', value: centerId }],
    });
    setCenter(prev => prev ? { ...prev, logo_url: publicData.publicUrl } : null);
    showSaved();
  };

  const handleAddSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!centerId || !newSubjectName.trim()) return;

    const { data, error } = await dbInsert({
      table: 'subjects',
      data: {
        center_id: centerId,
        name: newSubjectName.trim(),
        monthly_fee: Number(newSubjectFee) || 0,
      },
      single: true,
    });

    if (!error && data) {
      setSubjects(prev => [...prev, data as Subject]);
      setNewSubjectName('');
      setNewSubjectFee('');
      showSaved();
    }
  };

  const handleUpdateSubject = async (id: string) => {
    await dbUpdate({
      table: 'subjects',
      data: { name: editName.trim(), monthly_fee: Number(editFee) || 0 },
      filters: [{ column: 'id', op: 'eq', value: id }],
    });

    setSubjects(prev => prev.map(s => s.id === id ? { ...s, name: editName.trim(), monthly_fee: Number(editFee) || 0 } : s));
    setEditingSubject(null);
    showSaved();
  };

  const handleDeleteSubject = async (id: string) => {
    if (!confirm(t('deleteConfirm'))) return;

    // Check if any students use this subject
    const { count } = await dbCount({
      table: 'students',
      filters: [{ column: 'subject_id', op: 'eq', value: id }],
    });

    if (count && count > 0) {
      alert(t('subjectInUse'));
      return;
    }

    await dbDelete({
      table: 'subjects',
      filters: [{ column: 'id', op: 'eq', value: id }],
    });
    setSubjects(prev => prev.filter(s => s.id !== id));
  };

  const handleInviteAssistant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!centerId || !invitePhone.trim()) return;

    const { data, error } = await dbInsert({
      table: 'users',
      data: {
        phone: invitePhone.trim(),
        center_id: centerId,
        role: inviteRole,
      },
      select: 'id, phone, role',
      single: true,
    });

    if (!error && data) {
      setAssistants(prev => [...prev, data as Assistant]);
      setInvitePhone('');
      showSaved();
    }
  };

  const handleScannerMode = async (mode: string) => {
    if (!centerId) return;
    setScannerMode(mode);
    const { error } = await dbUpdate({
      table: 'centers',
      data: { scanner_default_mode: mode },
      filters: [{ column: 'id', op: 'eq', value: centerId }],
    });
    if (!error) showSaved();
  };

  if (isLoading) {
    return (
      <>
        <Navbar />
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
          <svg className="animate-spin h-8 w-8 text-indigo-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        </div>
      </>
    );
  }

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">{t('title')}</h1>

          {/* Success message */}
          {savedMessage && (
            <div className="mb-4 p-3 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-lg text-sm text-center">
              {savedMessage}
            </div>
          )}

          <div className="space-y-8">
            {/* Center Info */}
            <section className="bg-white dark:bg-gray-800 rounded-xl shadow p-6">
              <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">{t('centerInfo')}</h2>
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  {center?.logo_url ? (
                    <img src={center.logo_url} alt="Logo" className="w-16 h-16 rounded-lg object-cover" />
                  ) : (
                    <div className="w-16 h-16 bg-indigo-100 dark:bg-indigo-900 rounded-lg flex items-center justify-center">
                      <span className="text-xl font-bold text-indigo-600 dark:text-indigo-400">RG</span>
                    </div>
                  )}
                  <label className="cursor-pointer px-4 py-2 text-sm font-medium border border-indigo-600 text-indigo-600 dark:text-indigo-400 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-950 transition-colors">
                    {center?.logo_url ? t('logoChange') : t('logoUpload')}
                    <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
                  </label>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('centerName')}</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={centerName}
                      onChange={(e) => setCenterName(e.target.value)}
                      className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm"
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
            <section className="bg-white dark:bg-gray-800 rounded-xl shadow p-6">
              <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">{t('subjects')}</h2>
              
              {/* Existing subjects */}
              <div className="space-y-2 mb-4">
                {subjects.map((subject) => (
                  <div key={subject.id} className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700/30 rounded-lg">
                    {editingSubject === subject.id ? (
                      <>
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="flex-1 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-sm dark:bg-gray-700 dark:text-white"
                        />
                        <input
                          type="number"
                          value={editFee}
                          onChange={(e) => setEditFee(e.target.value)}
                          className="w-24 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-sm dark:bg-gray-700 dark:text-white"
                        />
                        <button onClick={() => handleUpdateSubject(subject.id)} className="text-green-600 text-sm font-medium">
                          {tCommon('save')}
                        </button>
                        <button onClick={() => setEditingSubject(null)} className="text-gray-400 text-sm">
                          {tCommon('cancel')}
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="flex-1 text-sm text-gray-900 dark:text-white font-medium">{subject.name}</span>
                        <span className="text-sm text-gray-500 dark:text-gray-400">{subject.monthly_fee} EGP</span>
                        <button
                          onClick={() => { setEditingSubject(subject.id); setEditName(subject.name); setEditFee(String(subject.monthly_fee)); }}
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

              {/* Add subject form */}
              <form onSubmit={handleAddSubject} className="flex gap-2">
                <input
                  type="text"
                  value={newSubjectName}
                  onChange={(e) => setNewSubjectName(e.target.value)}
                  placeholder={t('subjectName')}
                  className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm"
                  required
                />
                <input
                  type="number"
                  value={newSubjectFee}
                  onChange={(e) => setNewSubjectFee(e.target.value)}
                  placeholder={t('monthlyFee')}
                  className="w-28 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm"
                />
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors whitespace-nowrap"
                >
                  {t('addSubject')}
                </button>
              </form>
            </section>

            {/* Assistants */}
            <section className="bg-white dark:bg-gray-800 rounded-xl shadow p-6">
              <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">{t('assistants')}</h2>

              {/* Existing assistants */}
              <div className="space-y-2 mb-4">
                {assistants.map((assistant) => (
                  <div key={assistant.id} className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700/30 rounded-lg">
                    <span className="flex-1 text-sm text-gray-900 dark:text-white" dir="ltr">{assistant.phone}</span>
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                      assistant.role === 'admin'
                        ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300'
                        : 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300'
                    }`}>
                      {assistant.role === 'admin' ? t('admin') : t('assistant')}
                    </span>
                  </div>
                ))}
                {assistants.length === 0 && (
                  <p className="text-sm text-gray-400 dark:text-gray-500">---</p>
                )}
              </div>

              {/* Invite form */}
              <form onSubmit={handleInviteAssistant} className="flex gap-2">
                <input
                  type="tel"
                  value={invitePhone}
                  onChange={(e) => setInvitePhone(e.target.value)}
                  placeholder={t('invitePhone')}
                  dir="ltr"
                  className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm"
                  required
                />
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm"
                >
                  <option value="assistant">{t('assistant')}</option>
                  <option value="admin">{t('admin')}</option>
                </select>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors whitespace-nowrap"
                >
                  {t('invite')}
                </button>
              </form>
            </section>

            {/* Scanner Config */}
            <section className="bg-white dark:bg-gray-800 rounded-xl shadow p-6">
              <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">{t('scanner')}</h2>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">{t('defaultMode')}</p>
              <div className="flex gap-3">
                <button
                  onClick={() => handleScannerMode('camera')}
                  className={`flex-1 py-3 px-4 rounded-lg text-sm font-medium border-2 transition-colors ${
                    scannerMode === 'camera'
                      ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300'
                      : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400'
                  }`}
                >
                  {t('camera')}
                </button>
                <button
                  onClick={() => handleScannerMode('bluetooth')}
                  className={`flex-1 py-3 px-4 rounded-lg text-sm font-medium border-2 transition-colors ${
                    scannerMode === 'bluetooth'
                      ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300'
                      : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400'
                  }`}
                >
                  {t('bluetooth')}
                </button>
              </div>
            </section>

            {/* WhatsApp Integration */}
            <section className="bg-white dark:bg-gray-800 rounded-xl shadow p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 bg-green-100 dark:bg-green-900 rounded-lg flex items-center justify-center">
                  <svg className="w-5 h-5 text-green-600 dark:text-green-400" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                    <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.955 9.955 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18a8 8 0 01-4.243-1.217l-.271-.162-2.87.853.853-2.87-.162-.271A8 8 0 1112 20z"/>
                  </svg>
                </div>
                <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">WhatsApp Business API</h2>
              </div>
              
              <div className="space-y-4">
                <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                  <h3 className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-2">Setup Instructions</h3>
                  <ol className="text-sm text-gray-600 dark:text-gray-400 space-y-2 list-decimal list-inside">
                    <li>Create a Meta Business App at <a href="https://developers.facebook.com" target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-indigo-400 underline">developers.facebook.com</a></li>
                    <li>Add WhatsApp product to your app</li>
                    <li>Get your permanent access token and Phone Number ID</li>
                    <li>Create a message template named <code className="px-1 bg-gray-200 dark:bg-gray-600 rounded text-xs">payment_reminder</code></li>
                    <li>Add the env vars to your deployment (Vercel)</li>
                    <li>Set webhook URL to: <code className="px-1 bg-gray-200 dark:bg-gray-600 rounded text-xs break-all">{typeof window !== 'undefined' ? window.location.origin : ''}/api/whatsapp/webhook</code></li>
                  </ol>
                </div>

                <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
                  <h3 className="text-sm font-medium text-green-800 dark:text-green-300 mb-2">Required Environment Variables</h3>
                  <div className="space-y-1 font-mono text-xs text-green-700 dark:text-green-400">
                    <p>WHATSAPP_ACCESS_TOKEN=your_token</p>
                    <p>WHATSAPP_PHONE_NUMBER_ID=your_phone_id</p>
                    <p>WHATSAPP_VERIFY_TOKEN=your_verify_token</p>
                  </div>
                </div>

                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <h3 className="text-sm font-medium text-blue-800 dark:text-blue-300 mb-2">Template Format</h3>
                  <p className="text-sm text-blue-700 dark:text-blue-400">
                    Create a template named <strong>payment_reminder</strong> with 4 body parameters:
                  </p>
                  <div className="mt-2 text-xs text-blue-600 dark:text-blue-400 font-mono">
                    {'{{1}}'} = Student Name<br/>
                    {'{{2}}'} = Center Name<br/>
                    {'{{3}}'} = Amount Due<br/>
                    {'{{4}}'} = Subject Name
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
