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
import {
  SettingsControlRow,
  SettingsGroup,
  SettingsGroupHelp,
  SettingsGroupLabel,
} from '@/components/settings/SettingsRows';

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

        {/* §06 Scanner, drawn as the design's "SCAN INPUT" group.

            The design's other three groups are NOT drawn, and were not skipped
            for effort — D10, decided 28 July, do not build, re-confirmed
            against the live catalog this pass:
              · "Camera · Back/Front", "Sound", "Vibrate" and "Ignore repeat
                scans within 5 min" have no backing column. The full live
                `centers` column list contains exactly ONE column whose name
                mentions the scanner — `scanner_default_mode` — which is the row
                below.
              · "Mark attendance automatically" is a different class of thing
                again: it changes what gets WRITTEN to `attendance_scans` on
                every scan, so it is Eyad's call regardless of where the
                preference would be stored. */}
        <div>
          <SettingsGroupLabel>{t('scannerTitle')}</SettingsGroupLabel>
          <SettingsGroup>
            <SettingsControlRow icon={QrCode} label={t('defaultMode')}>
              <div className="flex gap-1 rounded-sm bg-[var(--color-tile)] p-1">
                <button
                  type="button"
                  onClick={() => handleScannerMode('camera')}
                  aria-pressed={scannerMode === 'camera'}
                  className={`rounded-xs px-3 py-1.5 text-base font-medium transition-colors ${scannerMode === 'camera' ? 'bg-[var(--color-panel)] text-[var(--color-ink)] shadow-sm' : 'text-[var(--color-mid)] hover:text-[var(--color-ink)]'}`}
                >
                  {t('camera')}
                </button>
                <button
                  type="button"
                  onClick={() => handleScannerMode('bluetooth')}
                  aria-pressed={scannerMode === 'bluetooth'}
                  className={`rounded-xs px-3 py-1.5 text-base font-medium transition-colors ${scannerMode === 'bluetooth' ? 'bg-[var(--color-panel)] text-[var(--color-ink)] shadow-sm' : 'text-[var(--color-mid)] hover:text-[var(--color-ink)]'}`}
                >
                  {t('bluetooth')}
                </button>
              </div>
            </SettingsControlRow>
          </SettingsGroup>
          <SettingsGroupHelp>{t('menu.scannerDesc')}</SettingsGroupHelp>
        </div>
      </div>
    </div>
  );
}
