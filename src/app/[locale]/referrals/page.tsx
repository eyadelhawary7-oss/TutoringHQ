'use client';

import { useState, useEffect, useMemo, type ReactNode } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useUser } from '@/contexts/UserContext';
import { supabase } from '@/lib/supabase';
import { Gift, Copy, Link2, Wallet, Users, MessageCircle, ChevronRight } from 'lucide-react';
import { PageHeader } from '@/components/shared';
import KpiCard from '@/components/shared/KpiCard';
import { ReferralWithdrawalPanel } from '@/components/referrals/ReferralWithdrawalPanel';
import { formatDate, formatNumber, formatPercent } from '@/lib/formatNumber';
import { COMMISSION_TIERS } from '@/lib/referralProgram';
import { centerStatusPresentation } from '@/lib/referralCommissionStatus';

// Tone per tier, matching Merged-Center-Insight §03's .s25/.s10/.s5 step chips
// (teal → gold → neutral, in that order). COMMISSION_TIERS is the single
// live source of truth for the ladder itself (D2: live wins, 10% runs
// months 2-12, not the design's months 2-6).
const TIER_TONE_CLASS = ['badge-success', 'badge-gold', 'badge-neutral'] as const;
const TIER_LABEL_KEY = ['tier1Label', 'tier2Label', 'tier3Label'] as const;

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

/**
 * One row of `referral_commissions` as served by GET /api/referral.
 * D22: field names follow the canonical table. `status` is
 * 'hold' | 'withdrawable' | 'paid' | 'forfeited'.
 */
type RewardHistoryItem = {
  id: string;
  referred_center_id: string;
  referred_center_name: string;
  months_since_activation: number;
  /** Fraction (0.25), not percent. */
  commission_rate: number;
  referred_plan_fee: number;
  commission_amount: number;
  status: string;
  hold_until?: string;
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
    instapayNumber: string;
    processingFee: number;
    totalEarned: number;
    available: number;
    pending: number;
    paidOut: number;
    /** Commission lost when a referred centre did not pay in full. */
    forfeited: number;
    totalReferrals: number;
    activeReferrals: ActiveReferral[];
    rewardHistory: RewardHistoryItem[];
    payoutRequests: Array<{ id: string; amount_requested: number; status: string; requested_at: string }>;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [codeCopied, setCodeCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

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
          instapayNumber: typeof json.instapayNumber === 'string' ? json.instapayNumber : '',
          processingFee: typeof json.processingFee === 'number' ? json.processingFee : 20,
          totalEarned: json.totalEarned ?? 0,
          available: json.available ?? 0,
          pending: json.pending ?? 0,
          paidOut: json.paidOut ?? 0,
          forfeited: json.forfeited ?? 0,
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

  const appUrl = typeof window !== 'undefined' ? window.location.origin : 'https://tutoringhq.app';
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

  if (user?.role !== 'owner' && user?.role !== 'super_admin') {
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
          <KpiCard
            label={t('totalReferrals')}
            value={fmt(data?.totalReferrals ?? 0)}
          />
          <KpiCard
            label={t('pending')}
            value={fmt(data?.pending ?? 0)}
            delta={tc('egp')}
            tone="warning"
          />
          <KpiCard
            label={t('withdrawable')}
            value={fmt(data?.available ?? 0)}
            delta={tc('egp')}
            tone="success"
          />
          <KpiCard
            label={t('totalEarned')}
            value={fmt(data?.totalEarned ?? 0)}
            delta={tc('egp')}
            tone="muted"
          />
        </div>

        <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] card-shadow p-6">
          <h2 className="font-bold text-[var(--color-text-primary)] mb-1">{t('commissionStructureTitle')}</h2>
          {/* The chips carry a bare percentage and a month range; the old
              tier1Value/tier2Value/tier3Value strings were the only place the
              screen said what the percentage was OF. Those three are retired
              (two of them just restated the number now rendered in the chip),
              and the basis is stated once, here, above the ladder. */}
          <p className="text-xs text-[var(--color-text-secondary)] mb-4 leading-snug">{t('commissionBasis')}</p>
          {/* Merged-Center-Insight §03's rate-decay step chips. The ladder itself
              comes from COMMISSION_TIERS (referralProgram.ts), the live rule per
              D2 — the design's own "months 2-6" is the corrected-away number. */}
          <div className="flex items-stretch gap-1.5">
            {COMMISSION_TIERS.map((tier, i) => (
              <div key={tier.fromMonth} className="flex items-stretch gap-1.5 flex-1">
                {i > 0 && (
                  <div className="flex items-center text-[var(--color-text-muted)] shrink-0">
                    <ChevronRight className="w-4 h-4 rtl:rotate-180" aria-hidden />
                  </div>
                )}
                <div className={`flex-1 rounded-xl text-center py-3 px-2 ${TIER_TONE_CLASS[i] ?? 'badge-neutral'}`}>
                  <div className="text-lg font-bold tabular-nums">{formatPercent(tier.ratePct, locale)}</div>
                  <div className="text-[11px] mt-1 opacity-85">{t(TIER_LABEL_KEY[i] ?? 'tier3Label')}</div>
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-[var(--color-text-amber)] mt-4 leading-snug">{t('tierCondition')}</p>
        </div>

        <ReferralWithdrawalPanel
          available={data?.available ?? 0}
          instapayNumber={data?.instapayNumber ?? ''}
          processingFee={data?.processingFee ?? 20}
          onSuccess={() => void fetchData()}
        />

        <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] card-shadow overflow-hidden">
          <div className="p-4 border-b border-[var(--color-border-subtle)]">
            <h2 className="font-bold text-[var(--color-text-primary)] flex items-center gap-2">
              <Users className="w-5 h-5 text-teal-600" />
              {t('activeReferrals')}
            </h2>
          </div>
          {(data?.activeReferrals?.length ?? 0) > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[var(--color-surface-2)]">
                    <th className="text-start py-3 px-4 font-semibold text-[var(--color-text-muted)]">{t('tableCenter')}</th>
                    <th className="text-start py-3 px-4 font-semibold text-[var(--color-text-muted)]">{t('tableStatus')}</th>
                    <th className="text-end py-3 px-4 font-semibold text-[var(--color-text-muted)]">{t('tableMonths')}</th>
                    <th className="text-end py-3 px-4 font-semibold text-[var(--color-text-muted)]">{t('tableMonthlyReward')}</th>
                    <th className="text-end py-3 px-4 font-semibold text-[var(--color-text-muted)]">{t('tableTotal')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.activeReferrals?.map((r) => (
                    <tr
                      key={r.id}
                      className="transition-colors duration-150 hover:bg-[var(--color-surface-2)]"
                    >
                      <td className="py-3 px-4 text-[var(--color-text-primary)] font-mono">{maskCenterName(r.center_name)}</td>
                      <td className="py-3 px-4">
                        <span
                          className={`badge ${
                            r.status === 'converted' || r.status === 'active'
                              ? 'badge-success'
                              : r.status === 'pending'
                                ? 'badge-gold'
                                : r.status === 'disputed'
                                  ? 'badge-danger'
                                  : 'badge-neutral'
                          }`}
                        >
                          {r.status === 'converted' || r.status === 'active'
                            ? t('statusActiveShort')
                            : r.status === 'pending'
                              ? t('statusPendingShort')
                              : r.status === 'disputed'
                                ? t('statusDisputedShort')
                                : r.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-end text-[var(--color-text-primary)] tabular-nums">{fmt(r.months)}</td>
                      <td className="py-3 px-4 text-end font-mono text-[var(--color-text-primary)] tabular-nums">
                        {fmt(r.monthly_reward)} {tc('egp')}
                      </td>
                      <td className="py-3 px-4 text-end font-mono text-teal-700 tabular-nums">
                        {fmt(r.total)} {tc('egp')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-8 text-center text-[var(--color-text-muted)] text-sm">{t('noReferrals')}</div>
          )}
        </div>

        <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] card-shadow overflow-hidden">
          <div className="p-4 border-b border-[var(--color-border-subtle)]">
            <h2 className="font-bold text-[var(--color-text-primary)] flex items-center gap-2">
              <Wallet className="w-5 h-5 text-teal-600" />
              {t('rewardHistory')}
            </h2>
          </div>
          {(data?.rewardHistory?.length ?? 0) > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[var(--color-surface-2)]">
                    <th className="text-start py-3 px-4 font-semibold text-[var(--color-text-muted)]">{t('rewardMonthCol')}</th>
                    <th className="text-start py-3 px-4 font-semibold text-[var(--color-text-muted)]">{t('rewardCenterCol')}</th>
                    <th className="text-end py-3 px-4 font-semibold text-[var(--color-text-muted)]">{t('rewardAmountCol')}</th>
                    <th className="text-start py-3 px-4 font-semibold text-[var(--color-text-muted)]">{t('rewardStatusCol')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.rewardHistory?.map((h) => {
                    const monthLabel = formatPeriodMonth(h.period_month, locale);
                    // D22 status vocabulary, from referral_commissions:
                    //   hold → not yet payable (the retired table split this
                    //          across 'pending' and 'held')
                    //   withdrawable → payable now (was 'available')
                    //   paid → already paid out
                    //   forfeited → lost because the referred centre did not pay
                    //          in full. Shown as "expired" and greyed, never
                    //          hidden: a centre must see what it lost.
                    const presentation = centerStatusPresentation(h.status);
                    const isForfeited = presentation.greyed;
                    // A 'hold' row shows the days remaining when its hold window
                    // is still open; otherwise the shared label is used verbatim.
                    // An unrecognised status yields an empty labelKey and is
                    // rendered as-is rather than guessed at.
                    let labelText: string;
                    if (h.status === 'hold') {
                      const holdDate = h.hold_until ? new Date(h.hold_until) : null;
                      const daysLeft = holdDate ? Math.max(0, Math.ceil((holdDate.getTime() - Date.now()) / 86400000)) : 0;
                      labelText = daysLeft > 0 ? t('rewardStatusHeld', { days: fmt(daysLeft) }) : t('rewardStatusHeldShort');
                    } else if (presentation.labelKey) {
                      labelText = t(presentation.labelKey as 'rewardStatusAvailable');
                    } else {
                      labelText = h.status;
                    }
                    const statusBadge: ReactNode = (
                      <span className={`badge badge-${presentation.tone}`}>{labelText}</span>
                    );
                    return (
                      <tr
                        key={h.id}
                        className={`transition-colors duration-150 hover:bg-[var(--color-surface-2)]${
                          isForfeited ? ' opacity-60' : ''
                        }`}
                      >
                        <td className={`py-3 px-4 ${isForfeited ? 'text-[var(--color-text-muted)]' : 'text-[var(--color-text-primary)]'}`}>{monthLabel}</td>
                        <td className={`py-3 px-4 font-mono ${isForfeited ? 'text-[var(--color-text-muted)]' : 'text-[var(--color-text-primary)]'}`}>{maskCenterName(h.referred_center_name)}</td>
                        <td className={`py-3 px-4 text-end font-mono tabular-nums ${isForfeited ? 'text-[var(--color-text-muted)]' : 'text-[var(--color-text-primary)]'}`}>
                          {fmt(h.commission_amount)} {tc('egp')}
                        </td>
                        <td className="py-3 px-4">{statusBadge}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-8 text-center text-[var(--color-text-muted)] text-sm">{t('noCommissions')}</div>
          )}
        </div>

        <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] card-shadow p-6 md:p-8">
          <h2 className="font-bold text-[var(--color-text-primary)] mb-2 flex items-center gap-2">
            <Gift className="w-5 h-5 text-teal-600" />
            {t('yourCode')}
          </h2>
          <p className="font-mono text-3xl md:text-4xl font-bold text-teal-600 tracking-wider mb-6 break-all">
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
              className="btn-lift inline-flex items-center justify-center gap-2 px-4 py-3 border border-[var(--color-border-subtle)] rounded-xl text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-surface-2)]"
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
              className="btn-lift inline-flex items-center justify-center gap-2 px-4 py-3 border border-[var(--color-border-subtle)] rounded-xl text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-surface-2)]"
            >
              <Copy className="w-4 h-4" />
              {codeCopied ? t('copyDoneCheck') : t('copyCode')}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] card-shadow p-6">
          <h2 className="font-bold text-[var(--color-text-primary)] mb-4">{t('howItWorks')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {howSteps.map((step) => (
              <div
                key={step.n}
                className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4 flex flex-col gap-2"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-600 text-white text-sm font-bold shrink-0">
                  {formatNumber(step.n, locale)}
                </div>
                <p className="font-semibold text-[var(--color-text-primary)]">{step.title}</p>
                <p className="text-sm text-[var(--color-text-muted)] leading-snug">{step.desc}</p>
              </div>
            ))}
          </div>
          <p className="text-[var(--color-text-amber)] text-xs mt-4">{t('commissionCondition')}</p>
        </div>
      </div>
    </div>
  );
}
