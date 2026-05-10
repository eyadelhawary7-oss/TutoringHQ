'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useToast } from '@/hooks/useToast';

export function SubscriptionOverridesPanel({
  centerId,
  getAuthHeaders,
}: {
  centerId: string;
  getAuthHeaders: () => Promise<Record<string, string> | null>;
}) {
  const t = useTranslations('admin.centerManagement.subscription');
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [daysCustom, setDaysCustom] = useState('30');
  const [allInPrice, setAllInPrice] = useState('');
  const [earlyAdopter, setEarlyAdopter] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const post = useCallback(
    async (path: string, body: Record<string, unknown>) => {
      const headers = await getAuthHeaders();
      if (!headers) {
        toast.error('Unauthorized');
        return;
      }
      const res = await fetch(path, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(typeof j.error === 'string' ? j.error : 'Request failed');
        return false;
      }
      return true;
    },
    [getAuthHeaders, toast],
  );

  const runExtend = async (days: number) => {
    const r = reason.trim();
    if (r.length < 10 || r.length > 500) {
      toast.error(t('reasonLabel'));
      return;
    }
    setBusy('extend');
    try {
      const ok = await post(`/api/admin/centers/${centerId}/subscription/extend`, {
        days,
        reason: r,
      });
      if (ok) toast.success(t('successExtend'));
    } finally {
      setBusy(null);
    }
  };

  const runSuspend = async () => {
    const r = reason.trim();
    if (r.length < 10 || r.length > 500) {
      toast.error(t('reasonLabel'));
      return;
    }
    setBusy('suspend');
    try {
      const ok = await post(`/api/admin/centers/${centerId}/subscription/suspend`, { reason: r });
      if (ok) toast.success(t('successSuspend'));
    } finally {
      setBusy(null);
    }
  };

  const runReactivate = async () => {
    const r = reason.trim();
    if (r.length < 10 || r.length > 500) {
      toast.error(t('reasonLabel'));
      return;
    }
    setBusy('reactivate');
    try {
      const ok = await post(`/api/admin/centers/${centerId}/subscription/reactivate`, { reason: r });
      if (ok) toast.success(t('successReactivate'));
    } finally {
      setBusy(null);
    }
  };

  const runOverridePrice = async () => {
    const r = reason.trim();
    const n = Number(allInPrice);
    if (r.length < 10 || r.length > 500) {
      toast.error(t('reasonLabel'));
      return;
    }
    if (!Number.isFinite(n) || n < 0) {
      toast.error(t('allInLabel'));
      return;
    }
    setBusy('price');
    try {
      const ok = await post(`/api/admin/centers/${centerId}/subscription/override-price`, {
        reason: r,
        all_in_price: n,
        is_early_adopter: earlyAdopter,
      });
      if (ok) toast.success(t('successPrice'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl p-4 md:p-5 mb-4">
      <h2 className="text-base font-semibold text-slate-900 dark:text-white mb-4 tracking-wide">
        {t('panelTitle')}
      </h2>
      <label className="block text-sm text-slate-600 dark:text-slate-300 mb-1">{t('reasonLabel')}</label>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={3}
        className="w-full rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-700 dark:text-white mb-4"
        placeholder={t('reasonPlaceholder')}
      />
      <div className="flex flex-wrap gap-2 mb-4">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void runExtend(30)}
          className="rounded-lg bg-teal-600 text-white px-4 py-2 text-sm font-semibold hover:bg-teal-500 disabled:opacity-50"
        >
          {t('extend30')}
        </button>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={730}
            value={daysCustom}
            onChange={(e) => setDaysCustom(e.target.value)}
            className="w-24 rounded-lg border border-gray-300 bg-gray-100 px-2 py-1 text-sm dark:bg-slate-700 dark:border-slate-600 dark:text-white"
            aria-label={t('daysLabel')}
          />
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void runExtend(Math.round(Number(daysCustom)) || 1)}
            className="rounded-lg border border-teal-600 text-teal-700 dark:text-teal-300 px-4 py-2 text-sm font-semibold hover:bg-teal-50 dark:hover:bg-teal-950/40 disabled:opacity-50"
          >
            {t('extendCustom')}
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 mb-6">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void runSuspend()}
          className="rounded-lg bg-red-600 text-white px-4 py-2 text-sm font-semibold hover:bg-red-500 disabled:opacity-50"
        >
          {t('suspend')}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void runReactivate()}
          className="rounded-lg bg-slate-700 text-white px-4 py-2 text-sm font-semibold hover:bg-slate-600 disabled:opacity-50"
        >
          {t('reactivate')}
        </button>
      </div>
      <div className="border-t border-[var(--color-border)] pt-4 mt-2">
        <p className="text-xs text-slate-500 mb-2">{t('superAdminOnly')}</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
          <div>
            <label className="block text-sm text-slate-600 dark:text-slate-300 mb-1">{t('allInLabel')}</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={allInPrice}
              onChange={(e) => setAllInPrice(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-sm dark:bg-slate-700 dark:border-slate-600 dark:text-white"
              dir="ltr"
            />
          </div>
          <label className="flex items-center gap-2 mt-6 md:mt-8 cursor-pointer text-sm text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              checked={earlyAdopter}
              onChange={(e) => setEarlyAdopter(e.target.checked)}
              className="rounded border-gray-400"
            />
            {t('earlyAdopterToggle')}
          </label>
        </div>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void runOverridePrice()}
          className="rounded-lg bg-amber-600 text-white px-4 py-2 text-sm font-semibold hover:bg-amber-500 disabled:opacity-50"
        >
          {t('overridePrice')}
        </button>
      </div>
    </section>
  );
}
