import { NextRequest, NextResponse } from 'next/server';
import { requireInternalAdminApi } from '@/lib/admin-auth';
import { isPayoutRequestStatus, type PayoutRequestStatus } from '@/lib/payoutApproval';

/**
 * GET /api/admin/payout-requests — the referral payout approval queue.
 *
 * PAYOUT-SYSTEM-SPEC.md §2.1: no API route and no admin page anywhere read
 * `payout_requests` for approval, so a submitted request could never leave
 * 'pending'. This is the read half; the write half is
 * PATCH /api/admin/payout-requests/[id].
 *
 * Gate: `requireInternalAdminApi` — super_admin and internal_admin may LOOK at
 * the queue, matching GET /api/admin/withdrawals. Releasing money is stricter
 * and lives on the PATCH route (super_admin with a real admin_users row).
 *
 * COLUMNS: only the eight that exist in the live catalog, verified against
 * information_schema.columns on 4 August 2026 —
 *   id, center_id, amount_requested, status, payment_method, payment_details,
 *   requested_at, processed_at
 * `approved_by` / `approved_at` / `rejected_*` / `paid_*` are NOT selected:
 * they do not exist until
 * supabase/migrations/20260804170000_payout_requests_approval_path.sql is
 * applied by hand. Selecting a column that is absent is F26 and CI cannot
 * catch it.
 */

export const dynamic = 'force-dynamic';

const MAX_ROWS = 200;

type Row = {
  id: string;
  center_id: string;
  amount_requested: number | string | null;
  status: string | null;
  payment_method: string | null;
  payment_details: Record<string, unknown> | null;
  requested_at: string | null;
  processed_at: string | null;
  centers: { name: string | null } | { name: string | null }[] | null;
};

function centerName(c: Row['centers']): string | null {
  if (Array.isArray(c)) return c[0]?.name ?? null;
  return c?.name ?? null;
}

function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function GET(request: NextRequest) {
  const auth = await requireInternalAdminApi(request);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const statusParam = searchParams.get('status');
  // Default to the queue that matters: what is waiting on a human.
  const status: PayoutRequestStatus | null =
    statusParam === null || statusParam === ''
      ? 'pending'
      : statusParam === 'all'
        ? null
        : isPayoutRequestStatus(statusParam)
          ? statusParam
          : 'pending';

  let q = auth.supabaseAdmin
    .from('payout_requests')
    .select(
      `
      id,
      center_id,
      amount_requested,
      status,
      payment_method,
      payment_details,
      requested_at,
      processed_at,
      centers ( name )
    `,
    )
    .order('requested_at', { ascending: false })
    .limit(MAX_ROWS);

  if (status) q = q.eq('status', status);

  const { data, error } = await q;

  if (error) {
    console.error('[admin/payout-requests GET]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as Row[];
  const centerIds = [...new Set(rows.map((r) => r.center_id).filter(Boolean))];

  /*
   * Coverage context for the approver.
   *
   * `/api/referrals/payout` checks the requested amount against the sum of
   * `referral_reward_records` in status 'available' but does NOT consume those
   * rows, so a centre can hold two requests drawn on the same balance. That is
   * request-side (§2.7 / A3) and is not fixed here — but an approver must not
   * be asked to release money without being able to see it. Both figures are
   * read-only and advisory; the blocking rule lives in the RPC, which refuses a
   * second concurrent 'approved' request for the same centre.
   */
  const availableByCenter = new Map<string, number>();
  const committedByCenter = new Map<string, number>();

  if (centerIds.length) {
    const { data: rewardRows, error: rewardErr } = await auth.supabaseAdmin
      .from('referral_reward_records')
      .select('referrer_center_id, reward_amount, status')
      .in('referrer_center_id', centerIds)
      .eq('status', 'available');
    if (rewardErr) {
      console.error('[admin/payout-requests GET] rewards', rewardErr);
    }
    for (const r of (rewardRows ?? []) as {
      referrer_center_id: string;
      reward_amount: number | string | null;
    }[]) {
      const prev = availableByCenter.get(r.referrer_center_id) ?? 0;
      availableByCenter.set(r.referrer_center_id, prev + (numberOrNull(r.reward_amount) ?? 0));
    }

    const { data: committedRows, error: committedErr } = await auth.supabaseAdmin
      .from('payout_requests')
      .select('center_id, amount_requested, status')
      .in('center_id', centerIds)
      .in('status', ['approved', 'paid']);
    if (committedErr) {
      console.error('[admin/payout-requests GET] committed', committedErr);
    }
    for (const r of (committedRows ?? []) as {
      center_id: string;
      amount_requested: number | string | null;
    }[]) {
      const prev = committedByCenter.get(r.center_id) ?? 0;
      committedByCenter.set(r.center_id, prev + (numberOrNull(r.amount_requested) ?? 0));
    }
  }

  const payoutRequests = rows.map((r) => {
    const details = (r.payment_details ?? {}) as Record<string, unknown>;
    return {
      id: r.id,
      center_id: r.center_id,
      center_name: centerName(r.centers),
      amount_requested: numberOrNull(r.amount_requested) ?? 0,
      status: r.status,
      payment_method: r.payment_method,
      requested_at: r.requested_at,
      processed_at: r.processed_at,
      // Server-authoritative breakdown snapshotted at request time by
      // /api/referrals/payout. Displayed, never recomputed here.
      instapay_number:
        typeof details.instapay_number === 'string' ? details.instapay_number : null,
      gross_amount: numberOrNull(details.gross_amount),
      processing_fee: numberOrNull(details.processing_fee),
      withdrawal_fee: numberOrNull(details.withdrawal_fee),
      net_amount: numberOrNull(details.net_amount),
      available_rewards: availableByCenter.get(r.center_id) ?? 0,
      committed_elsewhere: committedByCenter.get(r.center_id) ?? 0,
    };
  });

  return NextResponse.json({ payoutRequests });
}
