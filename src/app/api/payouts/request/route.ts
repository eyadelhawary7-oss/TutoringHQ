// POST /api/payouts/request
//
// ██ THE FRONT DOOR of payout System 1. The route that CREATES a payout. ██
//
// ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
//
// Without it there is no way to create a payout request from anywhere in the
// application. `createPayoutRequest` had zero callers; `/api/admin/center-
// payouts` exports GET only; `payout_request_create` was referenced in exactly
// one file — its own module. The approve and release endpoints were built, gated
// and tested against a queue that could never receive an entry. See the header
// of src/lib/collectionPayout/requestPayout.ts for the full account.
//
// ── WHY IT IS *NOT* UNDER /api/admin ─────────────────────────────────────────
//
// PAYOUT-SYSTEM-SPEC.md §7.1, as a spec invariant: "request authority is
// center-side, release authority is platform-side, and they live in different
// tables so that no single grant path can produce both." An `/api/admin/*` POST
// would be reachable only by `admin_users` — the approver domain — and would
// therefore let one identity both request and approve. The two ends of this
// pipeline are deliberately on opposite sides of that line.
//
// ── THE GATES, IN ORDER ──────────────────────────────────────────────────────
//
//  1. CENTRE SESSION. `requireCenterAuth` resolves `center_id` from the
//     authenticated user. It is NEVER read from the body. §7.4.
//  2. CSRF. §2.6: none of the three live money-movement routes validates CSRF —
//     including `PATCH /api/admin/withdrawals/[id]`, the gate that releases
//     money. This route is built with it from the start.
//  3. OWNER ONLY. Decision 1 and §2.7: the two live initiating routes disagree
//     (owner-only vs. a delegable permission true on ONE row in the database),
//     and unifying on the weaker one would hand payout initiation to staff
//     accounts at centres that are owner-only today, with no announcement.
//  4. BODY VALIDATION. Amount in piastres, source from a closed allow-list.
//     The RAIL is not accepted from the body at all — §3 invariant 5, attack A6.
//  5. THE ENGINE GATES — config point, verification, destination, balance, then
//     step-up auth, then the single transaction. src/lib/collectionPayout/
//     requestPayout.ts owns that order and the reasons for it.
//
// ── WHAT IT DOES TODAY ───────────────────────────────────────────────────────
//
// It refuses, with 409 and the named cause `collection_payout_not_configured`,
// on every deployment — the config point holds placeholders. There is no input
// that makes it return `ok: true`. That is the correct behaviour and it is
// asserted in tests/unit/payoutRequestFrontDoor.test.ts, which fails if this
// route ever starts claiming success while the config point is unfilled.

import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';
import { validateCSRFRequest } from '@/lib/csrf';
import { parseBodyWithLimit } from '@/lib/validate';
import { verifyPasswordForSensitiveAction } from '@/lib/verify-password';
import { COLLECTION_PAYOUT_CONFIG_POINT } from '@/lib/collectionPayout/config';
import {
  isPayoutSource,
  statusForRequestRefusal,
  submitPayoutRequest,
  validateAmountMinor,
  PAYOUT_SOURCES,
} from '@/lib/collectionPayout/requestPayout';
import type { Principal } from '@/lib/collectionPayout/verificationGate';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  // Gate 1 — a centre session. 401 when absent; `centerId` comes from here.
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;

  // Gate 2 — CSRF. Fails closed when CSRF_SECRET is unset.
  if (!validateCSRFRequest(request, auth.userId)) {
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
  }

  // Gate 3 — owner only, and not delegable.
  //
  // `isSuperAdmin` is NOT an alternative here. A super-admin acting as a centre
  // is the approver domain reaching into the payee domain, which is the exact
  // collapse §7.1 forbids; if a platform operator needs to raise a payout for a
  // centre, that is an operations action with its own audit trail, not this.
  if (auth.role !== 'owner') {
    return NextResponse.json(
      {
        ok: false,
        cause: 'not_owner',
        messageKey: 'collectionPayout.request.ownerOnly',
        detail: {
          note: 'PAYOUT-SYSTEM-SPEC.md Decision 1 unifies payout initiation on owner-only. can_request_referral_payouts is deliberately not consulted.',
        },
      },
      { status: 403 },
    );
  }

  // Gate 4 — the body.
  let body: {
    amountMinor?: unknown;
    source?: unknown;
    pin?: unknown;
    idempotencyKey?: unknown;
  };
  try {
    body = (await parseBodyWithLimit(request, 65536)) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const amount = validateAmountMinor(body.amountMinor);
  if (!amount.ok) {
    return NextResponse.json(amount, { status: statusForRequestRefusal(amount.cause) });
  }

  if (!isPayoutSource(body.source)) {
    return NextResponse.json(
      {
        ok: false,
        cause: 'payout_request_invalid',
        messageKey: 'collectionPayout.request.sourceInvalid',
        detail: { field: 'source', allowed: PAYOUT_SOURCES, received: body.source },
      },
      { status: 400 },
    );
  }

  // Step-up auth, HTTP half. A WRONG pin is a 403 right here and never reaches
  // the money path. A MISSING pin is carried through as `stepUpVerified: false`
  // so that the engine's deployment-level refusals are reported FIRST — an owner
  // must not be asked to confirm a PIN for an action that cannot succeed for a
  // reason they are powerless to change.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const accessToken = (request.headers.get('Authorization') ?? '')
    .replace(/^Bearer\s+/i, '')
    .trim();

  let stepUpVerified = false;
  if (supabaseUrl && supabaseAnonKey && accessToken && typeof body.pin === 'string') {
    const stepUp = await verifyPasswordForSensitiveAction(
      supabaseUrl,
      supabaseAnonKey,
      accessToken,
      body.pin,
    );
    if (!stepUp.ok) {
      return NextResponse.json(
        {
          ok: false,
          cause: 'step_up_auth_failed',
          messageKey: 'collectionPayout.request.stepUpFailed',
          detail: { error: stepUp.error },
        },
        { status: 403 },
      );
    }
    stepUpVerified = true;
  }

  const principal: Principal = {
    kind: 'center',
    centerId: auth.centerId,
    userId: auth.userId,
  };

  // The idempotency key is the ONLY deduplication in the whole path — §6: the
  // payout provider offers no idempotency key of any kind. A caller-supplied key
  // is honoured when it is long enough to be meaningful; otherwise one is
  // derived from the centre, source and amount so that a double-click on the
  // same request cannot open two payouts. It deliberately does NOT include a
  // timestamp, which would defeat the purpose.
  const suppliedKey =
    typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim().length >= 8
      ? body.idempotencyKey.trim()
      : null;
  const idempotencyKey =
    suppliedKey ?? `payout-request:${auth.centerId}:${body.source}:${amount.amountMinor}`;

  const result = await submitPayoutRequest(auth.supabaseAdmin, {
    principal,
    amountMinor: amount.amountMinor,
    source: body.source,
    stepUpVerified,
    idempotencyKey,
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        configPoint: COLLECTION_PAYOUT_CONFIG_POINT,
        cause: result.cause,
        messageKey: result.messageKey,
        detail: result.detail,
      },
      { status: statusForRequestRefusal(result.cause) },
    );
  }

  // §7.5: an unpaid queue must never look like a paid one. The response carries
  // the honest waiting state from the moment the request exists, and says
  // plainly that nothing has been sent.
  return NextResponse.json({
    ok: true,
    payoutId: result.payoutId,
    state: result.state,
    waiting: result.waiting,
    messageKey: 'collectionPayout.payout.awaitingApproval',
  });
}
