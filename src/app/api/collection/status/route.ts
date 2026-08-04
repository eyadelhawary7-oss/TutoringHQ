// GET /api/collection/status
//
// Honest readiness for online collection, for the principal in the session.
//
// This route exists so that a surface never has to guess. It returns the exact
// cause chain — the config point, the verification gate, the payout destination
// — and it returns ZEROS with a reason for every figure it cannot source.
//
// It NEVER returns `canCollect: true` on a default, and it never returns a
// balance it did not read from the ledger.

import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';
import { evaluateCollectionEligibility } from '@/lib/collectionPayout/enableCollection';
import { getAvailableBalanceMinor } from '@/lib/collectionPayout/payoutEngine';
import { COLLECTION_PAYOUT_CONFIG_POINT } from '@/lib/collectionPayout/config';
import type { Principal } from '@/lib/collectionPayout/verificationGate';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;

  // center_id is derived SERVER-SIDE from the authenticated user. It is never
  // read from a query string or a body — a tenant boundary taken from request
  // input is not a tenant boundary.
  const principal: Principal = {
    kind: auth.centerId ? 'center' : 'teacher',
    centerId: auth.centerId ?? null,
    userId: auth.userId,
  };

  const eligibility = await evaluateCollectionEligibility(auth.supabaseAdmin, principal);
  const balance = principal.centerId
    ? await getAvailableBalanceMinor(auth.supabaseAdmin, principal.centerId)
    : { availableMinor: 0, sourced: false as const, reasonKey: 'collectionPayout.balance.notSourced' };

  return NextResponse.json({
    configPoint: COLLECTION_PAYOUT_CONFIG_POINT,
    principal: { kind: principal.kind },
    canCollect: eligibility.ok,
    // Present only when the answer is no; always populated in that case.
    blocked: eligibility.ok ? null : { cause: eligibility.cause, messageKey: eligibility.messageKey, detail: eligibility.detail },
    balance: {
      availableMinor: balance.availableMinor,
      // FALSE means this zero is UNKNOWN, not EMPTY. A surface that renders the
      // number without the reason is fabricating a balance.
      sourced: balance.sourced,
      reasonKey: balance.sourced ? null : balance.reasonKey,
    },
  });
}
