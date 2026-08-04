// POST /api/admin/center-payouts/[id]/release
//
// Move an APPROVED payout onto the rail.
//
// ── THIS CANNOT SUCCEED TODAY, AND MUST NOT PRETEND TO ──────────────────────
//
// Two independent blocks, both real:
//   1. THE CONFIG POINT holds placeholders. There are no Paymob Payouts
//      credentials — onboarding is manual on Paymob's side and has not started
//      (PAYOUT-SYSTEM-SPEC.md §8: "There are no self-signup steps. Your account
//      is provisioned by Paymob.").
//   2. THE LEDGER IS NOT MIGRATED. `center_payouts` does not exist in the live
//      catalog.
//
// So this route returns 409 with the cause chain. It never returns 200, it
// never writes a 'paid' status, and it never fires a "payout processed"
// notification. A green checkmark backed by no integration is the worst
// possible outcome of this work.
//
// ── WHAT MUST STILL HOLD WHEN THE CREDENTIALS ARRIVE (§6) ───────────────────
//
//   - A timeout or error leaves the payout `indeterminate`, and it is NEVER
//     auto-retried. Paymob provides NO idempotency key of any kind — verified
//     exhaustively across 12 portal pages, 29 GitBook pages, the live
//     swagger.json and the official Postman collection. `client_reference_id`
//     is documented as "generated UUID by the client to be saved as reference
//     in case of timeouts" — a RECONCILIATION AID, NOT A DEDUP KEY. A retried
//     /disburse/ is processed as an entirely independent transaction with a
//     fresh transaction_id.
//   - A resend requires POSITIVE evidence of absence: a successful HTTP 200
//     inquiry for that specific reference, issued with the `bank_transactions`
//     flag BOTH true and false (Paymob's own docs classify `bank_wallet` both
//     ways), and only when BOTH return zero. Attack A4.
//   - An unrecognised response code is NEVER terminal. Budget exhaustion is an
//     HTTP 200 with status_code "400", distinguishable from a generic
//     validation error ONLY by substring-matching English prose containing a
//     typo ("exceeds you budget limit"). If Paymob fixes the typo, a
//     prose-matching implementation marks a whole batch permanently failed.
//     Attack A7. Detect budget exhaustion structurally, from /budget/inquire/.
//   - Authority is re-evaluated at this transition, inside `payout_transition`.
//     §7.3 item 2: revocation does not otherwise reach an already-approved
//     payout, and a manager's eight 9,500 approvals would all pay two days
//     after the CEO revoked believing the exposure was closed.

import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdminApi } from '@/lib/admin-auth';
import { validateCSRFRequest } from '@/lib/csrf';
import { parseBodyWithLimit } from '@/lib/validate';
import { releasePayout } from '@/lib/collectionPayout/payoutEngine';
import { COLLECTION_PAYOUT_CONFIG_POINT } from '@/lib/collectionPayout/config';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Release is CEO-only. A delegated approver may approve below the cap; they
  // may never put money on the wire.
  const auth = await requireSuperAdminApi(request);
  if (!auth.ok) return auth.response;

  if (!validateCSRFRequest(request, auth.userId)) {
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
  }

  // A real admin_users row with role super_admin. NOT env-phone. §7.5 / S10.
  const { data: adminRow } = await auth.supabaseAdmin
    .from('admin_users')
    .select('id, role')
    .eq('id', auth.userId)
    .maybeSingle();
  const admin = adminRow as { id: string; role: string | null } | null;
  if (!admin || admin.role !== 'super_admin') {
    return NextResponse.json(
      {
        ok: false,
        error: 'approver_refused',
        cause: 'env_phone_authority_refused',
        messageKey: 'collectionPayout.approver.envPhoneRefused',
        detail:
          'Releasing a payout requires a real admin_users row with role super_admin. SUPER_ADMIN_PHONES alone is refused (PAYOUT-SYSTEM-SPEC.md §7.5, logged as S10).',
      },
      { status: 403 },
    );
  }

  const { id: payoutId } = await params;

  let body: { idempotencyKey?: string };
  try {
    body = (await parseBodyWithLimit(request, 65536)) as typeof body;
  } catch {
    body = {};
  }

  const result = await releasePayout(auth.supabaseAdmin, {
    payoutId,
    releasedByAdminUserId: admin.id,
    idempotencyKey:
      typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim().length >= 8
        ? body.idempotencyKey.trim()
        : `release:${payoutId}`,
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        configPoint: COLLECTION_PAYOUT_CONFIG_POINT,
        cause: result.cause,
        messageKey: result.messageKey,
        detail: result.detail,
        released: false,
      },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true, payoutId: result.payoutId, state: result.state });
}
