'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { supabase } from '@/lib/supabase';
import Navbar from '@/components/Navbar';
import { Link } from '@/i18n/routing';

export default function RemindersSettingsPage() {
  const t = useTranslations('reminders');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState({
    day5_enabled: true,
    day10_enabled: true,
    day15_enabled: true,
  });

  useEffect(() => {
    fetchSettings();
  }, []);

  async function fetchSettings() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await fetch('/api/settings/reminders', {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      if (!response.ok) throw new Error('Failed to fetch');
      const data = await response.json();
      if (data.settings) {
        setSettings({
          day5_enabled: data.settings.day5_enabled ?? true,
          day10_enabled: data.settings.day10_enabled ?? true,
          day15_enabled: data.settings.day15_enabled ?? true,
        });
      }
    } catch (err) {
      console.error('Fetch settings error:', err);
    } finally {
      setLoading(false);
    }
  }

  async function saveSettings() {
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await fetch('/api/settings/reminders', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(settings),
      });

      if (!response.ok) throw new Error('Failed to save');
      setSavedMessage(t('saveSuccess'));
      setTimeout(() => setSavedMessage(''), 3000);
    } catch (err) {
      console.error('Save error:', err);
      setSavedMessage(t('saveError'));
      setTimeout(() => setSavedMessage(''), 4000);
    } finally {
      setSaving(false);
    }
  }

  const [savedMessage, setSavedMessage] = useState('');

  if (loading) {
    return (
      <>
        <Navbar />
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
          <div className="animate-pulse">{t('loading')}</div>
        </div>
      </>
    );
  }

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="mb-6">
            <Link href="/settings" className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">
              ← {t('backToSettings', { defaultValue: 'Back to Settings' })}
            </Link>
          </div>

          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-6">
            {t('title')}
          </h1>

          {savedMessage && (
            <div className="mb-4 p-3 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-lg text-sm">
              {savedMessage}
            </div>
          )}

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 mb-6">
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              {t('description')}
            </p>

            {[5, 10, 15].map((day) => {
              const key = `day${day}_enabled` as keyof typeof settings;
              const titleKey = `day${day}Title` as keyof typeof t;
              const descKey = `day${day}Desc` as keyof typeof t;
              return (
                <div key={day} className={`mb-6 p-4 border rounded-lg ${day === 15 ? 'border-red-200 dark:border-red-800' : 'border-gray-200 dark:border-gray-700'}`}>
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h3 className={`text-lg font-semibold ${day === 15 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>
                        {t(titleKey)}
                      </h3>
                      <p className="text-sm text-gray-600 dark:text-gray-400">{t(descKey)}</p>
                    </div>
                    <button
                      onClick={() => setSettings({ ...settings, [key]: !settings[key] })}
                      role="switch"
                      aria-checked={settings[key]}
                      className={`relative inline-flex h-8 w-14 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                        settings[key] ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-gray-600'
                      }`}
                    >
                      <span
                        className={`inline-block h-7 w-7 transform rounded-full bg-white shadow transition ${
                          settings[key] ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              );
            })}

            <button
              onClick={saveSettings}
              disabled={saving}
              className="w-full py-3 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? t('saving') : t('save')}
            </button>
          </div>

          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
            <p className="text-sm text-amber-800 dark:text-amber-200">
              <strong>ℹ️ {t('note')}:</strong> {t('cronNote')}
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
