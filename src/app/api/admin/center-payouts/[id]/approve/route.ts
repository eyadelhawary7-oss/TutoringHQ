// POST /api/admin/center-payouts/[id]/approve
//
// The approval gate for System-1 payouts. This is the route that authorises
// real money to leave, so every control in PAYOUT-SYSTEM-SPEC.md §7 applies.
//
// ── THE FIVE GATES, IN ORDER ────────────────────────────────────────────────
//
//  1. CSRF. §2.6/A14: `PATCH /api/admin/withdrawals/[id]` — the existing gate
//     that releases money — shipped with no CSRF check at all. An admin with a
//     live session who loads any page that can issue a cross-origin request was
//     one forged call away from releasing a queued withdrawal nobody approved.
//     That was fixed in d728da75; this route is built with it from the start.
//  2. A REAL admin_users ROW. §7.5/S10: appending a phone to SUPER_ADMIN_PHONES
//     mints a CEO with NO DATABASE ROW, and the supposedly independent second
//     check (`requireSuperAdminRow`) calls `isSuperAdminPhone` too — so both
//     gates read the same env var. That path is forensically anonymous: the log
//     would record an approver uuid matching no row in any table. This route
//     reads `admin_users` DIRECTLY and refuses env-phone-only authority with its
//     own named cause, so the attempt is visible rather than a generic 403.
//  3. STEP-UP AUTH. §7: reuse `verifyPasswordForSensitiveAction` — the
//     mechanism already exists and is already used for permission edits. Single-
//     signature approval makes confirming the human at the keyboard more
//     important, not less.
//  4. THE CONFIG POINT. Placeholders ⇒ refuse.
//  5. THE CAPS, re-evaluated in-transaction inside `payout_approve`, reading the
//     amount from the LOCKED ROW rather than from this request body.
//
// ── WHAT THIS ROUTE NEVER DOES ──────────────────────────────────────────────
//
// It never takes an amount, a destination, an approver identity or a cap from
// the request body. All five come from server state. §7.4 non-negotiable.

import { NextRequest, NextResponse } from 'next/server';
import { requireInternalAdminApi } from '@/lib/admin-auth';
import { validateCSRFRequest } from '@/lib/csrf';
import { parseBodyWithLimit } from '@/lib/validate';
import { fetchAdminPermissionKeys } from '@/lib/adminPermissionsStore';
import { isSuperAdminPhone } from '@/lib/admin-access';
import { verifyPasswordForSensitiveAction } from '@/lib/verify-password';
import { approvePayout } from '@/lib/collectionPayout/payoutEngine';
import { COLLECTION_PAYOUT_CONFIG_POINT } from '@/lib/collectionPayout/config';
import type { ApproverFacts } from '@/lib/collectionPayout/payoutCaps';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireInternalAdminApi(request);
  if (!auth.ok) return auth.response;

  if (!validateCSRFRequest(request, auth.userId)) {
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
  }

  const { id: payoutId } = await params;

  let body: { pin?: string; isResend?: boolean; idempotencyKey?: string };
  try {
    body = (await parseBodyWithLimit(request, 65536)) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Gate 2 — a REAL admin_users row. Read directly; do not infer from the JWT.
  const { data: adminRow } = await auth.supabaseAdmin
    .from('admin_users')
    .select('id, role, phone')
    .eq('id', auth.userId)
    .maybeSingle();

  const admin = adminRow as { id: string; role: string | null; phone: string | null } | null;
  const permissionKeys = admin
    ? await fetchAdminPermissionKeys(auth.supabaseAdmin, admin.id)
    : [];

  const approver: ApproverFacts = {
    adminUserId: admin?.id ?? null,
    adminRole: admin?.role ?? null,
    permissionKeys,
    // Passed in explicitly so the refusal is NAMED rather than the caller
    // quietly not asking. `resolveApproverTier` refuses this path.
    envPhoneSuperAdmin: isSuperAdminPhone(admin?.phone ?? null),
  };

  // Gate 3 — step-up auth. Verified BEFORE the engine so a bad PIN never
  // reaches the money path.
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
    stepUpVerified = stepUp.ok;
    if (!stepUp.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: 'step_up_auth_failed',
          messageKey: 'collectionPayout.approver.stepUpFailed',
          detail: stepUp.error,
        },
        { status: 403 },
      );
    }
  }

  // The idempotency key is caller-supplied and stable across retries of the
  // SAME logical approval. §6: the payout provider offers NO idempotency key of
  // any kind, so ours is the only dedup that exists in the whole path.
  const idempotencyKey =
    typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim().length >= 8
      ? body.idempotencyKey.trim()
      : `approve:${payoutId}`;

  const result = await approvePayout(auth.supabaseAdmin, {
    payoutId,
    approver,
    stepUpVerified,
    isResend: body.isResend === true,
    idempotencyKey,
  });

  if (!result.ok) {
    const status =
      result.cause === 'approver_refused' || result.cause === 'step_up_auth_required'
        ? 403
        : result.cause === 'cap_refused'
          ? 422
          : 409;
    return NextResponse.json(
      {
        ok: false,
        configPoint: COLLECTION_PAYOUT_CONFIG_POINT,
        cause: result.cause,
        messageKey: result.messageKey,
        detail: result.detail,
        // §7.5: there is no substitute path. Say so rather than leaving the
        // operator to look for one.
        escalation: 'ceo_only',
        escalationKey: 'collectionPayout.payout.noFallbackApprover',
      },
      { status },
    );
  }

  return NextResponse.json({
    ok: true,
    payoutId: result.payoutId,
    state: result.state,
    tier: result.tier,
    authoritySource: result.authoritySource,
    amountComparedMinor: result.amountComparedMinor,
    capInForceMinor: result.capInForceMinor,
  });
}
