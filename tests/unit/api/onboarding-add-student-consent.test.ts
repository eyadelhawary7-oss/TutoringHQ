import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const mockRequireCenterAuth = vi.fn();
const mockRateLimit = vi.fn();
const centersUpdateEq = vi.fn().mockResolvedValue({ error: null });
const studentsInsert = vi.fn().mockResolvedValue({ error: null });
const rpcMock = vi.fn().mockResolvedValue({ error: null });

// supabase-admin pulls in `server-only`; mock the whole module. The factory is
// hoisted and invoked at import time, so it must reference the vi.fn()s lazily
// (inside method closures) rather than reading them at construction time.
vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === 'centers') {
        return {
          select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { student_sequence: 1 }, error: null }) }) }),
          update: () => ({ eq: (...a: unknown[]) => centersUpdateEq(...a) }),
        };
      }
      if (table === 'students') {
        return {
          insert: (...a: unknown[]) => studentsInsert(...a),
          select: () => ({ eq: () => ({ eq: () => Promise.resolve({ count: 1, error: null }) }) }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc: (...a: unknown[]) => rpcMock(...a),
  },
}));
vi.mock('@/lib/centerAuth', () => ({
  requireCenterAuth: (req: NextRequest) => mockRequireCenterAuth(req),
}));
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: (...a: unknown[]) => mockRateLimit(...a),
  rateLimitExceededResponse: () =>
    new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429 }),
}));

import { POST } from '@/app/api/onboarding/add-student/route';

const USER_ID = 'user-abc';
const CENTER_ID = 'center-xyz';

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new Request('http://localhost/api/onboarding/add-student', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  mockRequireCenterAuth.mockReset();
  mockRateLimit.mockReset();
  studentsInsert.mockClear();
  rpcMock.mockClear();
  mockRequireCenterAuth.mockResolvedValue({ ok: true, userId: USER_ID, centerId: CENTER_ID });
  mockRateLimit.mockResolvedValue({ success: true });
});

describe('POST /api/onboarding/add-student — guardian consent gate', () => {
  it('rejects with 403 when guardian consent is not confirmed and inserts nothing', async () => {
    const res = await POST(makeRequest({ name: 'Ali' }));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.code).toBe('GUARDIAN_CONSENT_REQUIRED');
    expect(studentsInsert).not.toHaveBeenCalled();
  });

  it('stamps guardian_consent_confirmed_at/_by when confirmed', async () => {
    const res = await POST(makeRequest({ name: 'Ali', guardianConsentConfirmed: true }));
    expect(res.status).toBe(200);
    expect(studentsInsert).toHaveBeenCalledTimes(1);
    const payload = studentsInsert.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.guardian_consent_confirmed_by).toBe(USER_ID);
    expect(typeof payload.guardian_consent_confirmed_at).toBe('string');
  });
});
