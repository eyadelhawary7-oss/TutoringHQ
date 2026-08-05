import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { parseBodyWithLimit } from '@/lib/validate';
import { getAdminContext, requireAdminRole } from '@/lib/admin-auth';
import { OUTSTANDING_STATUSES } from '@/lib/referralCommissionStatus';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin =
  supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

/**
 * D22: this route read `referral_reward_records`. That table's only writer was
 * POST /api/referrals/calculate-rewards, which had no cron registration in
 * vercel.json and no caller in src/, so this admin screen was structurally
 * empty. That route was DELETED on 5 August 2026 and the table is dropped by a
 * migration applied by hand; nothing writes it any more.
 * `referral_commissions` is the canonical ledger, written monthly by
 * /api/cron/referral-automation.
 *
 * Column names below are the canonical ones. Note `commission_rate` is a
 * FRACTION (0.25), where the retired table's `reward_percentage` was a PERCENT
 * (25) — the admin page already multiplied by 100, so it was rendering 2500%.
 */
type CommissionRow = {
  id: string;
  referrer_center_id: string;
  referred_center_id: string;
  months_since_activation: number;
  commission_rate: number | string;
  referred_plan_fee: number | string;
  commission_amount: number | string;
  status: string;
  hold_until: string | null;
  paid_at: string | null;
  period_month: string;
  created_at: string;
  referred_paid_in_full: boolean | null;
  referrer?: { id: string; name: string; center_code: string | null; phone: string | null } | null;
  referred?: { id: string; name: string; center_code: string | null; plan: string | null } | null;
};

/**
 * Outstanding commission — earned, not yet paid out. The retired table spread
 * this across 'pending', 'held' and 'available'. 'forfeited' is deliberately
 * absent: it is commission the centre lost, not commission owed to it, and it
 * must never be markable as paid.
 */
const OUTSTANDING = OUTSTANDING_STATUSES as readonly string[];

// GET - list reward records + per-referrer totals
export async function GET(request: Request) {
  if (!supabaseAdmin) {
    return NextResponse.json({ errorKey: 'referralRewards.errors.config' }, { status: 500 });
  }

  if (!(await getAdminContext(request))) {
    return NextResponse.json({ errorKey: 'referralRewards.errors.unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const statusFilter = searchParams.get('status') ?? '';

  const { data: totalsRows, error: totalsErr } = await supabaseAdmin
    .from('referral_commissions')
    .select(
      `
      referrer_center_id,
      commission_amount,
      status,
      referrer:centers!referral_commissions_referrer_center_id_fkey(name)
    `,
    );

  if (totalsErr) {
    return NextResponse.json(
      { errorKey: 'referralRewards.errors.listFailed', error: totalsErr.message },
      { status: 500 },
    );
  }

  const totals: Record<
    string,
    {
      center_name: string;
      pending: number;
      paid: number;
      forfeited: number;
      total_records: number;
    }
  > = {};

  for (const raw of totalsRows ?? []) {
    const r = raw as {
      referrer_center_id: string;
      commission_amount: number | string;
      status: string;
      referrer?: { name: string } | { name: string }[] | null;
    };
    const rid = r.referrer_center_id;
    const refEmbed = r.referrer;
    const refName = Array.isArray(refEmbed) ? refEmbed[0]?.name : refEmbed?.name;
    if (!totals[rid]) {
      totals[rid] = {
        center_name: refName ?? '',
        pending: 0,
        paid: 0,
        forfeited: 0,
        total_records: 0,
      };
    }
    if (!totals[rid].center_name && refName) totals[rid].center_name = refName;
    totals[rid].total_records++;
    const st = r.status;
    if (OUTSTANDING.includes(st)) {
      totals[rid].pending += Number(r.commission_amount);
    }
    if (st === 'paid') {
      totals[rid].paid += Number(r.commission_amount);
    }
    if (st === 'forfeited') {
      totals[rid].forfeited += Number(r.commission_amount);
    }
  }

  let listQuery = supabaseAdmin
    .from('referral_commissions')
    .select(
      `
      *,
      referrer:centers!referral_commissions_referrer_center_id_fkey(
        id, name, center_code, phone
      ),
      referred:centers!referral_commissions_referred_center_id_fkey(
        id, name, center_code, plan
      )
    `,
    )
    .order('created_at', { ascending: false });

  // 'pending' is the UI's word for "outstanding", which under the canonical
  // vocabulary is hold + withdrawable.
  if (statusFilter === 'pending') {
    listQuery = listQuery.in('status', OUTSTANDING);
  } else if (statusFilter) {
    listQuery = listQuery.eq('status', statusFilter);
  }

  const { data, error } = await listQuery;
  if (error) {
    return NextResponse.json(
      { errorKey: 'referralRewards.errors.listFailed', error: error.message },
      { status: 500 },
    );
  }

  const rows = (data ?? []) as CommissionRow[];

  return NextResponse.json({
    records: rows,
    totals: Object.entries(totals).map(([center_id, t]) => ({
      center_id,
      ...t,
    })),
  });
}

// PATCH - mark reward records paid (batch), payable statuses only
export async function PATCH(request: Request) {
  if (!supabaseAdmin) {
    return NextResponse.json({ errorKey: 'referralRewards.errors.config' }, { status: 500 });
  }

  const ctx = await getAdminContext(request);
  if (!ctx) {
    return NextResponse.json({ errorKey: 'referralRewards.errors.unauthorized' }, { status: 401 });
  }
  // Role gate added per docs/AUDIT_v22.md Phase 3 / Phase 8 P0 (Task 9)
  const roleErr = requireAdminRole(ctx, ['super_admin']);
  if (roleErr) return roleErr;

  let body: { record_ids?: unknown };
  try {
    body = (await parseBodyWithLimit(request, 65536)) as { record_ids?: unknown };
  } catch {
    return NextResponse.json({ errorKey: 'referralRewards.errors.invalidBody' }, { status: 400 });
  }

  const record_ids = body.record_ids;
  if (!Array.isArray(record_ids) || record_ids.length === 0) {
    return NextResponse.json({ errorKey: 'referralRewards.errors.recordIdsRequired' }, { status: 400 });
  }

  const ids = record_ids.filter((id): id is string => typeof id === 'string' && id.length > 0);
  if (ids.length === 0) {
    return NextResponse.json({ errorKey: 'referralRewards.errors.recordIdsRequired' }, { status: 400 });
  }

  const paidAt = new Date().toISOString();

  // The status filter is the guard: only outstanding commission can be marked
  // paid. A 'paid' row cannot be double-paid and a 'forfeited' row — commission
  // the centre lost — can never be turned into a payment.
  const { data: updated, error } = await supabaseAdmin
    .from('referral_commissions')
    .update({ status: 'paid', paid_at: paidAt })
    .in('id', ids)
    .in('status', OUTSTANDING)
    .select('id');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, paid_count: updated?.length ?? 0 });
}
