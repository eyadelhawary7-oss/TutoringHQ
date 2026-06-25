import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const mockRequireSuperAdminApi = vi.fn();
vi.mock('@/lib/admin-auth', () => ({
  requireSuperAdminApi: (req: Request) => mockRequireSuperAdminApi(req),
}));

// Truthy admin client so the route's config guard passes and we reach the auth gate.
vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }) }) },
}));
vi.mock('@/lib/referralNetBase', () => ({ netReferralBaseFromAllInPrice: () => 0 }));
vi.mock('@/lib/centerNotify', () => ({ sendReferralCommission: vi.fn() }));
vi.mock('@/lib/ownerPhone', () => ({ ownerContactByCenterId: vi.fn(), resolveOwnerWaPhone: vi.fn() }));
vi.mock('@/lib/validate', () => ({ parseBodyWithLimit: async (req: Request) => JSON.parse(await req.text()) }));

import { POST } from '@/app/api/referrals/process-commission/route';

function req(body: unknown) {
  return new Request('https://centerhq.app/api/referrals/process-commission', {
    method: 'POST',
    body: JSON.stringify(body ?? {}),
  }) as never;
}

beforeEach(() => mockRequireSuperAdminApi.mockReset());

describe('process-commission auth gate', () => {
  it('denies a non-super-admin caller (mirrors requireSuperAdminApi)', async () => {
    mockRequireSuperAdminApi.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    });
    const res = await POST(req({ referral_id: 'r1', period_month: '2026-06', paid_in_full: true }));
    expect(res.status).toBe(403);
    expect(mockRequireSuperAdminApi).toHaveBeenCalled();
  });

  it('lets a super-admin through the gate (then validates the body)', async () => {
    mockRequireSuperAdminApi.mockResolvedValue({ ok: true, supabaseAdmin: {}, userId: 'u1' });
    // Missing required fields → 400, proving auth passed (not 401/403).
    const res = await POST(req({}));
    expect(res.status).toBe(400);
  });
});
