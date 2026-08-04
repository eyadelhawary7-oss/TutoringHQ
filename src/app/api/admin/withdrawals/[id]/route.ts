import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireSuperAdminApi } from '@/lib/admin-auth';
import { requireSuperAdminRow } from '@/lib/admin-access';
import { sendWithdrawalProcessed } from '@/lib/centerNotify';
import { formatNumber } from '@/lib/formatNumber';
import { ownerContactByCenterId, resolveOwnerWaPhone } from '@/lib/ownerPhone';
import { parseBodyWithLimit } from '@/lib/validate';
import { validateCSRFRequest } from '@/lib/csrf';
import {
  WITHDRAWAL_PROCESS_RPC,
  WithdrawalRpcContractError,
  interpretWithdrawalRpcResult,
  isMissingWithdrawalRpc,
  isWithdrawalAction,
  shouldNotifyOwner,
  whatsappAmount,
  whatsappDecisionWord,
  withdrawalHttpResult,
} from '@/lib/withdrawalProcessing';

const WA_AR = 'ar';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireSuperAdminApi(request);
  if (!auth.ok) return auth.response;
  const row403 = await requireSuperAdminRow(auth.supabaseAdmin, auth.userId);
  if (row403) return row403;
  // super_admin only; can_approve_signups does not apply.
  // PAYOUT-SYSTEM-SPEC.md §2.6 — the serious one. This is the gate that
  // RELEASES real money, and it had no CSRF check. `requireSuperAdminApi`
  // accepts a cookie session as well as a bearer token, which is exactly the
  // scenario CSRF protection exists for. The admin/withdrawals client already
  // sends X-CSRF-Token / X-Session-ID via getAuthHeaders, so this validates
  // what is already being sent rather than breaking the UI.
  if (!validateCSRFRequest(request, auth.userId)) {
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
  }

  const { id: withdrawalId } = await params;

  let body: { action?: string; notes?: string };
  try {
    body = (await parseBodyWithLimit(request, 65536)) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const action = body.action;
  if (!isWithdrawalAction(action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

  const notes =
    typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;

  // ==========================================================================
  // PAYOUT-SYSTEM-SPEC.md §2.2 — the whole state change is ONE transaction.
  //
  // What used to be here: a non-locking .select, a `status !== 'pending'`
  // check in JavaScript, cancel_reservation_atomic, spend_credits_atomic, and
  // an .update({status:'paid'}) — five separate round trips, no transaction.
  // Two admins on the queue, or one double-click, both passed the JS check,
  // both spent, both returned {success:true} and both fired the WhatsApp,
  // because a zero-row PostgREST UPDATE is not an error. And if
  // spend_credits_atomic raised after cancel_reservation_atomic had already
  // committed, the centre's balance came back and was immediately
  // re-withdrawable with the cash already gone.
  //
  // The RPC does SELECT ... FOR UPDATE, releases, spends, flips the status and
  // writes audit_log in one transaction, and tells us via `outcome` whether
  // WE are the caller that performed the transition.
  //
  // THERE IS NO FALLBACK TO THE OLD PATH, DELIBERATELY. The RPC ships in
  // supabase/migrations/20260804160000_withdrawal_process_atomic_rpc.sql,
  // which is NOT APPLIED — Eyad applies it by hand (CLAUDE.md rule 5). Until
  // it is applied this route returns 500 `withdrawal_rpc_missing` and moves
  // no money. Falling back to the racy path on a missing RPC would silently
  // re-open the exact defect this closes, so it fails loudly instead.
  // ==========================================================================
  const { data: rpcData, error: rpcError } = await auth.supabaseAdmin.rpc(
    WITHDRAWAL_PROCESS_RPC,
    {
      p_withdrawal_id: withdrawalId,
      p_action: action,
      p_actor_id: auth.userId,
      p_notes: notes,
    },
  );

  if (rpcError) {
    if (isMissingWithdrawalRpc(rpcError)) {
      console.error(
        `[admin/withdrawals] ${WITHDRAWAL_PROCESS_RPC} is absent from the database. ` +
          'The §2.2 migration (supabase/migrations/20260804160000_withdrawal_process_atomic_rpc.sql) ' +
          'has not been applied. Refusing to process this withdrawal — there is no safe non-transactional path.',
        rpcError,
      );
      return NextResponse.json(
        {
          error:
            'Withdrawal processing is unavailable: the atomic approval function is not installed on the database.',
          cause: 'withdrawal_rpc_missing',
        },
        { status: 500 },
      );
    }
    // Anything else is one of two things, and from here we CANNOT tell which:
    //   * A Postgres-raised error — a RAISE inside the function, a constraint,
    //     'Insufficient credits', a deadlock. The transaction rolled back:
    //     reservation still reserved, no credits spent, status still pending.
    //   * A transport failure — dropped connection, gateway or statement
    //     timeout — which supabase-js surfaces in this SAME `rpcError` field.
    //     That can happen AFTER the server committed, in which case the
    //     credits ARE spent and the status IS 'paid'/'rejected' despite this
    //     500. Do not read this log line as proof that nothing moved.
    // Retrying is safe either way, because the RPC is idempotent: a retry
    // against a row that did commit returns `already_applied`, moves no money
    // and sends no WhatsApp. Note the corollary — on a committed-but-
    // unreported call the owner is never notified, by this call or the retry,
    // so check the row's status before assuming they were told.
    console.error(`[admin/withdrawals] ${WITHDRAWAL_PROCESS_RPC}`, rpcError);
    return NextResponse.json(
      { error: rpcError.message, cause: 'withdrawal_rpc_failed' },
      { status: 500 },
    );
  }

  let result;
  try {
    result = interpretWithdrawalRpcResult(rpcData);
  } catch (e) {
    if (e instanceof WithdrawalRpcContractError) {
      console.error('[admin/withdrawals] RPC contract mismatch:', e.message, rpcData);
      return NextResponse.json(
        { error: e.message, cause: 'withdrawal_rpc_contract_mismatch' },
        { status: 500 },
      );
    }
    throw e;
  }

  const http = withdrawalHttpResult(result);

  // The transaction has committed by the time we are here. Notify exactly
  // once, and only for the caller that actually performed the transition —
  // the loser of a double-click gets `already_applied` and stays silent.
  if (shouldNotifyOwner(result.outcome) && result.centerId) {
    await notifyOwner(auth.supabaseAdmin, result.centerId, action, {
      cashAmount: result.cashAmount,
      creditsDeducted: result.creditsDeducted,
      instapayNumber: result.instapayNumber,
      notes: result.notes,
    });
  }

  return NextResponse.json(http.body, { status: http.httpStatus });
}

async function notifyOwner(
  supabaseAdmin: SupabaseClient,
  centerId: string,
  action: 'mark_paid' | 'reject',
  details: {
    cashAmount: number;
    creditsDeducted: number;
    instapayNumber: string;
    notes: string | null;
  },
): Promise<void> {
  try {
    const { data: center } = await supabaseAdmin
      .from('centers')
      .select('phone, owner_name, name')
      .eq('id', centerId)
      .maybeSingle();

    const cRow = center as {
      phone?: string | null;
      owner_name?: string | null;
      name?: string | null;
    } | null;

    const ownerMap = await ownerContactByCenterId(supabaseAdmin, [centerId]);
    const oc = ownerMap.get(centerId);
    const ownerPhone = await resolveOwnerWaPhone(
      supabaseAdmin,
      oc?.authId ?? null,
      oc?.userPhone,
      cRow?.phone,
    );
    if (!ownerPhone) return;

    const ownerName = (cRow?.owner_name ?? '').trim() || (cRow?.name ?? '').trim() || ',';
    const fallbackNote =
      action === 'mark_paid'
        ? `إنستاباي: ${details.instapayNumber || ','}`
        : `${formatNumber(details.creditsDeducted, WA_AR)} نقطة أُعيدت للرصيد`;

    await sendWithdrawalProcessed(
      ownerPhone,
      ownerName,
      whatsappDecisionWord(action),
      whatsappAmount(action, details),
      details.notes ?? fallbackNote,
    );
  } catch (e) {
    // The money has already moved and committed. A WhatsApp failure must not
    // turn a successful transition into an error response.
    console.error(`[admin/withdrawals] ${action} WA:`, e);
  }
}
