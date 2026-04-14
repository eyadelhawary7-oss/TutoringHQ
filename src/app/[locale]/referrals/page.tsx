'use client';

import { useState, useEffect, useMemo } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useUser } from '@/contexts/UserContext';
import { supabase } from '@/lib/supabase';
import { Gift, Copy, Link2, Wallet, Users, Banknote, MessageCircle } from 'lucide-react';
import { PageHeader } from '@/components/shared';
import { formatDate, formatNumber } from '@/lib/formatNumber';

function maskCenterName(name: string): string {
  if (!name || name.length < 2) return '***';
  return name.slice(0, 2) + '***';
}

function formatPeriodMonth(periodMonth: string, loc: string): string {
  const [y, m] = (periodMonth || '').split('-');
  if (!y || !m) return '-';
  const d = new Date(Number(y), Number(m) - 1, 1);
  return formatDate(d, loc, { month: 'short', year: 'numeric' });
}

type ActiveReferral = {
  id: string;
  center_name: string;
  status: string;
  months: number;
  monthly_reward: number;
  total: number;
};

type RewardHistoryItem = {
  id: string;
  referred_center_id: string;
  referred_center_name: string;
  month_number: number;
  reward_percentage: number;
  base_amount: number;
  reward_amount: number;
  status: string;
  held_until?: string;
  paid_at?: string;
  period_month: string;
};

export default function ReferralsPage() {
  const t = useTranslations('referrals');
  const tc = useTranslations('common');
  const locale = useLocale();
  const fmt = (n: number) => formatNumber(n, locale);
  const { user } = useUser();
  const [data, setData] = useState<{
    referralCode: string;
    totalEarned: number;
    available: number;
    pending: number;
    paidOut: number;
    totalReferrals: number;
    activeReferrals: ActiveReferral[];
    rewardHistory: RewardHistoryItem[];
    payoutRequests: Array<{ id: string; amount_requested: number; status: string; requested_at: string }>;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [codeCopied, setCodeCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState('');
  const [payoutSubmitting, setPayoutSubmitting] = useState(false);
  const [payoutError, setPayoutError] = useState<string | null>(null);

  const fetchData = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return;
    try {
      const res = await fetch('/api/referral', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        const json = await res.json();
        setData({
          referralCode: json.referralCode ?? '',
          totalEarned: json.totalEarned ?? 0,
          available: json.available ?? 0,
          pending: json.pending ?? 0,
          paidOut: json.paidOut ?? 0,
          totalReferrals: json.totalReferrals ?? 0,
          activeReferrals: json.activeReferrals ?? [],
          rewardHistory: json.rewardHistory ?? [],
          payoutRequests: json.payoutRequests ?? [],
        });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handlePayoutRequest = async () => {
    const amount = parseFloat(payoutAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setPayoutError(t('payoutInvalidAmount'));
      return;
    }
    if (amount > (data?.available ?? 0)) {
      setPayoutError(
        t('payoutExceedsBalance', {
          max: fmt(data?.available ?? 0),
          egp: tc('egp'),
        })
      );
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
          payment_method: 'bank_transfer',
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Request failed');
      setPayoutAmount('');
      await fetchData();
    } catch (err) {
      setPayoutError(err instanceof Error ? err.message : t('payoutGenericError'));
    } finally {
      setPayoutSubmitting(false);
    }
  };

  const appUrl = typeof window !== 'undefined' ? window.location.origin : 'https://centerhq.app';
  const localePrefix = locale === 'ar' ? '' : `/${locale}`;
  const referLink = `${appUrl}${localePrefix}/refer/${data?.referralCode ?? ''}`;
  const whatsappShare = useMemo(() => {
    const text = t('whatsappShareText', { link: referLink });
    return `https://wa.me/?text=${encodeURIComponent(text)}`;
  }, [t, referLink]);

  const howSteps = useMemo(
    () =>
      [
        { n: 1, title: t('step1Title'), desc: t('step1Desc') },
        { n: 2, title: t('step2Title'), desc: t('step2Desc') },
        { n: 3, title: t('step3Title'), desc: t('step3Desc') },
      ] as const,
    [t]
  );

  if (user?.role !== 'owner') {
    return (
      <div className="min-h-screen w-full bg-[var(--color-surface-0)] p-4">
        <PageHeader title={t('title')} />
        <p className="text-[var(--color-text-secondary)]">{t('ownerOnly')}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen w-full bg-[var(--color-surface-0)] p-4 flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-teal-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-[var(--color-surface-0)] p-4 md:p-6">
      <PageHeader title={t('title')} />

      <div className="max-w-2xl mx-auto space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-[var(--color-surface-1)] p-4 card-shadow btn-lift">
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mb-1">{t('totalReferrals')}</p>
            <p className="text-xl font-bold text-slate-900 dark:text-white font-mono tabular-nums">{fmt(data?.totalReferrals ?? 0)}</p>
          </div>
          <div className="rounded-xl border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-950/30 p-4 card-shadow btn-lift">
            <p className="text-xs text-amber-800 dark:text-amber-200 font-medium mb-1">{t('pending')}</p>
            <p className="text-xl font-bold text-amber-900 dark:text-amber-100 font-mono tabular-nums">{fmt(data?.pending ?? 0)}</p>
            <p className="text-xs text-amber-700 dark:text-amber-300">{tc('egp')}</p>
          </div>
          <div className="rounded-xl border border-teal-200 dark:border-teal-800/50 bg-teal-50 dark:bg-teal-950/30 p-4 card-shadow btn-lift">
            <p className="text-xs text-teal-800 dark:text-teal-200 font-medium mb-1">{t('withdrawable')}</p>
            <p className="text-xl font-bold text-teal-900 dark:text-teal-100 font-mono tabular-nums">{fmt(data?.available ?? 0)}</p>
            <p className="text-xs text-teal-700 dark:text-teal-300">{tc('egp')}</p>
          </div>
          <div className="rounded-xl border border-emerald-200 dark:border-emerald-800/50 bg-emerald-50 dark:bg-emerald-950/30 p-4 card-shadow btn-lift">
            <p className="text-xs text-emerald-800 dark:text-emerald-200 font-medium mb-1">{t('totalEarned')}</p>
            <p className="text-xl font-bold text-emerald-900 dark:text-emerald-100 font-mono tabular-nums">{fmt(data?.totalEarned ?? 0)}</p>
            <p className="text-xs text-emerald-700 dark:text-emerald-300">{tc('egp')}</p>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-[var(--color-surface-1)] card-shadow overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-slate-700">
            <h2 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Users className="w-5 h-5 text-teal-600 dark:text-teal-400" />
              {t('activeReferrals')}
            </h2>
          </div>
          {(data?.activeReferrals?.length ?? 0) > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[var(--color-surface-2)]">
                    <th className="text-start py-3 px-4 font-semibold text-slate-600 dark:text-slate-300">{t('tableCenter')}</th>
                    <th className="text-start py-3 px-4 font-semibold text-slate-600 dark:text-slate-300">{t('tableStatus')}</th>
                    <th className="text-end py-3 px-4 font-semibold text-slate-600 dark:text-slate-300">{t('tableMonths')}</th>
                    <th className="text-end py-3 px-4 font-semibold text-slate-600 dark:text-slate-300">{t('tableMonthlyReward')}</th>
                    <th className="text-end py-3 px-4 font-semibold text-slate-600 dark:text-slate-300">{t('tableTotal')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.activeReferrals?.map((r) => (
                    <tr
                      key={r.id}
                      className="transition-colors duration-150 hover:bg-slate-700/40"
                    >
                      <td className="py-3 px-4 text-slate-900 dark:text-white font-mono">{maskCenterName(r.center_name)}</td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            r.status === 'converted' || r.status === 'active'
                              ? 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300'
                              : r.status === 'pending'
                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                                : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                          }`}
                        >
                          {r.status === 'converted' || r.status === 'active'
                            ? t('statusActiveShort')
                            : r.status === 'pending'
                              ? t('statusPendingShort')
                              : r.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-end text-slate-900 dark:text-white tabular-nums">{fmt(r.months)}</td>
                      <td className="py-3 px-4 text-end font-mono text-slate-900 dark:text-white tabular-nums">
                        {fmt(r.monthly_reward)} {tc('egp')}
                      </td>
                      <td className="py-3 px-4 text-end font-mono text-teal-700 dark:text-teal-300 tabular-nums">
                        {fmt(r.total)} {tc('egp')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-8 text-center text-slate-500 dark:text-slate-400 text-sm">{t('noReferrals')}</div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-[var(--color-surface-1)] card-shadow overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-slate-700">
            <h2 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Wallet className="w-5 h-5 text-teal-600 dark:text-teal-400" />
              {t('rewardHistory')}
            </h2>
          </div>
          {(data?.rewardHistory?.length ?? 0) > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[var(--color-surface-2)]">
                    <th className="text-start py-3 px-4 font-semibold text-slate-600 dark:text-slate-300">{t('rewardMonthCol')}</th>
                    <th className="text-start py-3 px-4 font-semibold text-slate-600 dark:text-slate-300">{t('rewardCenterCol')}</th>
                    <th className="text-end py-3 px-4 font-semibold text-slate-600 dark:text-slate-300">{t('rewardAmountCol')}</th>
                    <th className="text-start py-3 px-4 font-semibold text-slate-600 dark:text-slate-300">{t('rewardStatusCol')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.rewardHistory?.map((h) => {
                    const monthLabel = formatPeriodMonth(h.period_month, locale);
                    let statusBadge: React.ReactNode;
                    if (h.status === 'held') {
                      const holdDate = h.held_until ? new Date(h.held_until) : null;
                      const daysLeft = holdDate ? Math.max(0, Math.ceil((holdDate.getTime() - Date.now()) / 86400000)) : 0;
                      statusBadge = (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                          {daysLeft > 0 ? t('rewardStatusHeld', { days: fmt(daysLeft) }) : t('rewardStatusHeldShort')}
                        </span>
                      );
                    } else if (h.status === 'available') {
                      statusBadge = (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                          {t('rewardStatusAvailable')}
                        </span>
                      );
                    } else if (h.status === 'paid') {
                      statusBadge = (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200">
                          {t('rewardStatusPaid')}
                        </span>
                      );
                    } else {
                      statusBadge = (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                          {h.status}
                        </span>
                      );
                    }
                    return (
                      <tr
                        key={h.id}
                        className="transition-colors duration-150 hover:bg-slate-700/40"
                      >
                        <td className="py-3 px-4 text-slate-900 dark:text-white">{monthLabel}</td>
                        <td className="py-3 px-4 text-slate-900 dark:text-white font-mono">{maskCenterName(h.referred_center_name)}</td>
                        <td className="py-3 px-4 text-end font-mono text-slate-900 dark:text-white tabular-nums">
                          {fmt(h.reward_amount)} {tc('egp')}
                        </td>
                        <td className="py-3 px-4">{statusBadge}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-8 text-center text-slate-500 dark:text-slate-400 text-sm">{t('noCommissions')}</div>
          )}
        </div>

        {(data?.available ?? 0) > 0 && (
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-[var(--color-surface-1)] card-shadow p-6">
            <h2 className="font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
              <Banknote className="w-5 h-5 text-teal-600 dark:text-teal-400" />
              {t('requestWithdrawal')}
            </h2>
            <p className="text-slate-700 dark:text-slate-200 mb-3 text-sm">
              {t('availableBalanceLine', {
                amount: fmt(data?.available ?? 0),
                egp: tc('egp'),
              })}
            </p>
            <div className="flex flex-wrap gap-2 items-end">
              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">{t('payoutAmountLabel')}</label>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={payoutAmount}
                  onChange={(e) => setPayoutAmount(e.target.value)}
                  placeholder={fmt(data?.available ?? 0)}
                  className="w-36 px-3 py-2.5 border border-slate-200 dark:border-slate-600 rounded-xl text-sm font-mono bg-[var(--color-surface-2)] text-slate-900 dark:text-white"
                  dir="ltr"
                />
              </div>
              <button
                type="button"
                onClick={() => void handlePayoutRequest()}
                disabled={payoutSubmitting}
                className="btn-lift px-4 py-2.5 bg-teal-600 text-white rounded-xl text-sm font-semibold hover:bg-teal-700 disabled:opacity-50"
              >
                {payoutSubmitting ? t('payoutSubmitting') : t('requestWithdrawal')}
              </button>
            </div>
            {payoutError && <p className="text-red-600 dark:text-red-400 text-sm mt-2">{payoutError}</p>}
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-3">{t('processingTime')}</p>
          </div>
        )}

        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-[var(--color-surface-1)] card-shadow p-6 md:p-8">
          <h2 className="font-bold text-slate-900 dark:text-white mb-2 flex items-center gap-2">
            <Gift className="w-5 h-5 text-teal-600 dark:text-teal-400" />
            {t('yourCode')}
          </h2>
          <p className="font-mono text-3xl md:text-4xl font-bold text-teal-600 dark:text-teal-400 tracking-wider mb-6 break-all">
            {data?.referralCode || '-'}
          </p>
          <div className="flex flex-col sm:flex-row flex-wrap gap-2">
            <a
              href={whatsappShare}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-lift inline-flex items-center justify-center gap-2 px-4 py-3 bg-teal-600 text-white rounded-xl text-sm font-semibold hover:bg-teal-700"
            >
              <MessageCircle className="w-4 h-4" />
              {t('shareWhatsApp')}
            </a>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(referLink);
                setLinkCopied(true);
                setTimeout(() => setLinkCopied(false), 2000);
              }}
              className="btn-lift inline-flex items-center justify-center gap-2 px-4 py-3 border border-slate-200 dark:border-slate-600 rounded-xl text-sm font-semibold text-[var(--color-text-primary)] hover:bg-slate-700/50"
            >
              <Link2 className="w-4 h-4" />
              {linkCopied ? t('copyDoneCheck') : t('shareLink')}
            </button>
            <button
              type="button"
              onClick={async () => {
                if (data?.referralCode) {
                  await navigator.clipboard.writeText(data.referralCode);
                  setCodeCopied(true);
                  setTimeout(() => setCodeCopied(false), 2000);
                }
              }}
              className="btn-lift inline-flex items-center justify-center gap-2 px-4 py-3 border border-slate-200 dark:border-slate-600 rounded-xl text-sm font-semibold text-[var(--color-text-primary)] hover:bg-slate-700/50"
            >
              <Copy className="w-4 h-4" />
              {codeCopied ? t('copyDoneCheck') : t('copyCode')}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-[var(--color-surface-1)] card-shadow p-6">
          <h2 className="font-bold text-slate-900 dark:text-white mb-4">{t('howItWorks')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {howSteps.map((step) => (
              <div
                key={step.n}
                className="rounded-xl border border-slate-700 bg-[var(--color-surface-2)] p-4 flex flex-col gap-2"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-600 text-white text-sm font-bold shrink-0">
                  {formatNumber(step.n, locale)}
                </div>
                <p className="font-semibold text-slate-900 dark:text-white">{step.title}</p>
                <p className="text-sm text-slate-600 dark:text-slate-400 leading-snug">{step.desc}</p>
              </div>
            ))}
          </div>
          <p className="text-amber-700 dark:text-amber-400 text-xs mt-4">{t('commissionCondition')}</p>
        </div>
      </div>
    </div>
  );
}
