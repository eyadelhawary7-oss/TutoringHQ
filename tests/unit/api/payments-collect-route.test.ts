import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const mockRequireCenterAuth = vi.fn();
const mockValidateCSRF = vi.fn<(req: NextRequest, userId: string) => boolean>(() => true);

const studentsSelectMaybeSingle = vi.fn();
const paymentsInsertSingle = vi.fn();
const auditInsert = vi.fn().mockResolvedValue({ error: null });

const supabaseAdminStub = {
  from: (table: string) => {
    if (table === 'students') {
      return { select: () => ({ eq: () => ({ maybeSingle: studentsSelectMaybeSingle }) }) };
    }
    if (table === 'payments') {
      return { insert: () => ({ select: () => ({ single: paymentsInsertSingle }) }) };
    }
    if (table === 'audit_log') {
      return { insert: auditInsert };
    }
    throw new Error(`unexpected table in collect test mock: ${table}`);
  },
};

vi.mock('@/lib/centerAuth', () => ({
  requireCenterAuth: (req: NextRequest) => mockRequireCenterAuth(req),
}));
vi.mock('@/lib/csrf', () => ({
  validateCSRFRequest: (req: NextRequest, userId: string) => mockValidateCSRF(req, userId),
}));

import { POST } from '@/app/api/payments/collect/route';

const USER_ID = 'user-abc';
const CENTER_ID = 'center-xyz';
const STUDENT_ID = 'stu-1';

function makeAuth(opts: { role?: string; isSuperAdmin?: boolean; perms?: Record<string, boolean> } = {}) {
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

function makeRequest(body: Record<string, unknown> = { student_id: STUDENT_ID, amount: 100, method: 'cash' }): NextRequest {
  return new Request('http://localhost/api/payments/collect', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  mockRequireCenterAuth.mockReset();
  mockValidateCSRF.mockReset();
  mockValidateCSRF.mockReturnValue(true);
  studentsSelectMaybeSingle.mockReset();
  paymentsInsertSingle.mockReset();
  auditInsert.mockClear();

  studentsSelectMaybeSingle.mockResolvedValue({ data: { id: STUDENT_ID, center_id: CENTER_ID }, error: null });
  paymentsInsertSingle.mockResolvedValue({ data: { id: 'pay-new' }, error: null });
});

describe('POST /api/payments/collect — server-side permission gate', () => {
  it('DENIES (403) a caller without payment-collection permission and records no payment', async () => {
    mockRequireCenterAuth.mockResolvedValue(
      makeAuth({ role: 'assistant', perms: { can_view_payments: false, can_record_payments: false } }),
    );

    const res = await POST(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toMatch(/insufficient permissions/i);
    expect(paymentsInsertSingle).not.toHaveBeenCalled();
  });

  it('allows an assistant with can_record_payments=true', async () => {
    mockRequireCenterAuth.mockResolvedValue(makeAuth({ role: 'assistant', perms: { can_record_payments: true } }));

    const res = await POST(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(paymentsInsertSingle).toHaveBeenCalledTimes(1);
  });

  it('allows an owner even with both flags false', async () => {
    mockRequireCenterAuth.mockResolvedValue(makeAuth({ role: 'owner' }));
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
  });

  it('rejects a student that belongs to another center (no cross-tenant collection)', async () => {
    mockRequireCenterAuth.mockResolvedValue(makeAuth({ role: 'owner' }));
    studentsSelectMaybeSingle.mockResolvedValue({ data: { id: STUDENT_ID, center_id: 'other-center' }, error: null });

    const res = await POST(makeRequest());
    expect(res.status).toBe(403);
    expect(paymentsInsertSingle).not.toHaveBeenCalled();
  });

  it('rejects an invalid payment method', async () => {
    mockRequireCenterAuth.mockResolvedValue(makeAuth({ role: 'owner' }));
    const res = await POST(makeRequest({ student_id: STUDENT_ID, amount: 100, method: 'bitcoin' }));
    expect(res.status).toBe(400);
    expect(paymentsInsertSingle).not.toHaveBeenCalled();
  });

  it('forces center_id to the authenticated centre (never trusts the body)', async () => {
    mockRequireCenterAuth.mockResolvedValue(makeAuth({ role: 'owner' }));
    let captured: Record<string, unknown> | null = null;
    const adminCapture = {
      from: (table: string) => {
        if (table === 'students') return { select: () => ({ eq: () => ({ maybeSingle: studentsSelectMaybeSingle }) }) };
        if (table === 'payments') {
          return {
            insert: (vals: Record<string, unknown>) => {
              captured = vals;
              return { select: () => ({ single: paymentsInsertSingle }) };
            },
          };
        }
        if (table === 'audit_log') return { insert: auditInsert };
        throw new Error(`unexpected ${table}`);
      },
    };
    mockRequireCenterAuth.mockResolvedValue({ ...makeAuth({ role: 'owner' }), supabaseAdmin: adminCapture });

    await POST(makeRequest({ student_id: STUDENT_ID, amount: 50, method: 'cash', center_id: 'evil-center' }));
    expect(captured).not.toBeNull();
    expect((captured as unknown as { center_id: string }).center_id).toBe(CENTER_ID);
  });
});
