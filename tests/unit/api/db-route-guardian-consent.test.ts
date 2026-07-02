import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const USER_ID = '22222222-2222-4222-8222-222222222222';
const CENTER_ID = '11111111-1111-4111-8111-111111111111';

const mockGetUser = vi.fn();
let capturedInsert: Record<string, unknown> | undefined;

const studentsInsert = vi.fn((payload: Record<string, unknown>) => {
  capturedInsert = payload;
  return {
    select: () =>
      Promise.resolve({
        data: [
          {
            id: 'stu-1',
            center_id: CENTER_ID,
            name: payload.name,
            parent_phone: payload.parent_phone ?? null,
            parent_pack_opted_in: payload.parent_pack_opted_in ?? false,
          },
        ],
        error: null,
        count: null,
      }),
  };
});

function adminFrom(table: string) {
  if (table === 'users') {
    return {
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: { center_id: CENTER_ID, phone: '+201000000000', role: 'owner' }, error: null }) }),
      }),
    };
  }
  if (table === 'admin_users') {
    return {
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
    };
  }
  if (table === 'students') {
    return { insert: studentsInsert };
  }
  if (table === 'audit_log') {
    return { insert: () => Promise.resolve({ error: null }) };
  }
  throw new Error(`unexpected table in db-route consent test mock: ${table}`);
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn((_url: string, key: string) => {
    if (key === 'test-anon-key') {
      return { auth: { getUser: mockGetUser } };
    }
    return { from: adminFrom };
  }),
}));

vi.mock('@/lib/csrf', () => ({
  validateCSRFRequest: () => true,
}));

vi.mock('@/lib/studentParentPackWelcome', () => ({
  afterStudentWriteParentPackEffects: vi.fn().mockResolvedValue(undefined),
}));

// loadBostaShippingRates pulls in `server-only`; the students path never calls
// it, but the import must resolve in the test environment.
vi.mock('@/lib/loadBostaShippingRates', () => ({
  loadBostaShippingRates: vi.fn().mockResolvedValue([]),
}));

import { POST } from '@/app/api/db/route';

function makeRequest(data: Record<string, unknown>) {
  return new Request('http://localhost/api/db', {
    method: 'POST',
    headers: { Authorization: 'Bearer tok', 'content-type': 'application/json' },
    body: JSON.stringify({
      operation: 'insert',
      table: 'students',
      data: { center_id: CENTER_ID, ...data },
      select: '*',
    }),
  });
}

beforeEach(() => {
  mockGetUser.mockReset();
  studentsInsert.mockClear();
  capturedInsert = undefined;
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
});

describe('POST /api/db — guardian consent gate on student insert', () => {
  it('rejects with 403 when guardian_consent_confirmed is absent and does not insert', async () => {
    const res = await POST(makeRequest({ name: 'Ali', payment_status: 'unpaid' }));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.code).toBe('GUARDIAN_CONSENT_REQUIRED');
    expect(studentsInsert).not.toHaveBeenCalled();
  });

  it('rejects with 403 when guardian_consent_confirmed is false', async () => {
    const res = await POST(
      makeRequest({ name: 'Ali', payment_status: 'unpaid', guardian_consent_confirmed: false }),
    );
    expect(res.status).toBe(403);
    expect(studentsInsert).not.toHaveBeenCalled();
  });

  it('inserts and stamps _at/_by (and strips the transient flag) when confirmed', async () => {
    const res = await POST(
      makeRequest({ name: 'Ali', payment_status: 'unpaid', guardian_consent_confirmed: true }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.error).toBeNull();
    expect(studentsInsert).toHaveBeenCalledTimes(1);
    expect(capturedInsert?.guardian_consent_confirmed).toBeUndefined();
    expect(capturedInsert?.guardian_consent_confirmed_by).toBe(USER_ID);
    expect(typeof capturedInsert?.guardian_consent_confirmed_at).toBe('string');
    expect(capturedInsert?.center_id).toBe(CENTER_ID);
  });

  it('stamps every row on a bulk (array) insert', async () => {
    const capturedRows: Record<string, unknown>[] = [];
    studentsInsert.mockImplementationOnce((payload: Record<string, unknown>[] | Record<string, unknown>) => {
      const rows = Array.isArray(payload) ? payload : [payload];
      capturedRows.push(...rows);
      return { select: () => Promise.resolve({ data: rows.map((r, i) => ({ id: `stu-${i}`, center_id: CENTER_ID, name: r.name, parent_phone: null, parent_pack_opted_in: false })), error: null, count: null }) };
    });

    const res = await POST(
      new Request('http://localhost/api/db', {
        method: 'POST',
        headers: { Authorization: 'Bearer tok', 'content-type': 'application/json' },
        body: JSON.stringify({
          operation: 'insert',
          table: 'students',
          data: [
            { center_id: CENTER_ID, name: 'Ali', payment_status: 'unpaid', guardian_consent_confirmed: true },
            { center_id: CENTER_ID, name: 'Mona', payment_status: 'unpaid', guardian_consent_confirmed: true },
          ],
          select: '*',
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(capturedRows).toHaveLength(2);
    for (const r of capturedRows) {
      expect(r.guardian_consent_confirmed).toBeUndefined();
      expect(r.guardian_consent_confirmed_by).toBe(USER_ID);
      expect(typeof r.guardian_consent_confirmed_at).toBe('string');
    }
  });

  it('rejects the whole bulk insert if any row is missing confirmation', async () => {
    const res = await POST(
      new Request('http://localhost/api/db', {
        method: 'POST',
        headers: { Authorization: 'Bearer tok', 'content-type': 'application/json' },
        body: JSON.stringify({
          operation: 'insert',
          table: 'students',
          data: [
            { center_id: CENTER_ID, name: 'Ali', payment_status: 'unpaid', guardian_consent_confirmed: true },
            { center_id: CENTER_ID, name: 'Mona', payment_status: 'unpaid' },
          ],
          select: '*',
        }),
      }),
    );
    expect(res.status).toBe(403);
    expect(studentsInsert).not.toHaveBeenCalled();
  });
});
