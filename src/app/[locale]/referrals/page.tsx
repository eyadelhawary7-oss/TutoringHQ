'use client';

import { useState, useEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useUser } from '@/contexts/UserContext';
import { supabase } from '@/lib/supabase';
import { Gift, Copy, ChevronDown, ChevronUp, Link2, DollarSign, Calendar, Users, Banknote } from 'lucide-react';
import { PageHeader } from '@/components/shared';

const ARABIC_MONTHS: Record<string, string> = {
  '01': 'يناير', '02': 'فبراير', '03': 'مارس', '04': 'أبريل', '05': 'مايو', '06': 'يونيو',
  '07': 'يوليو', '08': 'أغسطس', '09': 'سبتمبر', '10': 'أكتوبر', '11': 'نوفمبر', '12': 'ديسمبر',
};

function maskCenterName(name: string): string {
  if (!name || name.length < 2) return '***';
  return name.slice(0, 2) + '***';
}

function fmt(n: number): string {
  return Number(n).toLocaleString('en-US');
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
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState('');
  const [payoutSubmitting, setPayoutSubmitting] = useState(false);
  const [payoutError, setPayoutError] = useState<string | null>(null);

  const fetchData = async () => {
    const { data: { session } } = await supabase.auth.getSession();
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
      setPayoutError('أدخل مبلغاً صحيحاً');
      return;
    }
    if (amount > (data?.available ?? 0)) {
      setPayoutError(`المبلغ يتجاوز الرصيد المتاح (${fmt(data?.available ?? 0)} ${tc('egp')})`);
      return;
    }
    setPayoutError(null);
    setPayoutSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
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
      setPayoutError(err instanceof Error ? err.message : 'حدث خطأ');
    } finally {
      setPayoutSubmitting(false);
    }
  };

  if (user?.role !== 'owner') {
    return (
      <div className="min-h-screen bg-background p-4">
        <PageHeader title={t('title')} />
        <p className="text-muted-foreground">{t('ownerOnly', { defaultValue: 'Only center owners can view the referrals dashboard.' })}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-4 flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-teal-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  const appUrl = typeof window !== 'undefined' ? window.location.origin : 'https://centerhq.com';
  const localePrefix = locale === 'ar' ? '' : `/${locale}`;
  const referLink = `${appUrl}${localePrefix}/refer/${data?.referralCode ?? ''}`;
  const signupLink = `${appUrl}${localePrefix}/signup?ref=${data?.referralCode ?? ''}`;
  const whatsappShare = `https://wa.me/?text=${encodeURIComponent(`مرحباً! جرّب CenterHQ لإدارة سنترك بسهولة 🎓\nاحجز عرضك التجريبي من هنا:\n${referLink}`)}`;

  return (
    <div className="min-h-screen bg-background p-4 md:p-6" dir="rtl">
      <PageHeader title={t('title')} />

      <div className="max-w-2xl mx-auto space-y-6">
        {/* Section 1 — Stats cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-teal-50 border border-teal-200 rounded-xl p-4">
            <p className="text-xs text-teal-700 font-medium mb-1">{t('totalEarned')}</p>
            <p className="text-xl font-bold text-teal-800 font-mono">{fmt(data?.totalEarned ?? 0)}</p>
            <p className="text-xs text-teal-600">{tc('egp')}</p>
          </div>
          <div className="bg-green-50 border border-green-200 rounded-xl p-4">
            <p className="text-xs text-green-700 font-medium mb-1">{t('withdrawable')}</p>
            <p className="text-xl font-bold text-green-800 font-mono">{fmt(data?.available ?? 0)}</p>
            <p className="text-xs text-green-600">{tc('egp')}</p>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <p className="text-xs text-amber-700 font-medium mb-1">{t('pending', { defaultValue: 'Pending' })}</p>
            <p className="text-xl font-bold text-amber-800 font-mono">{fmt(data?.pending ?? 0)}</p>
            <p className="text-xs text-amber-600">{tc('egp')}</p>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
            <p className="text-xs text-slate-600 font-medium mb-1">{t('totalReferrals', { defaultValue: 'Total Referrals' })}</p>
            <p className="text-xl font-bold text-slate-800 font-mono">{fmt(data?.totalReferrals ?? 0)}</p>
          </div>
        </div>

        {/* Section 2 — Active referrals table */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100">
            <h2 className="font-bold text-slate-900 flex items-center gap-2">
              <Users className="w-5 h-5 text-teal-600" />
              {t('activeReferrals', { defaultValue: 'Active Referrals' })}
            </h2>
          </div>
          {(data?.activeReferrals?.length ?? 0) > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="text-start py-3 px-4 font-semibold text-slate-600">السنتر</th>
                    <th className="text-start py-3 px-4 font-semibold text-slate-600">الحالة</th>
                    <th className="text-end py-3 px-4 font-semibold text-slate-600">الشهور</th>
                    <th className="text-end py-3 px-4 font-semibold text-slate-600">مكافأة/شهر</th>
                    <th className="text-end py-3 px-4 font-semibold text-slate-600">الإجمالي</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.activeReferrals?.map((r) => (
                    <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-3 px-4 text-slate-700 font-mono">{maskCenterName(r.center_name)}</td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.status === 'converted' || r.status === 'active' ? 'bg-green-100 text-green-700' : r.status === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-700'}`}>
                          {r.status === 'converted' ? 'نشط' : r.status === 'active' ? 'نشط' : r.status === 'pending' ? 'معلق' : r.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-end text-slate-700">{fmt(r.months)}</td>
                      <td className="py-3 px-4 text-end font-mono text-slate-900">{fmt(r.monthly_reward)} {tc('egp')}</td>
                      <td className="py-3 px-4 text-end font-mono text-teal-700">{fmt(r.total)} {tc('egp')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-8 text-center text-slate-500 text-sm">{t('noReferrals', { defaultValue: 'No referrals yet' })}</div>
          )}
        </div>

        {/* Section 3 — Reward history */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100">
            <h2 className="font-bold text-slate-900 flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-teal-600" />
              {t('rewardHistory', { defaultValue: 'Reward History' })}
            </h2>
          </div>
          {(data?.rewardHistory?.length ?? 0) > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="text-start py-3 px-4 font-semibold text-slate-600">الشهر</th>
                    <th className="text-start py-3 px-4 font-semibold text-slate-600">السنتر</th>
                    <th className="text-end py-3 px-4 font-semibold text-slate-600">المبلغ</th>
                    <th className="text-start py-3 px-4 font-semibold text-slate-600">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.rewardHistory?.map((h) => {
                    const [y, m] = (h.period_month || '').split('-');
                    const monthLabel = m ? `${ARABIC_MONTHS[m] || m} ${y}` : '—';
                    let statusBadge: React.ReactNode;
                    if (h.status === 'held') {
                      const holdDate = h.held_until ? new Date(h.held_until) : null;
                      const daysLeft = holdDate ? Math.max(0, Math.ceil((holdDate.getTime() - Date.now()) / 86400000)) : 0;
                      statusBadge = (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                          في الانتظار 🔒 {daysLeft > 0 && `${daysLeft} يوم`}
                        </span>
                      );
                    } else if (h.status === 'available') {
                      statusBadge = <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">متاح ✅</span>;
                    } else if (h.status === 'paid') {
                      statusBadge = <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700">تم الصرف 💰</span>;
                    } else {
                      statusBadge = <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">{h.status}</span>;
                    }
                    return (
                      <tr key={h.id} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="py-3 px-4 text-slate-700">{monthLabel}</td>
                        <td className="py-3 px-4 text-slate-700 font-mono">{maskCenterName(h.referred_center_name)}</td>
                        <td className="py-3 px-4 text-end font-mono text-slate-900">{fmt(h.reward_amount)} {tc('egp')}</td>
                        <td className="py-3 px-4">{statusBadge}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-8 text-center text-slate-500 text-sm">{t('noCommissions')}</div>
          )}
        </div>

        {/* Section 4 — Payout request form */}
        {(data?.available ?? 0) > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <h2 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
              <Banknote className="w-5 h-5 text-teal-600" />
              {t('requestWithdrawal')}
            </h2>
            <p className="text-slate-700 mb-3">
              رصيدك المتاح: <span className="font-bold font-mono text-teal-600">{fmt(data?.available ?? 0)} {tc('egp')}</span>
            </p>
            <div className="flex flex-wrap gap-2 items-end">
              <div>
                <label className="block text-xs text-slate-600 mb-1">المبلغ (ج.م)</label>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={payoutAmount}
                  onChange={(e) => setPayoutAmount(e.target.value)}
                  placeholder={fmt(data?.available ?? 0)}
                  className="w-32 px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono"
                />
              </div>
              <button
                onClick={handlePayoutRequest}
                disabled={payoutSubmitting}
                className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 disabled:opacity-50"
              >
                {payoutSubmitting ? 'جاري الإرسال...' : t('requestWithdrawal')}
              </button>
            </div>
            {payoutError && <p className="text-red-600 text-sm mt-2">{payoutError}</p>}
            <p className="text-xs text-slate-500 mt-3">{t('processingTime')}</p>
          </div>
        )}

        {/* Section 5 — Share */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <h2 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
            <Gift className="w-5 h-5 text-teal-600" />
            {t('yourCode')}
          </h2>
          <p className="font-mono text-2xl font-bold text-teal-600 mb-4" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>
            {data?.referralCode || '—'}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={async () => {
                if (data?.referralCode) {
                  await navigator.clipboard.writeText(data.referralCode);
                  setCodeCopied(true);
                  setTimeout(() => setCodeCopied(false), 2000);
                }
              }}
              className="flex items-center gap-2 px-4 py-2 border border-slate-300 rounded-lg text-slate-700 text-sm font-medium hover:bg-slate-50"
            >
              <Copy className="w-4 h-4" />
              {codeCopied ? tc('copy') + ' ✓' : t('copyCode')}
            </button>
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(referLink);
                setLinkCopied(true);
                setTimeout(() => setLinkCopied(false), 2000);
              }}
              className="flex items-center gap-2 px-4 py-2 border border-slate-300 rounded-lg text-slate-700 text-sm font-medium hover:bg-slate-50"
            >
              <Link2 className="w-4 h-4" />
              {linkCopied ? tc('copy') + ' ✓' : t('shareLink')}
            </button>
            <a
              href={whatsappShare}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2 bg-[#25D366] text-white rounded-lg text-sm font-medium hover:bg-[#20bd5a]"
            >
              <span>💬</span>
              {t('shareWhatsApp')}
            </a>
          </div>
        </div>

        {/* How It Works */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <button
            onClick={() => setHowItWorksOpen(!howItWorksOpen)}
            className="w-full flex items-center justify-between p-4 text-start hover:bg-slate-50"
          >
            <h2 className="font-bold text-slate-900 flex items-center gap-2">
              <Calendar className="w-5 h-5 text-teal-600" />
              {t('howItWorks')}
            </h2>
            {howItWorksOpen ? <ChevronUp className="w-5 h-5 text-slate-500" /> : <ChevronDown className="w-5 h-5 text-slate-500" />}
          </button>
          {howItWorksOpen && (
            <div className="px-4 pb-4 space-y-3 text-sm text-slate-700">
              <p className="flex items-start gap-2"><span className="text-teal-600">1.</span> شارك كودك مع أصحاب السناتر 🔗</p>
              <p className="flex items-start gap-2"><span className="text-teal-600">2.</span> يسجلوا ويدفعوا أول شهر ← تكسب 25% 💰</p>
              <p className="flex items-start gap-2"><span className="text-teal-600">3.</span> كل شهر يدفعوا ← تكسب 10% 📅</p>
              <p className="flex items-start gap-2"><span className="text-teal-600">4.</span> بعد السنة الأولى ← 5% للأبد ♾️</p>
              <p className="text-red-600 text-xs mt-2">{t('commissionCondition')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
