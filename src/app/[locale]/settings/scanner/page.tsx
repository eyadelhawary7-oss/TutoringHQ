'use client';

import { useState, useEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter, Link } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { dbSelect, dbUpdate, auditLog } from '@/lib/db-proxy';
import { useUser } from '@/contexts/UserContext';
import { PageHeader } from '@/components/shared';
import { QrCode, ChevronRight } from 'lucide-react';
import { DirectionalIcon } from '@/components/icons/DirectionalIcon';

export default function ScannerSettingsPage() {
  const t = useTranslations('settings');
  const router = useRouter();
  const locale = useLocale();
  const { user: currentUser, hasPermission } = useUser();
  const isRTL = locale === 'ar';

  const [centerId, setCenterId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [scannerMode, setScannerMode] = useState('camera');

  useEffect(() => {
    if (currentUser && (currentUser.role === 'assistant' || currentUser.role === 'teacher') && !hasPermission('can_view_settings')) {
      router.replace('/dashboard');
    }
  }, [currentUser, hasPermission, router]);

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setIsLoading(false);
        return;
      }
      setUserId(session.user.id);
      const meRes = await fetch('/api/me', { headers: { Authorization: `Bearer ${session.access_token}` } });
      const meData = await meRes.json();
      if (!meData?.user?.center_id) {
        setIsLoading(false);
        return;
      }
      const userCenterId = meData.user.center_id;
      setCenterId(userCenterId);

      const { data: centerData } = await dbSelect({
        table: 'centers',
        select: 'scanner_default_mode',
        filters: [{ column: 'id', op: 'eq', value: userCenterId }],
        single: true,
      });
      if (centerData) {
        setScannerMode((centerData as { scanner_default_mode?: string }).scanner_default_mode || 'camera');
      }
      setIsLoading(false);
    };
    load();
  }, []);

  const handleScannerMode = async (mode: string) => {
    if (!centerId || !userId) return;
    setScannerMode(mode);
    const { error } = await dbUpdate({ table: 'centers', data: { scanner_default_mode: mode }, filters: [{ column: 'id', op: 'eq', value: centerId }] });
    if (!error) {
      await auditLog({ centerId, userId, action: 'center_update', entityType: 'centers', details: { field: 'scanner_mode', value: mode } });
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen w-full bg-[var(--color-surface-0)]">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-4" aria-busy>
          <div className="skeleton h-8 rounded-xl w-48" />
          <div className="skeleton h-28 rounded-2xl w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-[var(--color-surface-0)] page-enter" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <PageHeader title={t('scannerTitle')} />
        <div className="mb-6">
          <Link
            href="/settings/general"
            className="inline-flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            <DirectionalIcon icon={ChevronRight} className="w-4 h-4 rotate-180" />
            {t('title')}
          </Link>
        </div>

        <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] card-shadow">
          <div className="flex items-center gap-4 p-6 border-b border-[var(--color-border-subtle)]">
            <div className="p-2 bg-teal-100 rounded-xl shrink-0">
              <QrCode className="w-4 h-4 text-teal-600" aria-hidden />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-[var(--color-text-primary)]">{t('scannerTitle')}</h3>
              <p className="text-sm text-[var(--color-text-muted)] mt-0.5">{t('defaultMode')}</p>
            </div>
          </div>
          <div className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-[var(--color-text-primary)]">{t('defaultMode')}</p>
                <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">{t('defaultMode')}</p>
              </div>
              <div className="flex gap-1 bg-[var(--color-surface-2)] p-1 rounded-lg">
                <button
                  type="button"
                  onClick={() => handleScannerMode('camera')}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${scannerMode === 'camera' ? 'bg-[var(--color-surface-1)] shadow-sm text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}
                >
                  {t('camera')}
                </button>
                <button
                  type="button"
                  onClick={() => handleScannerMode('bluetooth')}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${scannerMode === 'bluetooth' ? 'bg-[var(--color-surface-1)] shadow-sm text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}
                >
                  {t('bluetooth')}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
