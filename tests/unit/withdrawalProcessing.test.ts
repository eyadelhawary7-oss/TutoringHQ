import { describe, expect, it } from 'vitest';
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

// PAYOUT-SYSTEM-SPEC.md §2.2. These tests pin the half of the fix that lives
// in TypeScript: who is allowed to send the WhatsApp, what HTTP status a
// non-transition maps to, and that a missing RPC is detected rather than
// silently falling back to the racy path.

const transitionedPaid = {
  outcome: 'transitioned',
  status: 'paid',
  center_id: '11111111-1111-1111-1111-111111111111',
  credits_deducted: 4000,
  cash_amount: 2000,
  instapay_number: '01000000000',
  notes: null,
};

describe('isWithdrawalAction', () => {
  it('accepts the two real actions', () => {
    expect(isWithdrawalAction('mark_paid')).toBe(true);
    expect(isWithdrawalAction('reject')).toBe(true);
  });

  it('rejects anything else, including near misses and non-strings', () => {
    for (const bad of ['paid', 'MARK_PAID', '', null, undefined, 1, {}]) {
      expect(isWithdrawalAction(bad)).toBe(false);
    }
  });
});

describe('interpretWithdrawalRpcResult', () => {
  it('parses a successful transition', () => {
    const r = interpretWithdrawalRpcResult(transitionedPaid);
    expect(r.outcome).toBe('transitioned');
    expect(r.status).toBe('paid');
    expect(r.centerId).toBe('11111111-1111-1111-1111-111111111111');
    expect(r.creditsDeducted).toBe(4000);
    expect(r.cashAmount).toBe(2000);
    expect(r.instapayNumber).toBe('01000000000');
    expect(r.notes).toBeNull();
  });

  it('coerces numerics arriving as strings (postgres numeric over the wire)', () => {
    const r = interpretWithdrawalRpcResult({
      ...transitionedPaid,
      credits_deducted: '4000.00',
      cash_amount: '2000.00',
    });
    expect(r.creditsDeducted).toBe(4000);
    expect(r.cashAmount).toBe(2000);
  });

  it('parses not_found, which carries no money fields', () => {
    const r = interpretWithdrawalRpcResult({ outcome: 'not_found' });
    expect(r.outcome).toBe('not_found');
    expect(r.status).toBeNull();
    expect(r.centerId).toBeNull();
    expect(r.creditsDeducted).toBe(0);
  });

  it('throws rather than defaulting when outcome is unknown', () => {
    // A silently-defaulted outcome would be a double-send. Fail loudly.
    expect(() => interpretWithdrawalRpcResult({ outcome: 'ok' })).toThrow(
      WithdrawalRpcContractError,
    );
    expect(() => interpretWithdrawalRpcResult({ status: 'paid' })).toThrow(
      WithdrawalRpcContractError,
    );
  });

  it('throws on null, arrays and scalars', () => {
    for (const bad of [null, undefined, [], 'transitioned', 42, true]) {
      expect(() => interpretWithdrawalRpcResult(bad)).toThrow(WithdrawalRpcContractError);
    }
  });
});

describe('shouldNotifyOwner — the double-WhatsApp fix', () => {
  it('notifies only the caller that performed the transition', () => {
    expect(shouldNotifyOwner('transitioned')).toBe(true);
  });

  it('stays silent for the loser of a double-click', () => {
    // Before the fix both callers returned {success:true} and both sent the
    // WhatsApp, because a zero-row PostgREST UPDATE is not an error.
    expect(shouldNotifyOwner('already_applied')).toBe(false);
  });

  it('stays silent on conflict and not_found', () => {
    expect(shouldNotifyOwner('conflict')).toBe(false);
    expect(shouldNotifyOwner('not_found')).toBe(false);
  });
});

describe('withdrawalHttpResult', () => {
  it('200 applied:true for a real transition', () => {
    const h = withdrawalHttpResult(interpretWithdrawalRpcResult(transitionedPaid));
    expect(h.httpStatus).toBe(200);
    expect(h.body).toMatchObject({ success: true, applied: true, status: 'paid' });
  });

  it('200 applied:false for an idempotent re-call — the work is already done', () => {
    const h = withdrawalHttpResult(
      interpretWithdrawalRpcResult({ ...transitionedPaid, outcome: 'already_applied' }),
    );
    expect(h.httpStatus).toBe(200);
    expect(h.body).toMatchObject({
      success: true,
      applied: false,
      status: 'paid',
      reason: 'already_processed',
    });
  });

  it('409 when the row is terminal in the other status', () => {
    const h = withdrawalHttpResult(
      interpretWithdrawalRpcResult({
        ...transitionedPaid,
        outcome: 'conflict',
        status: 'rejected',
      }),
    );
    expect(h.httpStatus).toBe(409);
    expect(h.body).toMatchObject({ applied: false, status: 'rejected' });
    expect(h.body.success).toBeUndefined();
  });

  it('404 when the withdrawal does not exist', () => {
    const h = withdrawalHttpResult(interpretWithdrawalRpcResult({ outcome: 'not_found' }));
    expect(h.httpStatus).toBe(404);
    expect(h.body).toMatchObject({ error: 'Withdrawal not found' });
  });

  it('never reports applied:true for anything but a transition', () => {
    for (const outcome of ['already_applied', 'conflict', 'not_found'] as const) {
      const h = withdrawalHttpResult(
        interpretWithdrawalRpcResult({ ...transitionedPaid, outcome }),
      );
      expect(h.body.applied).not.toBe(true);
    }
  });
});

describe('isMissingWithdrawalRpc — fail visibly, never fall back', () => {
  it('detects the PostgREST schema-cache miss', () => {
    expect(
      isMissingWithdrawalRpc({
        code: 'PGRST202',
        message: `Could not find the function public.${WITHDRAWAL_PROCESS_RPC}(p_action, p_actor_id, p_notes, p_withdrawal_id) in the schema cache`,
      }),
    ).toBe(true);
  });

  it('detects the raw postgres undefined_function code', () => {
    expect(
      isMissingWithdrawalRpc({
        code: '42883',
        message: 'function public.process_withdrawal_request(uuid, text, uuid, text) does not exist',
      }),
    ).toBe(true);
  });

  it('detects a message-only variant naming the function', () => {
    expect(
      isMissingWithdrawalRpc({
        message: `Could not find the function public.${WITHDRAWAL_PROCESS_RPC} in the schema cache`,
      }),
    ).toBe(true);
  });

  it('does NOT treat a business failure as a missing migration', () => {
    // spend_credits_atomic raises this. It must produce a plain 500 that says
    // the transaction rolled back, not "the migration is missing".
    expect(
      isMissingWithdrawalRpc({ code: 'P0001', message: 'Insufficient credits' }),
    ).toBe(false);
    expect(
      isMissingWithdrawalRpc({
        code: '23505',
        message: 'duplicate key value violates unique constraint "one_pending_withdrawal_per_center"',
      }),
    ).toBe(false);
    expect(isMissingWithdrawalRpc({ code: '40001', message: 'serialization failure' })).toBe(
      false,
    );
  });

  it('does not fire on an unrelated missing function', () => {
    expect(
      isMissingWithdrawalRpc({
        code: 'PGRST203',
        message: 'Could not choose the best candidate function between: public.some_other_fn',
      }),
    ).toBe(false);
  });

  it('is safe on null, strings and empty objects', () => {
    expect(isMissingWithdrawalRpc(null)).toBe(false);
    expect(isMissingWithdrawalRpc(undefined)).toBe(false);
    expect(isMissingWithdrawalRpc('PGRST202')).toBe(false);
    expect(isMissingWithdrawalRpc({})).toBe(false);
  });
});

describe('WhatsApp payload — unchanged from the pre-fix behaviour', () => {
  it('sends the Arabic decision word', () => {
    expect(whatsappDecisionWord('mark_paid')).toBe('قبول');
    expect(whatsappDecisionWord('reject')).toBe('رفض');
  });

  it('approval quotes the cash received, rejection quotes credits returned', () => {
    const details = { cashAmount: 2000, creditsDeducted: 4000 };
    expect(whatsappAmount('mark_paid', details)).toBe(2000);
    expect(whatsappAmount('reject', details)).toBe(4000);
  });
});
