'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { supabase } from '@/lib/supabase';
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

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);

      const { data: userRecord } = await supabase
        .from('users')
        .select('center_id')
        .eq('id', user.id)
        .single();

      if (!userRecord) return;
      setCenterId(userRecord.center_id);

      // Load center info
      const { data: centerData } = await supabase
        .from('centers')
        .select('*')
        .eq('id', userRecord.center_id)
        .single();

      if (centerData) {
        setCenter(centerData);
        setCenterName(centerData.name || '');
        setScannerMode(centerData.scanner_default_mode || 'camera');
      }

      // Load subjects
      const { data: subjectsData } = await supabase
        .from('subjects')
        .select('*')
        .eq('center_id', userRecord.center_id)
        .order('name');

      if (subjectsData) setSubjects(subjectsData);

      // Load assistants
      const { data: assistantsData } = await supabase
        .from('users')
        .select('id, phone, role')
        .eq('center_id', userRecord.center_id)
        .neq('id', user.id);

      if (assistantsData) setAssistants(assistantsData);

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
    await supabase.from('centers').update({ name: centerName.trim() }).eq('id', centerId);
    showSaved();
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
    await supabase.from('centers').update({ logo_url: publicData.publicUrl }).eq('id', centerId);
    setCenter(prev => prev ? { ...prev, logo_url: publicData.publicUrl } : null);
    showSaved();
  };

  const handleAddSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!centerId || !newSubjectName.trim()) return;

    const { data, error } = await supabase
      .from('subjects')
      .insert({
        center_id: centerId,
        name: newSubjectName.trim(),
        monthly_fee: Number(newSubjectFee) || 0,
      })
      .select()
      .single();

    if (!error && data) {
      setSubjects(prev => [...prev, data]);
      setNewSubjectName('');
      setNewSubjectFee('');
      showSaved();
    }
  };

  const handleUpdateSubject = async (id: string) => {
    await supabase
      .from('subjects')
      .update({ name: editName.trim(), monthly_fee: Number(editFee) || 0 })
      .eq('id', id);

    setSubjects(prev => prev.map(s => s.id === id ? { ...s, name: editName.trim(), monthly_fee: Number(editFee) || 0 } : s));
    setEditingSubject(null);
    showSaved();
  };

  const handleDeleteSubject = async (id: string) => {
    if (!confirm(t('deleteConfirm'))) return;

    // Check if any students use this subject
    const { count } = await supabase
      .from('students')
      .select('*', { count: 'exact', head: true })
      .eq('subject_id', id);

    if (count && count > 0) {
      alert(t('subjectInUse'));
      return;
    }

    await supabase.from('subjects').delete().eq('id', id);
    setSubjects(prev => prev.filter(s => s.id !== id));
  };

  const handleInviteAssistant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!centerId || !invitePhone.trim()) return;

    const { data, error } = await supabase
      .from('users')
      .insert({
        phone: invitePhone.trim(),
        center_id: centerId,
        role: inviteRole,
      })
      .select()
      .single();

    if (!error && data) {
      setAssistants(prev => [...prev, data]);
      setInvitePhone('');
      showSaved();
    }
  };

  const handleScannerMode = async (mode: string) => {
    if (!centerId) return;
    setScannerMode(mode);
    await supabase.from('centers').update({ scanner_default_mode: mode }).eq('id', centerId);
    showSaved();
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
          </div>
        </div>
      </div>
    </>
  );
}
