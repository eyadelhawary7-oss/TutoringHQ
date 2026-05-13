'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Settings, X } from 'lucide-react';
import { formatDate } from '@/lib/formatNumber';
import {
  clearPendingScansOnly,
  getLastSuccessfulSync,
  getUnsyncedCount,
  recordLastSuccessfulSyncNow,
} from '@/lib/db';
import { syncQueuedScans } from '@/lib/sync';
import { cairoDateKey } from '@/lib/cairo/day';
import { useLayout } from '@/contexts/LayoutContext';
import PasswordConfirmModal from '@/components/PasswordConfirmModal';
import { supabase } from '@/lib/supabase';

const KIOSK_LS = 'scanner.kioskLocked';

async function detectSwVersion(): Promise<string | null> {
  try {
    const keys = await caches.keys();
    const hit = keys.find((k) => /^centerhq-v\d+/.test(k) || k.includes('centerhq-v5'));
    if (hit) {
      const m = hit.match(/centerhq-v(\d+)/);
      return m ? `centerhq-v${m[1]}` : hit;
    }
  } catch {
    //
  }
  return null;
}

interface SyncStatusPanelProps {
  probeOk: boolean;
  onPendingChanged?: () => void;
}

export default function SyncStatusPanel({ probeOk, onPendingChanged }: SyncStatusPanelProps) {
  const t = useTranslations('scanner.syncPanel');
  const tc = useTranslations('common');
  const locale = useLocale();
  const { scannerKioskLocked, setScannerKioskLocked } = useLayout();

  const [open, setOpen] = useState(false);
  const [swVer, setSwVer] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [kioskUnlockOpen, setKioskUnlockOpen] = useState(false);
  const [pinError, setPinError] = useState('');
  const [pinLoading, setPinLoading] = useState(false);

  const cairoToday = cairoDateKey();

  const refresh = useCallback(async () => {
    const [v, n, ls] = await Promise.all([detectSwVersion(), getUnsyncedCount(), getLastSuccessfulSync()]);
    setSwVer(v);
    setPending(n);
    setLastSync(ls);
  }, []);

  useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const locked = localStorage.getItem(KIOSK_LS) === '1';
    setScannerKioskLocked(locked);
  }, [setScannerKioskLocked]);

  const handleRetryNow = async () => {
    setRetrying(true);
    try {
      await syncQueuedScans();
      const n = await getUnsyncedCount();
      setPending(n);
      if (n === 0) await recordLastSuccessfulSyncNow();
      setLastSync(await getLastSuccessfulSync());
      onPendingChanged?.();
    } finally {
      setRetrying(false);
    }
  };

  const confirmClearPending = async () => {
    await clearPendingScansOnly();
    setClearOpen(false);
    await refresh();
    onPendingChanged?.();
  };

  const toggleKiosk = (next: boolean) => {
    if (typeof window === 'undefined') return;
    if (next) {
      localStorage.setItem(KIOSK_LS, '1');
      setScannerKioskLocked(true);
    } else {
      setKioskUnlockOpen(true);
    }
  };

  const verifyUnlockPin = async (pin: string) => {
    setPinLoading(true);
    setPinError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setPinError(tc('notAuthenticated', { defaultValue: 'Not signed in' }));
        return;
      }
      const res = await fetch('/api/auth/verify-session-pin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ pin }),
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!body.ok) {
        setPinError(body.error ?? tc('invalidPin', { defaultValue: 'Invalid PIN' }));
        return;
      }
      localStorage.removeItem(KIOSK_LS);
      setScannerKioskLocked(false);
      setKioskUnlockOpen(false);
    } finally {
      setPinLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] text-[var(--color-text-primary)] shadow-sm hover:border-teal-500/40"
        aria-label={t('openSettings')}
      >
        <Settings className="h-5 w-5" />
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="w-full max-w-md rounded-t-2xl sm:rounded-2xl bg-[var(--color-surface-1)] shadow-xl border border-[var(--color-border-subtle)] max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] px-4 py-3">
              <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">{t('title')}</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-2 hover:bg-[var(--color-surface-0)]"
                aria-label={t('dismiss')}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 px-4 py-4 text-sm text-[var(--color-text-secondary)]">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-tertiary)]">{t('swVersion')}</p>
                <p className="text-[var(--color-text-primary)] font-mono">{swVer ?? ','}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-tertiary)]">{t('pendingQueue')}</p>
                <p className="text-[var(--color-text-primary)]">{pending}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-tertiary)]">{t('lastSync')}</p>
                <p className="text-[var(--color-text-primary)]">
                  {lastSync ? formatDate(new Date(lastSync), locale, 'time') : ','}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-tertiary)]">{t('cairoToday')}</p>
                <p className="text-[var(--color-text-primary)]" dir="ltr">
                  {cairoToday}
                </p>
              </div>

              <label className="flex items-center justify-between gap-3 rounded-xl border border-[var(--color-border-subtle)] px-3 py-3">
                <span className="text-[var(--color-text-primary)] font-medium">{t('kioskLock')}</span>
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-teal-600"
                  checked={scannerKioskLocked}
                  onChange={(e) => toggleKiosk(e.target.checked)}
                />
              </label>

              <button
                type="button"
                disabled={retrying || !probeOk}
                onClick={() => void handleRetryNow()}
                className="w-full rounded-xl bg-teal-600 py-3 font-semibold text-white disabled:opacity-50"
              >
                {retrying ? tc('loading') : t('retryNow')}
              </button>
              <button
                type="button"
                onClick={() => setClearOpen(true)}
                className="w-full rounded-xl border border-[var(--color-border-default)] py-3 font-semibold text-[var(--color-text-primary)]"
              >
                {t('clearPending')}
              </button>
            </div>
          </div>
        </div>
      )}

      {clearOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
          <div className="max-w-sm rounded-2xl bg-[var(--color-surface-1)] p-6 shadow-xl border border-[var(--color-border-subtle)]">
            <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-2">{t('clearConfirmTitle')}</h3>
            <p className="text-sm text-[var(--color-text-secondary)] mb-4">{t('clearConfirmBody')}</p>
            <div className="flex gap-2 justify-end">
              <button type="button" className="px-4 py-2 rounded-lg border border-[var(--color-border-default)]" onClick={() => setClearOpen(false)}>
                {tc('cancel')}
              </button>
              <button type="button" className="px-4 py-2 rounded-lg bg-red-600 text-white" onClick={() => void confirmClearPending()}>
                {tc('confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      <PasswordConfirmModal
        isOpen={kioskUnlockOpen}
        onClose={() => {
          setKioskUnlockOpen(false);
          setPinError('');
        }}
        title={t('kioskUnlockTitle')}
        message={t('kioskUnlockMessage')}
        error={pinError}
        loading={pinLoading}
        onConfirm={verifyUnlockPin}
      />
    </>
  );
}
