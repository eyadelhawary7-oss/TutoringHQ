/**
 * POST /api/staff-invite/submit — PUBLIC intake.
 *
 * Security-critical behaviours (mocking only the token helpers + rate-limit + admin client;
 * the schema + phone normalization + control flow are the REAL route):
 *   1. The stored role comes ONLY from the invite. A `role` field in the body (even
 *      "super_admin") is ignored — the inserted request freezes the invite's role.
 *   2. An unknown/used/expired token inserts NOTHING (400).
 *   3. A lost single-use race (consume=false) inserts NOTHING (400).
 *   4. Rate-limit fails CLOSED when Upstash is unconfigured (503, no DB touch).
 *   5. A malformed body is rejected (400) before any lookup.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

const rl = vi.hoisted(() => ({
  getUpstashRedis: vi.fn(() => ({}) as unknown),
  rateLimit: vi.fn(async () => ({ success: true })),
  getClientIp: vi.fn(() => '1.2.3.4'),
}));
vi.mock('@/lib/ratelimit', () => rl);

const tokens = vi.hoisted(() => ({
  findOpenInviteByPlaintext: vi.fn(),
  consumeStaffInvite: vi.fn(),
}));
vi.mock('@/lib/staffInviteTokens', () => tokens);

const supa = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));
vi.mock('@/lib/supabase-admin', () => supa);

import { POST } from '@/app/api/staff-invite/submit/route';

function makeAdmin() {
  const inserts: { table: string; values: Record<string, unknown> }[] = [];
  const client = {
    from: (table: string) => ({
      insert: (values: Record<string, unknown>) => {
        inserts.push({ table, values });
        return { error: null };
      },
    }),
  } as unknown as SupabaseClient;
  return { client, inserts };
}

function req(body: unknown): NextRequest {
  return new Request('http://localhost/api/staff-invite/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

const VALID = {
  token: 'a-sufficiently-long-token-value',
  name: 'Rep One',
  phone: '01000000001',
};

beforeEach(() => {
  vi.clearAllMocks();
  rl.getUpstashRedis.mockReturnValue({});
  rl.rateLimit.mockResolvedValue({ success: true });
  rl.getClientIp.mockReturnValue('1.2.3.4');
});

describe('POST /api/staff-invite/submit', () => {
  it('freezes the invite role and IGNORES any role in the body', async () => {
    const { client, inserts } = makeAdmin();
    supa.getSupabaseAdmin.mockReturnValue(client);
    tokens.findOpenInviteByPlaintext.mockResolvedValue({
      id: 'inv-1',
      role: 'sales_rep',
      custom_permissions: [],
    });
    tokens.consumeStaffInvite.mockResolvedValue(true);

    // Attacker also sends role: 'super_admin' — it must be discarded.
    const res = await POST(req({ ...VALID, role: 'super_admin', custom_permissions: ['billing'] }));
    expect(res.status).toBe(201);

    const row = inserts.find((i) => i.table === 'staff_requests')!.values;
    expect(row.role).toBe('sales_rep'); // from the invite, NOT the body
    expect(row.custom_permissions).toEqual([]); // sales_rep is not custom
    expect(row.status).toBe('pending');
    expect(row.invite_id).toBe('inv-1');
    expect(row.phone).toBe('201000000001'); // normalized
    // Consumed BEFORE insert (single-use gate).
    expect(tokens.consumeStaffInvite).toHaveBeenCalledWith(client, 'inv-1');
  });

  it('freezes custom_permissions from a custom-role invite', async () => {
    const { client, inserts } = makeAdmin();
    supa.getSupabaseAdmin.mockReturnValue(client);
    tokens.findOpenInviteByPlaintext.mockResolvedValue({
      id: 'inv-2',
      role: 'custom',
      custom_permissions: ['centers', 'analytics'],
    });
    tokens.consumeStaffInvite.mockResolvedValue(true);

    const res = await POST(req({ ...VALID, custom_permissions: ['billing', 'withdrawals'] }));
    expect(res.status).toBe(201);
    const row = inserts.find((i) => i.table === 'staff_requests')!.values;
    expect(row.role).toBe('custom');
    expect(row.custom_permissions).toEqual(['centers', 'analytics']); // from invite, not body
  });

  it('rejects an unknown/used/expired token (400) and inserts nothing', async () => {
    const { client, inserts } = makeAdmin();
    supa.getSupabaseAdmin.mockReturnValue(client);
    tokens.findOpenInviteByPlaintext.mockResolvedValue(null);

    const res = await POST(req(VALID));
    expect(res.status).toBe(400);
    expect(inserts).toHaveLength(0);
    expect(tokens.consumeStaffInvite).not.toHaveBeenCalled();
  });

  it('rejects a lost single-use race (consume=false) and inserts nothing', async () => {
    const { client, inserts } = makeAdmin();
    supa.getSupabaseAdmin.mockReturnValue(client);
    tokens.findOpenInviteByPlaintext.mockResolvedValue({ id: 'inv-3', role: 'accountant', custom_permissions: [] });
    tokens.consumeStaffInvite.mockResolvedValue(false);

    const res = await POST(req(VALID));
    expect(res.status).toBe(400);
    expect(inserts).toHaveLength(0);
  });

  it('fails CLOSED when Upstash is unconfigured (503, no lookup)', async () => {
    rl.getUpstashRedis.mockReturnValue(null);
    const { client } = makeAdmin();
    supa.getSupabaseAdmin.mockReturnValue(client);

    const res = await POST(req(VALID));
    expect(res.status).toBe(503);
    expect(tokens.findOpenInviteByPlaintext).not.toHaveBeenCalled();
  });

  it('rejects a malformed body (missing token) before any lookup (400)', async () => {
    supa.getSupabaseAdmin.mockReturnValue(makeAdmin().client);
    const res = await POST(req({ name: 'Rep One', phone: '01000000001' }));
    expect(res.status).toBe(400);
    expect(tokens.findOpenInviteByPlaintext).not.toHaveBeenCalled();
  });
});
