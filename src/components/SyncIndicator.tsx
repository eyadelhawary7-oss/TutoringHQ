'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { syncQueuedScans, type SyncStatus } from '@/lib/sync';
import { getUnsyncedCount } from '@/lib/db';

export default function SyncIndicator() {
  const t = useTranslations('sync');

  const [status, setStatus] = useState<SyncStatus>('online');
  const [pendingCount, setPendingCount] = useState(0);
  const [showTooltip, setShowTooltip] = useState(false);

  const updatePendingCount = useCallback(async () => {
    try {
      const count = await getUnsyncedCount();
      setPendingCount(count);
    } catch {
      // IndexedDB not available
    }
  }, []);

  const performSync = useCallback(async () => {
    if (status === 'syncing') return;
    setStatus('syncing');

    try {
      const result = await syncQueuedScans();
      if (result.synced > 0) {
        await updatePendingCount();
      }
      setStatus('online');
    } catch {
      setStatus('online');
    }
  }, [status, updatePendingCount]);

  useEffect(() => {
    // Set initial online status
    setStatus(navigator.onLine ? 'online' : 'offline');

    const handleOnline = () => {
      setStatus('online');
      performSync();
    };

    const handleOffline = () => {
      setStatus('offline');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Check pending count periodically
    updatePendingCount();
    const interval = setInterval(updatePendingCount, 10000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, [performSync, updatePendingCount]);

  const statusColors = {
    online: 'bg-green-500',
    offline: 'bg-red-500',
    syncing: 'bg-blue-500 animate-pulse',
  };

  const statusLabels = {
    online: t('online'),
    offline: t('offline'),
    syncing: t('syncing'),
  };

  return (
    <div
      className="relative"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      onClick={() => {
        if (status === 'online' && pendingCount > 0) performSync();
      }}
    >
      <div className={`w-3 h-3 rounded-full ${statusColors[status]} cursor-pointer`} />

      {/* Pending badge */}
      {pendingCount > 0 && status !== 'syncing' && (
        <span className="absolute -top-1 -end-1 w-4 h-4 bg-orange-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
          {pendingCount > 9 ? '9+' : pendingCount}
        </span>
      )}

      {/* Tooltip */}
      {showTooltip && (
        <div className="absolute top-full start-1/2 -translate-x-1/2 mt-2 px-3 py-1.5 bg-gray-900 text-white text-xs rounded-lg whitespace-nowrap z-50">
          {statusLabels[status]}
          {pendingCount > 0 && (
            <span className="block text-text-tertiary">
              {t('pendingScans', { count: pendingCount })}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
