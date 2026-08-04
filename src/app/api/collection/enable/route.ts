// POST /api/collection/enable
//
// A verified centre or teacher opts in to TutoringHQ collecting tuition from
// parents on their behalf.
//
// TODAY THIS ALWAYS REFUSES, with a named cause, and that is correct: the config
// point holds placeholders and identity verification has no live source. It
// returns 409 with the cause chain rather than 200 with a green tick.
//
// design/VERIFICATION-SPEC.md §3: "Only the owner can withdraw money or change
// the payout account. That cannot be delegated." Verification is what UNLOCKS
// both, and no design restricts who may perform it — as drawn, a manager could
// verify with their own National ID and thereby unlock the owner's money. This
// route resolves that the safe way: OWNER ONLY, matching Decision 1's
// "owner-only + step-up auth" for the money path.

import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';
import { validateCSRFRequest } from '@/lib/csrf';
import { enableCollection } from '@/lib/collectionPayout/enableCollection';
import { COLLECTION_PAYOUT_CONFIG_POINT } from '@/lib/collectionPayout/config';
import type { Principal } from '@/lib/collectionPayout/verificationGate';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;

  if (!validateCSRFRequest(request, auth.userId)) {
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
  }

  // Owner-only. A centre principal must be the owner; a teacher principal is
  // their own owner by construction (centre-less, linked via teacher_center).
  if (auth.centerId && auth.role !== 'owner') {
    return NextResponse.json(
      {
        ok: false,
        error: 'not_owner',
        messageKey: 'collectionPayout.enable.ownerOnly',
      },
      { status: 403 },
    );
  }

  const principal: Principal = {
    kind: auth.centerId ? 'center' : 'teacher',
    centerId: auth.centerId ?? null,
    userId: auth.userId,
  };

  const result = await enableCollection(auth.supabaseAdmin, principal);

  if (!result.ok) {
    // 409 Conflict, not 500 and not 200. The request was well-formed and the
    // caller is authorised; the SYSTEM is not ready, and the body says exactly
    // which part of it is not.
    return NextResponse.json(
      {
        ok: false,
        configPoint: COLLECTION_PAYOUT_CONFIG_POINT,
        cause: result.cause,
        messageKey: result.messageKey,
        detail: result.detail,
      },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true, enabledAt: result.enabledAt });
}
