import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdminApi } from '@/lib/admin-auth';
import { requireSuperAdminRow } from '@/lib/admin-access';
import { validateCSRFRequest } from '@/lib/csrf';
import { parseBodyWithLimit } from '@/lib/validate';
import {
  PAYOUT_APPROVAL_MIGRATION_FILE,
  PAYOUT_TRANSITION_RPC,
  httpStatusForPayoutRefusal,
  isPayoutApprovalMigrationMissing,
  isUuid,
  normalizeRejectionReason,
  parsePayoutApprovalAction,
  parsePayoutTransitionRpcResult,
} from '@/lib/payoutApproval';

/**
 * PATCH /api/admin/payout-requests/[id] — approve / reject / mark paid.
 *
 * PAYOUT-SYSTEM-SPEC.md §2.1: this is the route that did not exist. Without it
 * a referral payout request could never leave 'pending'.
 *
 * Everything that moves state happens inside ONE SECURITY DEFINER RPC,
 * `transition_payout_request` — per-centre advisory lock, `SELECT … FOR UPDATE`,
 * legal-transition check, idempotent re-call, and the `audit_log` row all in the
 * same transaction. That shape is taken directly from §2.2, where the credit
 * withdrawal route's four un-transacted round trips let two operators both pass
 * a `status !== 'pending'` check and both return `{success:true}`.
 *
 * This route deliberately has NO fallback path. If the RPC is absent because
 * the migration has not been applied, it returns 503 naming the file. A
 * best-effort UPDATE would be a second, unlocked writer of money state, which
 * is the defect, not the fix.
 *
 * Not touched here: the request-CREATION gate in /api/referrals/payout. That is
 * §2.7 and a separate change.
 */

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireSuperAdminApi(request);
  if (!auth.ok) return auth.response;

  // Second, DB-sourced super-admin check, same as the withdrawals release route.
  const row403 = await requireSuperAdminRow(auth.supabaseAdmin, auth.userId);
  if (row403) return row403;

  // `requireSuperAdminApi` accepts a cookie session as well as a bearer token,
  // which is exactly the scenario CSRF exists for — and this route releases
  // real money (§2.6 / A14). The admin client sends X-CSRF-Token via
  // getCsrfHeaders, so this validates what is already being sent.
  if (!validateCSRFRequest(request, auth.userId)) {
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
  }

  const { id: rawId } = await params;
  const payoutId = typeof rawId === 'string' ? rawId.trim() : '';
  if (!isUuid(payoutId)) {
    return NextResponse.json({ error: 'Invalid payout request id' }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const action = parsePayoutApprovalAction(body.action);
  if (!action) {
    return NextResponse.json(
      { error: 'Invalid action', code: 'invalid_action' },
      { status: 400 },
    );
  }
  const reason = normalizeRejectionReason(body.reason);

  /*
   * §7.5 / S10: release authority requires a REAL `admin_users` row. Appending a
   * phone to SUPER_ADMIN_PHONES mints a super admin with no database row at
   * all, and `requireSuperAdminRow` reads the same env var, so neither gate
   * above excludes that path. An approval by such an actor is forensically
   * anonymous — the log would name a uuid matching no row in any table.
   *
   * The RPC enforces this too and is the real guarantee (it holds the lock);
   * checking here only buys a clearer error before any work is done.
   */
  const { data: adminRow, error: adminErr } = await auth.supabaseAdmin
    .from('admin_users')
    .select('role')
    .eq('id', auth.userId)
    .maybeSingle();

  if (adminErr) {
    console.error('[admin/payout-requests PATCH] admin_users lookup', adminErr);
    return NextResponse.json({ error: 'Authorization check failed' }, { status: 500 });
  }
  if ((adminRow as { role?: string | null } | null)?.role !== 'super_admin') {
    return NextResponse.json(
      {
        error:
          'Payout approval requires a real admin_users super_admin row. A SUPER_ADMIN_PHONES-only session cannot release money.',
        code: 'forbidden_actor',
      },
      { status: 403 },
    );
  }

  const { data, error } = await auth.supabaseAdmin.rpc(PAYOUT_TRANSITION_RPC, {
    p_payout_id: payoutId,
    p_action: action,
    p_actor_id: auth.userId,
    p_reason: reason,
  });

  if (error) {
    if (isPayoutApprovalMigrationMissing(error)) {
      // Fail visibly. CI has no live database, so this cannot be caught before
      // deploy; the operator must be told exactly what is missing.
      console.error('[admin/payout-requests PATCH] migration not applied', error);
      return NextResponse.json(
        {
          error: `Payout approval is unavailable: ${PAYOUT_TRANSITION_RPC}() is not in the database. Apply ${PAYOUT_APPROVAL_MIGRATION_FILE} by hand, confirm it in the catalog, then retry. No state was changed.`,
          code: 'payout_approval_migration_not_applied',
          migration: PAYOUT_APPROVAL_MIGRATION_FILE,
        },
        { status: 503 },
      );
    }
    console.error('[admin/payout-requests PATCH] rpc', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const result = parsePayoutTransitionRpcResult(data);
  if (!result) {
    console.error('[admin/payout-requests PATCH] unparseable rpc result', data);
    return NextResponse.json(
      { error: 'Unrecognised response from the payout transition function' },
      { status: 500 },
    );
  }

  if (!result.ok) {
    return NextResponse.json(
      { error: result.code ?? 'transition_refused', code: result.code, status: result.status },
      { status: httpStatusForPayoutRefusal(result.code) },
    );
  }

  return NextResponse.json({
    success: true,
    id: result.id ?? payoutId,
    status: result.status ?? null,
    previous_status: result.previous_status ?? null,
    idempotent: result.idempotent ?? false,
  });
}
