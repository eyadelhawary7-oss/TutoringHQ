import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdminApi } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

function quarterMonthRange(year: number, quarter: number): { from: string; to: string } {
  const startMonth = (quarter - 1) * 3;
  const endMonth = startMonth + 2;
  // period_month is 'YYYY-MM' text, so the boundaries must be month-precision too:
  // a 'YYYY-MM-01' upper/lower bound would lexically exclude the boundary month
  // (e.g. '2026-01' < '2026-01-01', dropping January from Q1).
  const from = `${year}-${String(startMonth + 1).padStart(2, '0')}`;
  const to = `${year}-${String(endMonth + 1).padStart(2, '0')}`;
  return { from, to };
}

function parseQuarterParam(q: string): { year: number; quarter: number } | null {
  const m = /^(\d{4})-Q([1-4])$/.exec(q.trim());
  if (!m) return null;
  return { year: parseInt(m[1], 10), quarter: parseInt(m[2], 10) };
}

type CommissionRowDb = {
  id: string;
  referral_id: string | null;
  referrer_center_id: string;
  period_month: string;
  commission_rate: number | string | null;
  commission_amount: number | string | null;
  referred_plan_fee: number | string | null;
  status: string | null;
  hold_until: string | null;
  paid_at: string | null;
};

export async function GET(request: NextRequest) {
  const auth = await requireSuperAdminApi(request);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const statusFilter = (searchParams.get('status') ?? 'all').toLowerCase();
  const quarterParam = searchParams.get('quarter') ?? 'all';

  let query = auth.supabaseAdmin
    .from('referral_commissions')
    .select(
      'id, referral_id, referrer_center_id, period_month, commission_rate, commission_amount, referred_plan_fee, status, hold_until, paid_at',
    )
    .order('referrer_center_id', { ascending: true })
    .order('period_month', { ascending: true });

  if (quarterParam !== 'all') {
    const parsed = parseQuarterParam(quarterParam);
    if (!parsed) {
      return NextResponse.json({ error: 'Invalid quarter (use YYYY-Qn)' }, { status: 400 });
    }
    const { from, to } = quarterMonthRange(parsed.year, parsed.quarter);
    query = query.gte('period_month', from).lte('period_month', to);
  }

  if (statusFilter === 'pending') {
    query = query.in('status', ['hold', 'withdrawable']);
  } else if (statusFilter === 'paid') {
    query = query.eq('status', 'paid');
  }

  const { data: rows, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const list = (rows ?? []) as CommissionRowDb[];
  const referralIds = [...new Set(list.map((r) => r.referral_id).filter((x): x is string => !!x))];
  const referredByReferralId = new Map<string, string>();
  if (referralIds.length > 0) {
    const { data: refRows } = await auth.supabaseAdmin
      .from('referrals')
      .select('id, referred_center_id')
      .in('id', referralIds);
    for (const row of refRows ?? []) {
      const rr = row as { id: string; referred_center_id: string | null };
      if (rr.referred_center_id) referredByReferralId.set(rr.id, rr.referred_center_id);
    }
  }

  const centerIds = new Set<string>();
  for (const r of list) {
    centerIds.add(r.referrer_center_id);
    const refC = r.referral_id ? referredByReferralId.get(r.referral_id) : undefined;
    if (refC) centerIds.add(refC);
  }

  const { data: centers } =
    centerIds.size > 0
      ? await auth.supabaseAdmin.from('centers').select('id, name').in('id', [...centerIds])
      : { data: [] as { id: string; name: string }[] };

  const nameById = new Map((centers ?? []).map((c) => [c.id, c.name ?? ',']));

  const commissions = list.map((r) => {
    const referredId = r.referral_id ? referredByReferralId.get(r.referral_id) ?? null : null;
    return {
      id: r.id,
      referral_id: r.referral_id,
      referrer_center_id: r.referrer_center_id,
      referred_center_id: referredId,
      referrer_name: nameById.get(r.referrer_center_id) ?? ',',
      referred_name: referredId ? (nameById.get(referredId) ?? ',') : ',',
      period_month: r.period_month,
      commission_rate: r.commission_rate,
      commission_amount: Number(r.commission_amount ?? 0),
      referred_plan_fee: r.referred_plan_fee != null ? Number(r.referred_plan_fee) : null,
      status: r.status,
      hold_until: r.hold_until,
      paid_at: r.paid_at,
    };
  });

  const unpaid = commissions.filter((c) => c.status === 'hold' || c.status === 'withdrawable');
  const paid = commissions.filter((c) => c.status === 'paid');
  const totalOwed = unpaid.reduce((s, c) => s + c.commission_amount, 0);
  const totalPaid = paid.reduce((s, c) => s + c.commission_amount, 0);
  const referrersOwedCount = new Set(unpaid.map((c) => c.referrer_center_id)).size;

  let summaryQuarter: number | null = null;
  let summaryYear: number | null = null;
  if (quarterParam !== 'all') {
    const parsed = parseQuarterParam(quarterParam);
    if (parsed) {
      summaryQuarter = parsed.quarter;
      summaryYear = parsed.year;
    }
  }

  return NextResponse.json({
    commissions,
    summary: {
      quarter: summaryQuarter,
      year: summaryYear,
      quarterAll: quarterParam === 'all',
      totalOwed,
      totalPaid,
      referrersOwedCount,
    },
  });
}
