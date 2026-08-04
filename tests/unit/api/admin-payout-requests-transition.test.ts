/**
 * PATCH /api/admin/payout-requests/[id] — PAYOUT-SYSTEM-SPEC.md §2.1.
 *
 * The route that did not exist. These cover the four properties that make it
 * safe to point at real money:
 *   1. CSRF is validated (§2.6 / A14 — the release gate must not be forgeable).
 *   2. A SUPER_ADMIN_PHONES-only session cannot release money (§7.5 / S10).
 *   3. The RPC is the only writer, and its absence fails VISIBLY with 503
 *      naming the migration — never a silent fallback UPDATE.
 *   4. An idempotent re-call is a success, not an error, and the route never
 *      invents a state the RPC did not report.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockRequireSuperAdminApi = vi.fn();
const mockRequireSuperAdminRow = vi.fn();
const mockValidateCSRF = vi.fn();
const mockRpc = vi.fn();
const mockAdminUserRole = vi.fn();

vi.mock('@/lib/admin-auth', () => ({
  requireSuperAdminApi: (req: Request) => mockRequireSuperAdminApi(req),
}));

vi.mock('@/lib/admin-access', () => ({
  requireSuperAdminRow: () => mockRequireSuperAdminRow(),
}));

vi.mock('@/lib/csrf', () => ({
  validateCSRFRequest: (req: Request, userId: string) => mockValidateCSRF(req, userId),
}));

const ACTOR = '11111111-1111-4111-8111-111111111111';
const PAYOUT_ID = '3f1a2b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b';

const supabaseAdmin = {
  from: (table: string) => {
    if (table !== 'admin_users') throw new Error(`unexpected table ${table}`);
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: async () => mockAdminUserRole(),
        }),
      }),
    };
  },
  rpc: (name: string, args: Record<string, unknown>) => mockRpc(name, args),
};

async function callPatch(body: unknown, id: string = PAYOUT_ID) {
  const { PATCH } = await import('@/app/api/admin/payout-requests/[id]/route');
  const req = new NextRequest(`http://localhost/api/admin/payout-requests/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const res = await PATCH(req, { params: Promise.resolve({ id }) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireSuperAdminApi.mockResolvedValue({ ok: true, supabaseAdmin, userId: ACTOR });
  mockRequireSuperAdminRow.mockResolvedValue(null);
  mockValidateCSRF.mockReturnValue(true);
  mockAdminUserRole.mockResolvedValue({ data: { role: 'super_admin' }, error: null });
  mockRpc.mockResolvedValue({
    data: {
      ok: true,
      idempotent: false,
      id: PAYOUT_ID,
      status: 'approved',
      previous_status: 'pending',
    },
    error: null,
  });
});

describe('authorization', () => {
  it('rejects a request with no valid CSRF token before touching the RPC', async () => {
    mockValidateCSRF.mockReturnValue(false);
    const { status } = await callPatch({ action: 'approve' });
    expect(status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('rejects a SUPER_ADMIN_PHONES-only session that has no admin_users row', async () => {
    // requireSuperAdminApi and requireSuperAdminRow both accept an env-phone
    // super admin; only this check does not. Such an approval would be
    // forensically anonymous (§7.5).
    mockAdminUserRole.mockResolvedValue({ data: null, error: null });
    const { status, json } = await callPatch({ action: 'approve' });
    expect(status).toBe(403);
    expect(json.code).toBe('forbidden_actor');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('rejects an admin_users row that is not super_admin', async () => {
    mockAdminUserRole.mockResolvedValue({ data: { role: 'accountant' }, error: null });
    const { status } = await callPatch({ action: 'approve' });
    expect(status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe('input validation', () => {
  it('rejects an unknown action', async () => {
    const { status, json } = await callPatch({ action: 'pay_now' });
    expect(status).toBe(400);
    expect(json.code).toBe('invalid_action');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('rejects a non-uuid id', async () => {
    const { status } = await callPatch({ action: 'approve' }, 'not-a-uuid');
    expect(status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('refuses an over-length rejection reason instead of silently truncating it', async () => {
    // The reason lands in audit_log.details.reason inside the transition
    // transaction. Storing half of it while returning success would leave a
    // sentence that stops mid-clause as the permanent record of why a payout
    // was denied, with nothing anywhere saying so.
    const { status, json } = await callPatch({
      action: 'reject',
      reason: 'x'.repeat(501),
    });
    expect(status).toBe(400);
    expect(json.code).toBe('reason_too_long');
    expect(json.max).toBe(500);
    expect(json.length).toBe(501);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe('the RPC is the sole writer', () => {
  it('passes the actor from the session, never from the body', async () => {
    await callPatch({
      action: 'approve',
      // A forged actor in the body must be ignored.
      p_actor_id: 'attacker',
      center_id: 'attacker-center',
    });
    expect(mockRpc).toHaveBeenCalledTimes(1);
    const [name, args] = mockRpc.mock.calls[0];
    expect(name).toBe('transition_payout_request');
    expect(args).toEqual({
      p_payout_id: PAYOUT_ID,
      p_action: 'approve',
      p_actor_id: ACTOR,
      p_reason: null,
    });
  });

  it('forwards a trimmed rejection reason', async () => {
    mockRpc.mockResolvedValue({
      data: { ok: true, idempotent: false, id: PAYOUT_ID, status: 'rejected', previous_status: 'pending' },
      error: null,
    });
    await callPatch({ action: 'reject', reason: '  duplicate of last quarter  ' });
    expect(mockRpc.mock.calls[0][1].p_reason).toBe('duplicate of last quarter');
  });

  it('fails VISIBLY with 503 when the migration has not been applied', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: {
        code: 'PGRST202',
        message:
          'Could not find the function public.transition_payout_request(p_action, p_actor_id, p_payout_id, p_reason) in the schema cache',
      },
    });
    const { status, json } = await callPatch({ action: 'approve' });
    expect(status).toBe(503);
    expect(json.code).toBe('payout_approval_migration_not_applied');
    expect(String(json.migration)).toContain('payout_requests_approval_path.sql');
  });

  it('maps an illegal transition to 409, not to a success', async () => {
    mockRpc.mockResolvedValue({
      data: { ok: false, code: 'invalid_transition', status: 'paid' },
      error: null,
    });
    const { status, json } = await callPatch({ action: 'approve' });
    expect(status).toBe(409);
    expect(json.code).toBe('invalid_transition');
  });

  it('maps an uncovered approval to 409 and passes the figures through', async () => {
    mockRpc.mockResolvedValue({
      data: {
        ok: false,
        code: 'insufficient_reward_coverage',
        status: 'pending',
        requested: 1000,
        committed: 1500,
        available: 2000,
      },
      error: null,
    });
    const { status, json } = await callPatch({ action: 'approve' });
    expect(status).toBe(409);
    expect(json.code).toBe('insufficient_reward_coverage');
  });

  it('reports an idempotent re-call as success without inventing a state', async () => {
    mockRpc.mockResolvedValue({
      data: {
        ok: true,
        idempotent: true,
        id: PAYOUT_ID,
        status: 'approved',
        previous_status: 'approved',
      },
      error: null,
    });
    const { status, json } = await callPatch({ action: 'approve' });
    expect(status).toBe(200);
    expect(json).toMatchObject({
      success: true,
      idempotent: true,
      status: 'approved',
      previous_status: 'approved',
    });
  });

  it('never reports success on an unparseable RPC response', async () => {
    mockRpc.mockResolvedValue({ data: 'weird', error: null });
    const { status } = await callPatch({ action: 'approve' });
    expect(status).toBe(500);
  });
});
