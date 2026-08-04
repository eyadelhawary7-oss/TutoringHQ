// GET /api/admin/center-payouts
//
// The System-1 payout approval queue, with VISIBLE AGEING.
//
// ⚠ NAMESPACE. This is NOT /api/admin/payouts. That path already belongs to
// `commission_payouts` — the INTERNAL STAFF commission system (base salary, T1/
// T2 tiers, loyalty bonuses, sales reps), which is a different domain with a
// different table, a different approval model and a different payee. The two
// must never be conflated: `commission_payouts` pays employees, `center_payouts`
// pays tenant centres their referral earnings and cashed-out credits.
//
// The queue SCREEN lives in Merged-Admin-Money and Merged-Verification-Payouts.
// Both are PROTECTED files and Eyad's phase. This is the data behind them.
//
// ── WHY THIS ROUTE EXISTS (PAYOUT-SYSTEM-SPEC.md §2.1) ──────────────────────
//
// Verified live 2026-08-04: `payout_requests` has 'approved' in its status CHECK
// and NO WRITER OF `status` ANYWHERE in src/. Six files reference the table; not
// one can approve. A centre can submit a referral payout today and its status
// can never leave 'pending' through any code path in the application.
//
// ── §7.5, WHAT THE QUEUE MUST SAY ───────────────────────────────────────────
//
// "Payouts wait. No fallback approver, at any amount, for any duration." A
// queue that grows during an absence is the INTENDED behaviour, not a defect to
// engineer around later. So every row carries its Cairo request date, its age
// in days, and an explicit `noFallbackApprover: true`. There is no ETA field,
// because the platform cannot honour one, and there is no expiry.

import { NextRequest, NextResponse } from 'next/server';
import { requireInternalAdminApi } from '@/lib/admin-auth';
import { describeWaiting } from '@/lib/collectionPayout/payoutAging';
import {
  COLLECTION_PAYOUT_CONFIG_POINT,
  loadCollectionPayoutConfig,
  refusalBody,
} from '@/lib/collectionPayout/config';
import { isNotMigrated } from '@/lib/collectionPayout/payoutEngine';
import { OPEN_PAYOUT_STATES } from '@/lib/collectionPayout/payoutStates';

export const dynamic = 'force-dynamic';

interface QueueRow {
  id: string;
  center_id: string;
  status: string;
  gross_minor: number;
  net_minor: number;
  rail: string;
  source: string;
  requested_at: string;
  approved_at: string | null;
}

export async function GET(request: NextRequest) {
  const auth = await requireInternalAdminApi(request);
  if (!auth.ok) return auth.response;

  const config = await loadCollectionPayoutConfig(auth.supabaseAdmin);

  // The queue is READ-ONLY, so an unconfigured rail does not block it. An
  // operator must be able to SEE the queue that cannot be released, or the
  // "requests age visibly" requirement is unmet exactly when it matters most.
  // The readiness block travels alongside so the screen says why nothing can be
  // approved rather than rendering an inert button.
  const readiness = config.configured
    ? { ready: true as const }
    : { ready: false as const, ...refusalBody(config) };

  const { data, error } = await auth.supabaseAdmin
    .from('center_payouts')
    .select('id, center_id, status, gross_minor, net_minor, rail, source, requested_at, approved_at')
    .in('status', [...OPEN_PAYOUT_STATES])
    .order('requested_at', { ascending: true })
    .limit(500);

  if (error) {
    if (isNotMigrated(error)) {
      // The ledger is a PROPOSAL, not applied. Return an empty queue that SAYS
      // SO, rather than a 500 — or, far worse, an empty queue that reads as
      // "no payouts are waiting".
      return NextResponse.json({
        configPoint: COLLECTION_PAYOUT_CONFIG_POINT,
        readiness,
        queue: [],
        queueSourced: false,
        queueUnavailableReason: 'ledger_not_migrated',
        queueUnavailableDetail:
          'center_payouts does not exist in the live catalog. It is proposed in supabase/migrations/20260804150000_PROPOSAL_payout_system_1_ledger.sql, which Eyad applies by hand. This empty list means UNKNOWN, not NONE.',
      });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const now = new Date();
  const queue = ((data ?? []) as QueueRow[]).map((row) => {
    const waiting = describeWaiting(row.requested_at, now);
    return {
      id: row.id,
      centerId: row.center_id,
      status: row.status,
      grossMinor: row.gross_minor,
      netMinor: row.net_minor,
      rail: row.rail,
      source: row.source,
      requestedCairoDate: waiting.requestedCairoDate,
      ageDays: waiting.ageDays,
      ageBand: waiting.band,
      statusKey: waiting.statusKey,
      // Stated on every row so a surface cannot forget it. §7.5.
      neverExpires: true,
      noFallbackApprover: true,
      noFallbackApproverKey: waiting.noFallbackApproverKey,
    };
  });

  return NextResponse.json({
    configPoint: COLLECTION_PAYOUT_CONFIG_POINT,
    readiness,
    queue,
    queueSourced: true,
  });
}
