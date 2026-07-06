'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Banknote } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/formatNumber';
import { computeReferralPayout, REFERRAL_WITHDRAWAL_MIN_EGP } from '@/lib/referralPayout';
import { PROCESSING_FEE_DEFAULT_AMOUNT } from '@/lib/processingFee';

function normalizeInstapayDigits(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length !== 11 || !digits.startsWith('01')) return null;
  return digits;
}

export interface ReferralWithdrawalPanelProps {
  available: number;
  instapayNumber: string;
  /** Flat processing fee (from platform_config); defaults to 20. */
  processingFee?: number;
  onSuccess: () => void | Promise<void>;
}

/**
 * Referral commission withdrawal CTA + modal (shared by /referrals and /settings/referrals).
 */
export function ReferralWithdrawalPanel({
  available,
  instapayNumber,
  processingFee = PROCESSING_FEE_DEFAULT_AMOUNT,
  onSuccess,
}: ReferralWithdrawalPanelProps) {
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
    if (amount < REFERRAL_WITHDRAWAL_MIN_EGP) {
      setPayoutError(
        t('withdrawalBelowMinimum', { min: formatCurrency(REFERRAL_WITHDRAWAL_MIN_EGP, locale) }),
      );
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
      <div className="rounded-2xl border border-slate-200 bg-[var(--color-surface-1)] card-shadow p-6">
        <h2 className="font-bold text-slate-900 mb-2 flex items-center gap-2">
          <Banknote className="w-5 h-5 text-teal-600" />
          {t('requestWithdrawal')}
        </h2>
        <p className="text-slate-700 mb-4 text-sm">
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
        <p className="text-xs text-amber-700 mt-3 leading-snug">{t('withdrawalFeeNote')} {t('withdrawalMinimumNote', { min: formatCurrency(REFERRAL_WITHDRAWAL_MIN_EGP, locale) })}</p>
        <p className="text-xs text-slate-500 mt-2">{t('processingTime')}</p>
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
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-[var(--color-surface-1)] p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="referral-withdrawal-title" className="font-bold text-slate-900 mb-4">
              {t('withdrawalModalTitle')}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1" htmlFor="ref-withdraw-instapay">
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
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm font-mono bg-[var(--color-surface-2)] text-slate-900"
                  dir="ltr"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1" htmlFor="ref-withdraw-amount">
                  {t('payoutAmountLabel')}
                </label>
                <input
                  id="ref-withdraw-amount"
                  type="number"
                  min={0}
                  step={0.01}
                  value={payoutAmount}
                  onChange={(e) => setPayoutAmount(e.target.value)}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm font-mono bg-[var(--color-surface-2)] text-slate-900"
                  dir="ltr"
                />
              </div>
              {(() => {
                const gross = parseFloat(payoutAmount);
                if (!Number.isFinite(gross) || gross <= 0) return null;
                const b = computeReferralPayout(gross, processingFee);
                if (b.net <= 0) {
                  return (
                    <p className="text-xs text-red-600 leading-snug">
                      {t('withdrawalBelowFee', { fee: formatCurrency(processingFee, locale) })}
                    </p>
                  );
                }
                return (
                  <div className="rounded-xl bg-[var(--color-surface-2)] p-3 space-y-1 text-xs">
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-600">{t('payoutGross')}</span>
                      <span className="tabular-nums">{formatCurrency(b.gross, locale)}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-600">{t('payoutProcessingFee')}</span>
                      <span className="tabular-nums text-red-600">-{formatCurrency(b.processingFee, locale)}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-600">{t('payoutWithdrawalFee')}</span>
                      <span className="tabular-nums text-red-600">-{formatCurrency(b.withdrawalFee, locale)}</span>
                    </div>
                    <div className="flex justify-between gap-2 pt-1 border-t border-[var(--color-border-subtle)] font-semibold">
                      <span>{t('payoutNet')}</span>
                      <span className="tabular-nums text-teal-700">{formatCurrency(b.net, locale)}</span>
                    </div>
                  </div>
                );
              })()}
              <p className="text-xs text-amber-700 leading-snug">{t('withdrawalFeeNote')} {t('withdrawalMinimumNote', { min: formatCurrency(REFERRAL_WITHDRAWAL_MIN_EGP, locale) })}</p>
              {payoutError ? <p className="text-sm text-red-600">{payoutError}</p> : null}
              <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end pt-2">
                <button
                  type="button"
                  disabled={payoutSubmitting}
                  onClick={() => !payoutSubmitting && setWithdrawalOpen(false)}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-[var(--color-text-primary)] hover:bg-slate-700/30 disabled:opacity-50"
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
