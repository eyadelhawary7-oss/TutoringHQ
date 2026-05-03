'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { useLocale } from 'next-intl';
import { useUser } from '@/contexts/UserContext';
import { supabase } from '@/lib/supabase';
import { ArrowLeft, Download, Gift, Link2 } from 'lucide-react';
import { PageHeader } from '@/components/shared';
import { ReferralWithdrawalPanel } from '@/components/referrals/ReferralWithdrawalPanel';
import { formatCurrency, formatDate, formatNumber } from '@/lib/formatNumber';

const PLAN_LABELS_AR: Record<string, string> = {
  nano: 'سنتر نانو',
  starter: 'سنتر صغير',
  pro: 'سنتر متوسط',
  business: 'سنتر كبير',
  enterprise: 'سنتر ضخم',
  top_centers: 'ميجا سنتر',
};

function planToLabel(plan: string | undefined, locale: string): string {
  if (!plan) return '-';
  return locale === 'ar' ? (PLAN_LABELS_AR[plan] ?? plan) : plan;
}

interface ReferralRow {
  id: string;
  referred_center_id: string;
  referral_code: string;
  status: string;
  created_at: string;
  total_earned_egp?: number;
  referred_center?: {
    id: string;
    name: string;
    plan: string;
    status?: string;
  } | null;
}

interface PayoutRequestRow {
  id: string;
  amount_requested: number;
  status: string;
  payment_method?: string | null;
  requested_at: string;
  processed_at?: string | null;
}

export default function SettingsReferralsPage() {
  const t = useTranslations('referral');
  const tRef = useTranslations('referrals');
  const tc = useTranslations('common');
  const router = useRouter();
  const locale = useLocale();
  const { user } = useUser();
  const [referrals, setReferrals] = useState<ReferralRow[]>([]);
  const [referralCode, setReferralCode] = useState('');
  const [totalEarned, setTotalEarned] = useState(0);
  const [availableBalance, setAvailableBalance] = useState(0);
  const [referralInstapay, setReferralInstapay] = useState('');
  const [payoutRequests, setPayoutRequests] = useState<PayoutRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [linkCopied, setLinkCopied] = useState(false);

  const centerId = user?.center_id;

  const appUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const localePrefix = locale === 'ar' ? '' : `/${locale}`;
  const referLink = useMemo(
    () => (appUrl ? `${appUrl}${localePrefix}/refer/${referralCode || ''}` : ''),
    [appUrl, localePrefix, referralCode],
  );

  const referralPct = useMemo(
    () => ({
      p25: formatNumber(25, locale),
      p10: formatNumber(10, locale),
      p5: formatNumber(5, locale),
    }),
    [locale],
  );

  const loadReferralSummary = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session || !centerId) return;
    try {
      const res = await fetch('/api/referral', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        const json = await res.json();
        setReferralCode(json.referralCode ?? '');
        setTotalEarned(json.totalEarned ?? 0);
        setAvailableBalance(json.available ?? 0);
        setReferralInstapay(typeof json.instapayNumber === 'string' ? json.instapayNumber : '');
        const pr = json.payoutRequests;
        if (Array.isArray(pr)) {
          setPayoutRequests(pr as PayoutRequestRow[]);
        }
      }
    } catch {
      // ignore
    }
  }, [centerId]);

  useEffect(() => {
    const fetchData = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || !centerId) {
        setLoading(false);
        return;
      }
      await loadReferralSummary();

      try {
        const { data: refs, error } = await supabase
          .from('referrals')
          .select(`
            id,
            referred_center_id,
            referral_code,
            status,
            created_at,
            total_earned_egp,
            referred_center:centers!referred_center_id(id, name, plan, status)
          `)
          .eq('referrer_center_id', centerId)
          .order('created_at', { ascending: false });

        if (!error && refs) {
          const normalized = (refs as any[]).map((r) => ({
            ...r,
            referral_code: r.referral_code ?? '',
            referred_center: Array.isArray(r.referred_center) ? r.referred_center[0] : r.referred_center,
          })) as ReferralRow[];
          setReferrals(normalized);
        }
      } catch {
        // Fallback: use API commissions as referral list
        try {
          const res = await fetch('/api/referral', {
            headers: { Authorization: `Bearer ${session!.access_token}` },
          });
          if (res.ok) {
            const json = await res.json();
            const commissions = json.commissions ?? [];
            const byCenter = new Map<string, { name: string; plan: string; total: number; created_at: string; status: string }>();
            for (const c of commissions) {
              const key = c.referred_center_id || c.id;
              const existing = byCenter.get(key);
              const total = (existing?.total ?? 0) + Number(c.commission_amount || 0);
              byCenter.set(key, {
                name: c.referred_center_name ?? '-',
                plan: c.referred_center_plan ?? '-',
                total,
                created_at: c.period_month ? `${c.period_month}-01` : new Date().toISOString(),
                status: c.status === 'paid' || c.status === 'withdrawable' ? 'active' : c.status === 'hold' ? 'hold' : 'inactive',
              });
            }
            setReferrals(Array.from(byCenter.entries()).map(([id, v]) => ({
              id,
              referred_center_id: id,
              referral_code: '',
              status: v.status,
              created_at: v.created_at,
              total_earned_egp: v.total,
              referred_center: { id, name: v.name, plan: v.plan, status: v.status },
            })));
          }
        } catch {
          setReferrals([]);
        }
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [centerId, loadReferralSummary]);

  if (user?.role !== 'owner' && user?.role !== 'super_admin') {
    return (
      <div className="min-h-screen w-full bg-[var(--color-surface-0)] p-4">
        <PageHeader title={t('title')} />
        <p className="text-[var(--color-text-secondary)]">{tRef('ownerOnly')}</p>
      </div>
    );
  }

  const openPayoutPdf = async (payoutId: string) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) return;
    try {
      const res = await fetch(`/api/payouts/${payoutId}/pdf`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const opened = window.open(url, '_blank', 'noopener,noreferrer');
      if (!opened) URL.revokeObjectURL(url);
      else setTimeout(() => URL.revokeObjectURL(url), 120_000);
    } catch {
      /* ignore */
    }
  };

  const getStatusBadge = (status: string) => {
    if (status === 'active') {
      return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">{tRef('statusActiveShort')}</span>;
    }
    if (status === 'pending') {
      return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">{tRef('statusPendingShort')}</span>;
    }
    return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">{tRef('statusInactiveShort')}</span>;
  };

  return (
    <div className="min-h-screen w-full bg-[var(--color-surface-0)] p-4 md:p-6" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <button
        onClick={() => router.push('/settings')}
        className="flex items-center gap-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] mb-4"
      >
        <ArrowLeft className="w-4 h-4" />
        {tc('back')}
      </button>

      <PageHeader title={t('title')} />

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-2 border-teal-500 border-t-transparent rounded-full" />
        </div>
      ) : (
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Summary card */}
          <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm p-6">
            <h2 className="font-bold text-[var(--color-text-primary)] mb-4 flex items-center gap-2">
              <Gift className="w-5 h-5 text-teal-600" />
              {tRef('programSummary')}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-[var(--color-text-secondary)] mb-1">{tRef('yourCode')}</p>
                <p className="font-mono text-lg font-bold text-[var(--color-text-primary)]">{referralCode || '-'}</p>
                {user?.role === 'super_admin' && !referralCode ? (
                  <p className="mt-2 text-sm text-[var(--color-text-secondary)] max-w-sm">{tRef('noCodeSuperAdmin')}</p>
                ) : null}
                {referralCode ? (
                  <button
                    type="button"
                    aria-label={tRef('copyLink')}
                    onClick={async () => {
                      if (!referLink) return;
                      try {
                        await navigator.clipboard.writeText(referLink);
                        setLinkCopied(true);
                        setTimeout(() => setLinkCopied(false), 2000);
                      } catch {
                        /* ignore */
                      }
                    }}
                    className="mt-3 inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-3 py-2 text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-surface-2)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)] focus:ring-offset-2 focus:ring-offset-[var(--color-surface-1)] btn-press chq-focus"
                  >
                    <Link2 className="h-4 w-4 shrink-0" aria-hidden />
                    {linkCopied ? tRef('copyDoneCheck') : tRef('shareLink')}
                  </button>
                ) : null}
              </div>
              <div>
                <p className="text-xs text-[var(--color-text-secondary)] mb-1">{tRef('referredCentersCountLabel')}</p>
                <p className="text-xl font-bold text-[var(--color-text-primary)]">{referrals.length}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--color-text-secondary)] mb-1">{tRef('totalEarned')}</p>
                <p className="text-xl font-bold text-teal-600 font-mono">
                  <span dir="ltr" className="tabular-nums inline-block">
                    {formatCurrency(Number(totalEarned || 0), locale)}
                  </span>
                </p>
              </div>
            </div>
          </div>

          <ReferralWithdrawalPanel
            available={availableBalance}
            instapayNumber={referralInstapay}
            onSuccess={() => void loadReferralSummary()}
          />

          {payoutRequests.length > 0 && (
            <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm overflow-hidden">
              <div className="p-4 border-b border-[var(--color-border-subtle)]">
                <h3 className="font-bold text-[var(--color-text-primary)]">
                  {tRef('payoutHistoryTitle')}
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-0)]">
                      <th className="text-start py-3 px-4 font-semibold text-[var(--color-text-secondary)]">
                        {tRef('payoutAmountLabel')}
                      </th>
                      <th className="text-start py-3 px-4 font-semibold text-[var(--color-text-secondary)]">
                        {tRef('tableStatus')}
                      </th>
                      <th className="text-start py-3 px-4 font-semibold text-[var(--color-text-secondary)]">
                        {tRef('payoutRequestedCol')}
                      </th>
                      <th className="text-end py-3 px-4 font-semibold text-[var(--color-text-secondary)]">
                        {tRef('pdfColumn')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {payoutRequests.map((p) => {
                      const canPdf = p.status === 'approved' || p.status === 'paid';
                      return (
                        <tr key={p.id} className="border-b border-[var(--color-border-subtle)]">
                          <td className="py-3 px-4 font-mono font-semibold">
                            <span dir="ltr" className="tabular-nums inline-block">
                              {formatCurrency(Number(p.amount_requested ?? 0), locale)}
                            </span>
                          </td>
                          <td className="py-3 px-4">{p.status}</td>
                          <td className="py-3 px-4 text-[var(--color-text-secondary)]">
                            {formatDate(p.requested_at, locale, {
                              day: '2-digit',
                              month: '2-digit',
                              year: 'numeric',
                            })}
                          </td>
                          <td className="py-3 px-4 text-end">
                            {canPdf ? (
                              <button
                                type="button"
                                onClick={() => void openPayoutPdf(p.id)}
                                className="inline-flex items-center gap-1 rounded-lg border border-teal-600/60 px-2 py-1 text-xs font-semibold text-teal-600 hover:bg-teal-50 dark:hover:bg-teal-950/30"
                              >
                                <Download className="w-3.5 h-3.5" />
                                {tc('download')}
                              </button>
                            ) : (
                              <span className="text-xs text-[var(--color-text-secondary)]">-</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm p-6">
            <h2 className="font-bold text-[var(--color-text-primary)] mb-4">
              {tRef('commissionTiersTitle')}
            </h2>
            <ul className="space-y-3 text-sm text-[var(--color-text-secondary)]">
              <li className="border-s-4 border-teal-600/80 ps-3">
                <span className="text-[var(--color-text-primary)] font-medium">{tRef('commissionTierMonth1', referralPct)}</span>
              </li>
              <li className="border-s-4 border-teal-600/50 ps-3">
                <span className="text-[var(--color-text-primary)] font-medium">{tRef('commissionTierMonths2to12', referralPct)}</span>
              </li>
              <li className="border-s-4 border-teal-600/30 ps-3">
                <span className="text-[var(--color-text-primary)] font-medium">{tRef('commissionTierMonth13Plus', referralPct)}</span>
              </li>
            </ul>
          </div>

          {/* Referrals table */}
          <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm overflow-hidden">
            <div className="p-4 border-b border-[var(--color-border-subtle)]">
              <h3 className="font-bold text-[var(--color-text-primary)]">
                {tRef('referralListTitle')}
              </h3>
            </div>
            {referrals.length === 0 ? (
              <div className="p-12 text-center text-[var(--color-text-secondary)]">
                <p className="font-medium">
                  {tRef('noReferralsShareMessage')}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-0)]">
                      <th className="text-start py-3 px-4 font-semibold text-[var(--color-text-secondary)]">
                        {tRef('centerNameColumn')}
                      </th>
                      <th className="text-start py-3 px-4 font-semibold text-[var(--color-text-secondary)]">
                        {tRef('joinDateColumn')}
                      </th>
                      <th className="text-start py-3 px-4 font-semibold text-[var(--color-text-secondary)]">
                        {t('plan')}
                      </th>
                      <th className="text-start py-3 px-4 font-semibold text-[var(--color-text-secondary)]">
                        {tRef('tableStatus')}
                      </th>
                      <th className="text-end py-3 px-4 font-semibold text-[var(--color-text-secondary)]">
                        {tRef('earnedColumn')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {referrals.map((r) => (
                      <tr key={r.id} className="border-b border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-0)]">
                        <td className="py-3 px-4 font-medium text-[var(--color-text-primary)]">
                          {(r.referred_center as { name?: string })?.name ?? '-'}
                        </td>
                        <td className="py-3 px-4 text-[var(--color-text-secondary)]">
                          {formatDate(r.created_at, locale, {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                          })}
                        </td>
                        <td className="py-3 px-4 text-[var(--color-text-secondary)]">
                          {planToLabel((r.referred_center as { plan?: string })?.plan, locale)}
                        </td>
                        <td className="py-3 px-4">
                          {getStatusBadge(r.status)}
                        </td>
                        <td className="py-3 px-4 text-end font-mono font-semibold text-[var(--color-text-primary)]">
                          <span dir="ltr" className="tabular-nums inline-block">
                            {formatCurrency(Number(r.total_earned_egp ?? 0), locale)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
