'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { supabase } from '@/lib/supabase';
import Navbar from '@/components/Navbar';
import { Link } from '@/i18n/routing';

export default function WhatsAppSettingsPage() {
  const t = useTranslations('whatsapp');

  const [enabled, setEnabled] = useState(false);
  const [usage, setUsage] = useState({ sent: 0, included: 0, overage: 0 });
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState('starter');

  useEffect(() => {
    fetchSettings();
    fetchUsage();
  }, []);

  async function fetchSettings() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await fetch('/api/settings/whatsapp', {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      if (!response.ok) throw new Error('Failed to fetch');
      const data = await response.json();
      setEnabled(data.individual_alerts_enabled ?? false);
    } catch (err) {
      console.error('Fetch settings error:', err);
    } finally {
      setLoading(false);
    }
  }

  async function fetchUsage() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await fetch('/api/whatsapp/usage', {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      if (!response.ok) throw new Error('Failed to fetch usage');
      const data = await response.json();
      setUsage(data);
      if (data.plan) setPlan(data.plan);
    } catch (err) {
      console.error('Fetch usage error:', err);
    }
  }

  async function toggleAlerts() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await fetch('/api/settings/whatsapp', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ individual_alerts_enabled: !enabled }),
      });

      if (!response.ok) throw new Error('Failed to update');
      setEnabled(!enabled);
    } catch (err) {
      console.error('Toggle error:', err);
      alert(t('updateError'));
    }
  }

  const planLimits: Record<string, { perStudent: number; name: string }> = {
    starter: { perStudent: 10, name: 'Starter' },
    pro: { perStudent: 12, name: 'Pro' },
    enterprise: { perStudent: 15, name: 'Enterprise' },
  };
  const limit = planLimits[plan] || planLimits.starter;
  const usagePct = usage.included > 0 ? Math.min((usage.sent / usage.included) * 100, 100) : 0;

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
            <Link
              href="/settings"
              className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              ← {t('backToSettings')}
            </Link>
          </div>

          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-6">
            {t('title')}
          </h1>

          {/* Individual Alerts Toggle */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 mb-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-1">
                  {t('individualAlerts')}
                </h2>
                <p className="text-gray-600 dark:text-gray-400 text-sm">
                  {t('alertsDescription')}
                </p>
              </div>
              <button
                onClick={toggleAlerts}
                role="switch"
                aria-checked={enabled}
                className={`relative inline-flex h-8 w-14 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${
                  enabled ? 'bg-indigo-600' : 'bg-gray-200 dark:bg-gray-600'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-7 w-7 transform rounded-full bg-white shadow ring-0 transition ${
                    enabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
            {enabled && (
              <div className="mt-4 p-4 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg">
                <p className="text-sm text-indigo-800 dark:text-indigo-200">
                  ✓ {t('alertsActive')}
                </p>
              </div>
            )}
          </div>

          {/* Usage Stats */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
              {t('monthlyUsage')}
            </h2>

            <div className="mb-6">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-gray-600 dark:text-gray-400">{t('messagesSent')}</span>
                <span className="font-semibold text-gray-900 dark:text-white">
                  {usage.sent} / {usage.included}
                </span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
                <div
                  className={`h-3 rounded-full transition-all ${
                    usage.sent > usage.included ? 'bg-red-500' : 'bg-green-500'
                  }`}
                  style={{ width: `${usagePct}%` }}
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 text-center mb-6">
              <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                <div className="text-2xl font-bold text-gray-900 dark:text-white">{usage.sent}</div>
                <div className="text-xs text-gray-600 dark:text-gray-400">{t('sent')}</div>
              </div>
              <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                <div className="text-2xl font-bold text-gray-900 dark:text-white">{usage.included}</div>
                <div className="text-xs text-gray-600 dark:text-gray-400">{t('included')}</div>
              </div>
              <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                <div className="text-2xl font-bold text-red-600 dark:text-red-400">{usage.overage}</div>
                <div className="text-xs text-gray-600 dark:text-gray-400">{t('overage')}</div>
              </div>
            </div>

            <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg space-y-1 text-sm">
              <p className="text-gray-700 dark:text-gray-300">
                <strong>{t('yourPlan')}:</strong> {limit.name}
              </p>
              <p className="text-gray-700 dark:text-gray-300">
                <strong>{t('includedPerStudent')}:</strong> {limit.perStudent} {t('messagesMonth')}
              </p>
              <p className="text-gray-700 dark:text-gray-300">
                <strong>{t('overageCost')}:</strong> EGP 0.25 {t('perMessage')}
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
