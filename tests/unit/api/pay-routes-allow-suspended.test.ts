import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// The release blocker (Job 3, Part E): the lock screen sends a locked centre to /pay,
// which loads its invoices from GET /api/billing/customer-invoices and pays via POST
// /api/invoices/[id]/pay. Once PR B's single-day-lock gate is in requireCenterAuth,
// BOTH of those routes MUST pass { allowSuspended: true } or they return 403
// CENTER_LOCKED to a locked owner and the one door out of the lock is locked. This
// asserts the exemption is wired on both routes. (That the exemption then skips the
// gate is proved by tests/unit/centerAuth.test.ts.)
const requireCenterAuth = vi.fn<(req: unknown, opts?: unknown) => Promise<unknown>>(
  async () => ({ ok: false, response: NextResponse.json({ code: 'STUB' }, { status: 499 }) }),
);
vi.mock('@/lib/centerAuth', () => ({
  requireCenterAuth: (req: unknown, opts?: unknown) => requireCenterAuth(req, opts),
}));

import { GET as customerInvoicesGET } from '@/app/api/billing/customer-invoices/route';
import { POST as invoicePayPOST } from '@/app/api/invoices/[id]/pay/route';

function req(): NextRequest {
  return {
    headers: { get: () => null },
    nextUrl: { searchParams: new URLSearchParams() },
  } as unknown as NextRequest;
}

describe('lock-screen pay path is exempt from the single-day lock (no self-403 deadlock)', () => {
  beforeEach(() => requireCenterAuth.mockClear());

  it('GET /api/billing/customer-invoices calls requireCenterAuth with { allowSuspended: true }', async () => {
    await customerInvoicesGET(req());
    expect(requireCenterAuth).toHaveBeenCalledTimes(1);
    expect(requireCenterAuth.mock.calls[0]?.[1]).toEqual({ allowSuspended: true });
  });

  it('POST /api/invoices/[id]/pay calls requireCenterAuth with { allowSuspended: true }', async () => {
    await invoicePayPOST(req(), { params: Promise.resolve({ id: 'inv-1' }) });
    expect(requireCenterAuth).toHaveBeenCalledTimes(1);
    expect(requireCenterAuth.mock.calls[0]?.[1]).toEqual({ allowSuspended: true });
  });
});
