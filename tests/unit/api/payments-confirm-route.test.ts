import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const mockRequireCenterAuth = vi.fn();
const mockValidateCSRF = vi.fn(() => true);

const paymentsSelectSingle = vi.fn();
const paymentsUpdateEq = vi.fn();
const studentsSelectSingle = vi.fn();
const studentsUpdateEq = vi.fn();

const supabaseAdminStub = {
  from: (table: string) => {
    if (table === 'payments') {
      return {
        select: () => ({ eq: () => ({ single: paymentsSelectSingle }) }),
        update: () => ({ eq: paymentsUpdateEq }),
      };
    }
    if (table === 'students') {
      return {
        select: () => ({ eq: () => ({ single: studentsSelectSingle }) }),
        update: () => ({ eq: studentsUpdateEq }),
      };
    }
    throw new Error(
      `unexpected table in payments/confirm test mock: ${table} — route should not be reading 'users' directly anymore (Rule 151 fix uses auth.permissions / auth.role).`,
    );
  },
};

vi.mock('@/lib/centerAuth', () => ({
  requireCenterAuth: (req: NextRequest) => mockRequireCenterAuth(req),
}));

vi.mock('@/lib/csrf', () => ({
  validateCSRFRequest: (req: NextRequest, userId: string) =>
    mockValidateCSRF(req, userId),
}));

import { POST } from '@/app/api/payments/confirm/route';

const USER_ID = 'user-abc';
const CENTER_ID = 'center-xyz';
const PAYMENT_ID = 'pay-1';
const STUDENT_ID = 'stu-1';

type PermFlagsOverride = Partial<{
  can_view_payments: boolean;
  can_record_payments: boolean;
  can_manage_billing: boolean;
  can_edit_center_profile: boolean;
  can_delete_students: boolean;
  can_manage_academic_calendar: boolean;
  can_place_card_orders: boolean;
  can_request_referral_payouts: boolean;
}>;

function makeAuth(opts: {
  role?: string;
  isSuperAdmin?: boolean;
  perms?: PermFlagsOverride;
} = {}) {
  return {
    ok: true,
    userId: USER_ID,
    centerId: CENTER_ID,
    role: opts.role ?? 'assistant',
    isSuperAdmin: opts.isSuperAdmin ?? false,
    permissions: {
      can_record_payments: false,
      can_view_payments: false,
      can_manage_billing: false,
      can_edit_center_profile: false,
      can_delete_students: false,
      can_manage_academic_calendar: false,
      can_place_card_orders: false,
      can_request_referral_payouts: false,
      ...opts.perms,
    },
    supabaseAdmin: supabaseAdminStub,
  };
}

function makeRequest(body: Record<string, unknown> = { payment_id: PAYMENT_ID }): NextRequest {
  return new Request('http://localhost/api/payments/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  mockRequireCenterAuth.mockReset();
  mockValidateCSRF.mockReset();
  mockValidateCSRF.mockReturnValue(true);
  paymentsSelectSingle.mockReset();
  paymentsUpdateEq.mockReset();
  studentsSelectSingle.mockReset();
  studentsUpdateEq.mockReset();

  paymentsSelectSingle.mockResolvedValue({
    data: {
      id: PAYMENT_ID,
      student_id: STUDENT_ID,
      center_id: CENTER_ID,
      amount: 100,
      status: 'pending',
    },
    error: null,
  });
  paymentsUpdateEq.mockResolvedValue({ data: null, error: null });
  studentsSelectSingle.mockResolvedValue({ data: { balance_due: 200 }, error: null });
  studentsUpdateEq.mockResolvedValue({ data: null, error: null });
});

describe('POST /api/payments/confirm — Rule 151 best-effort permissions', () => {
  it('owner with both flags false in DB is still allowed (role authorizes; no 403 from permission-read blip)', async () => {
    mockRequireCenterAuth.mockResolvedValue(
      makeAuth({
        role: 'owner',
        perms: { can_view_payments: false, can_record_payments: false },
      }),
    );

    const res = await POST(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(paymentsUpdateEq).toHaveBeenCalled();
  });

  it('super_admin with both flags false is allowed', async () => {
    mockRequireCenterAuth.mockResolvedValue(
      makeAuth({
        role: 'assistant',
        isSuperAdmin: true,
        perms: { can_view_payments: false, can_record_payments: false },
      }),
    );

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(paymentsUpdateEq).toHaveBeenCalled();
  });

  it('assistant with can_record_payments=true is allowed', async () => {
    mockRequireCenterAuth.mockResolvedValue(
      makeAuth({
        role: 'assistant',
        perms: { can_record_payments: true },
      }),
    );

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(paymentsUpdateEq).toHaveBeenCalled();
  });

  it('assistant with both flags false -> 403 (genuine deny preserved)', async () => {
    mockRequireCenterAuth.mockResolvedValue(
      makeAuth({
        role: 'assistant',
        perms: { can_view_payments: false, can_record_payments: false },
      }),
    );

    const res = await POST(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toMatch(/insufficient permissions/i);
    expect(paymentsUpdateEq).not.toHaveBeenCalled();
  });
});

// NOTE: behaviour under a permission-read ERROR (PostgREST cache blip) is covered
// by centerAuth's own tests at tests/unit/centerAuth.test.ts — the best-effort
// permissions block there defaults all can_* flags to false on permsErr without
// failing the whole auth. This route now consumes that result via
// auth.permissions / auth.role, so an owner/super_admin is never 403'd by such
// a blip (verified by the "both flags false" cases above).
