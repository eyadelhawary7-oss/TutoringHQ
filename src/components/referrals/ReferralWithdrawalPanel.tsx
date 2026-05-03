'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Banknote } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/formatNumber';

function normalizeInstapayDigits(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length !== 11 || !digits.startsWith('01')) return null;
  return digits;
}

export interface ReferralWithdrawalPanelProps {
  available: number;
  instapayNumber: string;
  onSuccess: () => void | Promise<void>;
}

/**
 * Referral commission withdrawal CTA + modal (shared by /referrals and /settings/referrals).
 */
export function ReferralWithdrawalPanel({ available, instapayNumber, onSuccess }: ReferralWithdrawalPanelProps) {
  const t = useTranslations('referrals');
  const tc = useTranslations('common');
  const locale = useLocale();

  const [withdrawalOpen, setWithdrawalOpen] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState('');
  const [instapayDraft, setInstapayDraft] = useState('');
  const [payoutSubmitting, setPayoutSubmitting] = useState(false);
  const [payoutError, setPayoutError] = useState<string | null>(null);

  const openWithdrawalModal = () => {
    setPayoutError(null);
    setInstapayDraft((instapayNumber ?? '').replace(/\D/g, ''));
    setPayoutAmount(available > 0 ? String(available) : '');
    setWithdrawalOpen(true);
  };

  const handlePayoutRequest = async () => {
    const amount = parseFloat(payoutAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setPayoutError(t('payoutInvalidAmount'));
      return;
    }
    if (amount > available) {
      setPayoutError(
        t('payoutExceedsBalance', {
          max: formatCurrency(available, locale),
        }),
      );
      return;
    }
    const instapay = normalizeInstapayDigits(instapayDraft);
    if (!instapay) {
      setPayoutError(t('instapayInvalid'));
      return;
    }
    setPayoutError(null);
    setPayoutSubmitting(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error('Unauthorized');
      const res = await fetch('/api/referrals/payout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          amount_requested: amount,
          payment_method: 'instapay',
          payment_details: { instapay_number: instapay },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Request failed');
      setPayoutAmount('');
      setInstapayDraft('');
      setWithdrawalOpen(false);
      await onSuccess();
    } catch (err) {
      setPayoutError(err instanceof Error ? err.message : t('payoutGenericError'));
    } finally {
      setPayoutSubmitting(false);
    }
  };

  return (
    <>
      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-[var(--color-surface-1)] card-shadow p-6">
        <h2 className="font-bold text-slate-900 dark:text-white mb-2 flex items-center gap-2">
          <Banknote className="w-5 h-5 text-teal-600 dark:text-teal-400" />
          {t('requestWithdrawal')}
        </h2>
        <p className="text-slate-700 dark:text-slate-200 mb-4 text-sm">
          {t('availableBalanceIntro')}{' '}
          <span dir="ltr" className="tabular-nums inline-block font-mono">
            {formatCurrency(available, locale)}
          </span>
        </p>
        <button
          type="button"
          onClick={openWithdrawalModal}
          disabled={available <= 0}
          title={available <= 0 ? t('noWithdrawalBalance') : undefined}
          className="btn-lift px-4 py-2.5 bg-teal-600 text-white rounded-xl text-sm font-semibold hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {t('requestWithdrawal')}
        </button>
        <p className="text-xs text-amber-700 dark:text-amber-400 mt-3 leading-snug">{t('withdrawalFeeNote')}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">{t('processingTime')}</p>
      </div>

      {withdrawalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="presentation"
          onClick={() => {
            if (!payoutSubmitting) setWithdrawalOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="referral-withdrawal-title"
            className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-600 bg-[var(--color-surface-1)] p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="referral-withdrawal-title" className="font-bold text-slate-900 dark:text-white mb-4">
              {t('withdrawalModalTitle')}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1" htmlFor="ref-withdraw-instapay">
                  {t('instapayNumber')}
                </label>
                <input
                  id="ref-withdraw-instapay"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={instapayDraft}
                  onChange={(e) => setInstapayDraft(e.target.value)}
                  placeholder="01XXXXXXXXX"
                  className="w-full px-3 py-2.5 border border-slate-200 dark:border-slate-600 rounded-xl text-sm font-mono bg-[var(--color-surface-2)] text-slate-900 dark:text-white"
                  dir="ltr"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1" htmlFor="ref-withdraw-amount">
                  {t('payoutAmountLabel')}
                </label>
                <input
                  id="ref-withdraw-amount"
                  type="number"
                  min={0}
                  step={0.01}
                  value={payoutAmount}
                  onChange={(e) => setPayoutAmount(e.target.value)}
                  className="w-full px-3 py-2.5 border border-slate-200 dark:border-slate-600 rounded-xl text-sm font-mono bg-[var(--color-surface-2)] text-slate-900 dark:text-white"
                  dir="ltr"
                />
              </div>
              <p className="text-xs text-amber-700 dark:text-amber-400 leading-snug">{t('withdrawalFeeNote')}</p>
              {payoutError ? <p className="text-sm text-red-600 dark:text-red-400">{payoutError}</p> : null}
              <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end pt-2">
                <button
                  type="button"
                  disabled={payoutSubmitting}
                  onClick={() => !payoutSubmitting && setWithdrawalOpen(false)}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-sm font-semibold text-[var(--color-text-primary)] hover:bg-slate-700/30 disabled:opacity-50"
                >
                  {tc('cancel')}
                </button>
                <button
                  type="button"
                  disabled={payoutSubmitting}
                  onClick={() => void handlePayoutRequest()}
                  className="px-4 py-2.5 rounded-xl bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 disabled:opacity-50"
                >
                  {payoutSubmitting ? t('payoutSubmitting') : t('submitWithdrawal')}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
