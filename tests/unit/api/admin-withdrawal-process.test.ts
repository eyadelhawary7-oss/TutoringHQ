import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// PAYOUT-SYSTEM-SPEC.md §2.2 at the route level. What is asserted here:
//   * the route makes ONE call, to process_withdrawal_request, and no longer
//     calls cancel_reservation_atomic / spend_credits_atomic itself;
//   * the loser of a double-click gets 200 applied:false and sends NO WhatsApp;
//   * a missing RPC is a visible 500 with cause `withdrawal_rpc_missing` and
//     moves nothing — there is no fallback to the old racy path;
//   * an RPC failure (the rolled-back transaction) is a 500, not a success.

const WITHDRAWAL_ID = '77777777-7777-4777-8777-777777777777';
const CENTER_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';

type RpcResult = { data: unknown; error: { message: string; code?: string } | null };

const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
let rpcResponse: RpcResult = { data: null, error: null };

const mockRpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
  rpcCalls.push({ fn, args });
  return rpcResponse;
});

const fakeAdmin = {
  rpc: mockRpc,
  from: (table: string) => {
    const builder = {
      eq: () => builder,
      maybeSingle: async () =>
        table === 'centers'
          ? { data: { phone: '+201000000000', owner_name: 'أحمد', name: 'سنتر' }, error: null }
          : { data: null, error: null },
    };
    return { select: () => builder };
  },
};

vi.mock('@/lib/admin-auth', () => ({
  requireSuperAdminApi: vi.fn(async () => ({
    ok: true,
    supabaseAdmin: fakeAdmin,
    userId: ACTOR_ID,
  })),
}));

vi.mock('@/lib/admin-access', () => ({
  requireSuperAdminRow: vi.fn(async () => null),
}));

const mockValidateCSRF = vi.fn(() => true);
vi.mock('@/lib/csrf', () => ({
  validateCSRFRequest: (...a: unknown[]) => mockValidateCSRF(...(a as [])),
}));

const mockSendWithdrawalProcessed = vi.fn(async () => true);
vi.mock('@/lib/centerNotify', () => ({
  sendWithdrawalProcessed: (...a: unknown[]) => mockSendWithdrawalProcessed(...(a as [])),
}));

vi.mock('@/lib/ownerPhone', () => ({
  ownerContactByCenterId: vi.fn(
    async () => new Map([[CENTER_ID, { authId: null, userPhone: '+201000000000' }]]),
  ),
  resolveOwnerWaPhone: vi.fn(async () => '+201000000000'),
}));

import { PATCH } from '@/app/api/admin/withdrawals/[id]/route';

function req(body: unknown): NextRequest {
  return new Request('https://tutoringhq.app/api/admin/withdrawals/x', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

const params = Promise.resolve({ id: WITHDRAWAL_ID });

function call(body: unknown) {
  return PATCH(req(body), { params });
}

beforeEach(() => {
  rpcCalls.length = 0;
  rpcResponse = { data: null, error: null };
  mockRpc.mockClear();
  mockValidateCSRF.mockClear();
  mockValidateCSRF.mockReturnValue(true);
  mockSendWithdrawalProcessed.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

const paidTransition = {
  outcome: 'transitioned',
  status: 'paid',
  center_id: CENTER_ID,
  credits_deducted: 4000,
  cash_amount: 2000,
  instapay_number: '01000000000',
  notes: null,
};

describe('PATCH /api/admin/withdrawals/[id] — one transaction, one notification', () => {
  it('makes exactly one RPC call, and it is the atomic one', async () => {
    rpcResponse = { data: paidTransition, error: null };
    const res = await call({ action: 'mark_paid' });

    expect(res.status).toBe(200);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe('process_withdrawal_request');
    expect(rpcCalls[0].args).toEqual({
      p_withdrawal_id: WITHDRAWAL_ID,
      p_action: 'mark_paid',
      p_actor_id: ACTOR_ID,
      p_notes: null,
    });
    // The old racy pair must be gone from this route entirely.
    expect(rpcCalls.map((c) => c.fn)).not.toContain('cancel_reservation_atomic');
    expect(rpcCalls.map((c) => c.fn)).not.toContain('spend_credits_atomic');
  });

  it('derives the actor server-side — never from the request body', async () => {
    rpcResponse = { data: paidTransition, error: null };
    await call({ action: 'mark_paid', center_id: 'attacker', p_actor_id: 'attacker' });
    expect(rpcCalls[0].args.p_actor_id).toBe(ACTOR_ID);
  });

  it('sends the WhatsApp exactly once for the caller that transitioned', async () => {
    rpcResponse = { data: paidTransition, error: null };
    await call({ action: 'mark_paid' });
    expect(mockSendWithdrawalProcessed).toHaveBeenCalledTimes(1);
    const [, , decision, amount] = mockSendWithdrawalProcessed.mock.calls[0] as unknown as [
      string,
      string,
      string,
      number,
      string,
    ];
    expect(decision).toBe('قبول');
    // Approval quotes the cash received, not the credits burned.
    expect(amount).toBe(2000);
  });

  it('THE DEFECT: the second concurrent caller sends NO WhatsApp and reports applied:false', async () => {
    rpcResponse = {
      data: { ...paidTransition, outcome: 'already_applied' },
      error: null,
    };
    const res = await call({ action: 'mark_paid' });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true,
      applied: false,
      status: 'paid',
      reason: 'already_processed',
    });
    expect(mockSendWithdrawalProcessed).not.toHaveBeenCalled();
  });

  it('409 and no WhatsApp when asked to pay something already rejected', async () => {
    rpcResponse = {
      data: { ...paidTransition, outcome: 'conflict', status: 'rejected' },
      error: null,
    };
    const res = await call({ action: 'mark_paid' });
    expect(res.status).toBe(409);
    expect(mockSendWithdrawalProcessed).not.toHaveBeenCalled();
  });

  it('404 and no WhatsApp when the withdrawal does not exist', async () => {
    rpcResponse = { data: { outcome: 'not_found' }, error: null };
    const res = await call({ action: 'mark_paid' });
    expect(res.status).toBe(404);
    expect(mockSendWithdrawalProcessed).not.toHaveBeenCalled();
  });

  it('reject quotes the credits returned, in Arabic', async () => {
    rpcResponse = {
      data: { ...paidTransition, outcome: 'transitioned', status: 'rejected' },
      error: null,
    };
    await call({ action: 'reject' });
    expect(rpcCalls[0].args.p_action).toBe('reject');
    const [, , decision, amount] = mockSendWithdrawalProcessed.mock.calls[0] as unknown as [
      string,
      string,
      string,
      number,
      string,
    ];
    expect(decision).toBe('رفض');
    expect(amount).toBe(4000);
  });

  it('passes a trimmed note through, and null for a blank one', async () => {
    rpcResponse = { data: paidTransition, error: null };
    await call({ action: 'mark_paid', notes: '  حُوّل  ' });
    expect(rpcCalls[0].args.p_notes).toBe('حُوّل');

    rpcCalls.length = 0;
    await call({ action: 'mark_paid', notes: '   ' });
    expect(rpcCalls[0].args.p_notes).toBeNull();
  });
});

describe('fails visibly when the §2.2 migration is not applied', () => {
  it('500 with cause withdrawal_rpc_missing, and no notification', async () => {
    rpcResponse = {
      data: null,
      error: {
        code: 'PGRST202',
        message:
          'Could not find the function public.process_withdrawal_request(p_action, p_actor_id, p_notes, p_withdrawal_id) in the schema cache',
      },
    };
    const res = await call({ action: 'mark_paid' });

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ cause: 'withdrawal_rpc_missing' });
    expect(mockSendWithdrawalProcessed).not.toHaveBeenCalled();
    // No silent fallback: the old two-RPC path must not run.
    expect(rpcCalls.map((c) => c.fn)).toEqual(['process_withdrawal_request']);
  });

  it('a rolled-back transaction is a 500, not a success', async () => {
    rpcResponse = {
      data: null,
      error: { code: 'P0001', message: 'Insufficient credits' },
    };
    const res = await call({ action: 'mark_paid' });
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({
      cause: 'withdrawal_rpc_failed',
      error: 'Insufficient credits',
    });
    expect(mockSendWithdrawalProcessed).not.toHaveBeenCalled();
  });

  it('an unrecognised RPC payload is a 500, never an assumed success', async () => {
    rpcResponse = { data: { outcome: 'ok' }, error: null };
    const res = await call({ action: 'mark_paid' });
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({
      cause: 'withdrawal_rpc_contract_mismatch',
    });
    expect(mockSendWithdrawalProcessed).not.toHaveBeenCalled();
  });
});

describe('gates still hold', () => {
  it('403 and no RPC call when CSRF fails', async () => {
    mockValidateCSRF.mockReturnValue(false);
    const res = await call({ action: 'mark_paid' });
    expect(res.status).toBe(403);
    expect(rpcCalls).toHaveLength(0);
  });

  it('400 and no RPC call for an unknown action', async () => {
    const res = await call({ action: 'delete' });
    expect(res.status).toBe(400);
    expect(rpcCalls).toHaveLength(0);
  });
});
