import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const mockRequireCenterAuth = vi.fn();
const groupsInsert = vi.fn().mockResolvedValue({ error: null });
const rpcMock = vi.fn().mockResolvedValue({ error: null });

// supabase-admin pulls in `server-only`; mock the whole module. The factory is
// hoisted and invoked at import time, so it references the vi.fn()s lazily.
vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === 'student_groups') {
        return { insert: (...a: unknown[]) => groupsInsert(...a) };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc: (...a: unknown[]) => rpcMock(...a),
  },
}));
vi.mock('@/lib/centerAuth', () => ({
  requireCenterAuth: (req: NextRequest) => mockRequireCenterAuth(req),
}));

import { POST } from '@/app/api/onboarding/create-group/route';

const USER_ID = 'user-abc';
const CENTER_ID = 'center-xyz';

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new Request('http://localhost/api/onboarding/create-group', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  mockRequireCenterAuth.mockReset();
  groupsInsert.mockClear();
  rpcMock.mockClear();
  mockRequireCenterAuth.mockResolvedValue({ ok: true, userId: USER_ID, centerId: CENTER_ID });
});

describe('POST /api/onboarding/create-group — positive fee_per_class required', () => {
  it('rejects with 400 + field when fee_per_class is missing (inserts nothing)', async () => {
    const res = await POST(makeRequest({ name: 'Physics 1' }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.field).toBe('fee_per_class');
    expect(groupsInsert).not.toHaveBeenCalled();
  });

  it('rejects with 400 when fee_per_class is zero (would silently charge 0)', async () => {
    const res = await POST(makeRequest({ name: 'Physics 1', fee_per_class: 0 }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.field).toBe('fee_per_class');
    expect(groupsInsert).not.toHaveBeenCalled();
  });

  it('rejects with 400 when fee_per_class is negative', async () => {
    const res = await POST(makeRequest({ name: 'Physics 1', fee_per_class: -50 }));
    expect(res.status).toBe(400);
    expect(groupsInsert).not.toHaveBeenCalled();
  });

  it('inserts the group with a positive fee_per_class', async () => {
    const res = await POST(makeRequest({ name: 'Physics 1', subject: 'Physics', fee_per_class: 300 }));

    expect(res.status).toBe(200);
    expect(groupsInsert).toHaveBeenCalledTimes(1);
    const payload = groupsInsert.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toMatchObject({ center_id: CENTER_ID, name: 'Physics 1', subject: 'Physics', fee_per_class: 300 });
    // the onboarding step is marked complete via the RPC
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it('coerces a numeric string fee ("300") to a number', async () => {
    const res = await POST(makeRequest({ name: 'Physics 1', fee_per_class: '300' }));
    expect(res.status).toBe(200);
    const payload = groupsInsert.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.fee_per_class).toBe(300);
  });
});
