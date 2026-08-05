'use client';

import { useEffect, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { CloudUpload } from 'lucide-react';
import { EmptyState } from '@/components/shared';
import { formatDate } from '@/lib/formatNumber';
import {
  getPendingScanRows,
  lookupStudentNumberOffline,
  getUnsyncedCount,
} from '@/lib/db';
import { syncQueuedScans } from '@/lib/sync';
import type { PendingScanRow } from '@/lib/db';

interface PendingSyncSheetProps {
  open: boolean;
  onClose: () => void;
  probeOk: boolean;
  centerId: string | null;
  onQueueDrained?: () => void;
}

export default function PendingSyncSheet({ open, onClose, probeOk, centerId, onQueueDrained }: PendingSyncSheetProps) {
  const t = useTranslations('scanner.pendingSheet');
  const locale = useLocale();
  const [rows, setRows] = useState<
    { localId: number; studentNumber: string; timestamp: number; legacy: boolean }[]
  >([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [retryAllBusy, setRetryAllBusy] = useState(false);

  const load = async () => {
    const rawAll = await getPendingScanRows();
    const raw = centerId
      ? rawAll.filter((r) => String((r as { center_id?: string }).center_id ?? '') === centerId)
      : rawAll;
    const enriched = await Promise.all(
      raw.map(async (r: PendingScanRow) => {
        const sn =
          (typeof r.student_number === 'string' && r.student_number) ||
          (await lookupStudentNumberOffline(String(r.student_id))) ||
          String(r.student_id).slice(0, 8);
        const ts = typeof r.timestamp === 'number' ? r.timestamp : Date.now();
        const legacy = 'synced' in r && Object.prototype.hasOwnProperty.call(r, 'synced');
        return {
          localId: r.localId as number,
          studentNumber: sn,
          timestamp: ts,
          legacy,
        };
      }),
    );
    setRows(enriched);
  };

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open]);

  const refreshAll = async () => {
    await load();
    const n = await getUnsyncedCount();
    onQueueDrained?.();
    if (n === 0) onClose();
  };

  const retryOne = async (_localId: number, _legacy: boolean) => {
    if (!probeOk) return;
    setBusyId(-1);
    try {
      await syncQueuedScans();
      await refreshAll();
    } finally {
      setBusyId(null);
    }
  };

  const retryAll = async () => {
    if (!probeOk) return;
    setRetryAllBusy(true);
    try {
      await syncQueuedScans();
      await refreshAll();
    } finally {
      setRetryAllBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[55] flex items-end justify-center bg-black/50 sm:items-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="w-full max-w-md rounded-t-2xl sm:rounded-2xl bg-[var(--color-surface-1)] shadow-xl border border-[var(--color-border-subtle)] max-h-[80vh] flex flex-col">
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-12 h-1 rounded-full bg-slate-400/50" aria-hidden />
        </div>
        <div className="px-4 pb-2 border-b border-[var(--color-border-subtle)]">
          <h2 className="text-lg font-bold text-[var(--color-text-primary)]">{t('title')}</h2>
          <p className="text-xs text-[var(--color-text-secondary)]">{t('subtitle')}</p>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-[var(--color-border-subtle)]">
          {rows.length === 0 ? (
            /* §01 quiet variant: an empty sync queue is the good state, not a
               task. Nothing to do, so no action and the muted tile. */
            <EmptyState icon={CloudUpload} title={t('empty')} quiet />
          ) : (
            rows.map((r) => (
              <div key={`${r.localId}-${r.timestamp}`} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-sm text-[var(--color-text-primary)] truncate">{r.studentNumber}</p>
                  <p className="text-xs text-[var(--color-text-tertiary)]">{formatDate(new Date(r.timestamp), locale, 'time')}</p>
                  <span className="inline-flex mt-1 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-amber-900/30 text-amber-300 border border-amber-800/40">
                    {t('queued')}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={!probeOk || busyId !== null || retryAllBusy}
                  onClick={() => void retryOne(r.localId, r.legacy)}
                  className="shrink-0 rounded-lg bg-teal-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {busyId !== null ? t('retrying') : t('retry')}
                </button>
              </div>
            ))
          )}
        </div>
        <div className="border-t border-[var(--color-border-subtle)] p-4">
          <button
            type="button"
            disabled={!probeOk || rows.length === 0 || retryAllBusy}
            onClick={() => void retryAll()}
            className="w-full rounded-xl bg-teal-700 py-3 font-semibold text-white disabled:opacity-50"
          >
            {retryAllBusy ? t('retryingAll') : t('retryAll')}
          </button>
          <button type="button" onClick={onClose} className="mt-2 w-full py-2 text-sm text-[var(--color-text-secondary)]">
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  );
}
