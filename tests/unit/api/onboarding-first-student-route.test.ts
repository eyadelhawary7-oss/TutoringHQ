import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const mockGetUser = vi.fn();
const usersCoreMaybeSingle = vi.fn();
const usersPermsMaybeSingle = vi.fn();
const studentsInsertSingle = vi.fn();
const studentsInsertMock = vi.fn((_payload?: Record<string, unknown>) => ({
  select: () => ({ single: studentsInsertSingle }),
}));
// CSRF is enforced on this POST (fail-closed). Default to valid so the CORE/permissions/
// consent behaviour under test is reachable; one test flips it to prove the 403.
const mockValidateCSRF = vi.fn(() => true);

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn((_url: string, key: string) => {
    if (key === 'test-anon-key') {
      return { auth: { getUser: mockGetUser } };
    }
    return {
      from: (table: string) => {
        if (table === 'users') {
          return {
            select: (cols: string) => {
              const isPermsSelect = cols.includes('can_');
              return {
                eq: () => ({
                  maybeSingle: isPermsSelect
                    ? usersPermsMaybeSingle
                    : usersCoreMaybeSingle,
                }),
              };
            },
          };
        }
        if (table === 'students') {
          return {
            insert: studentsInsertMock,
          };
        }
        // Suspension / single-day-lock gate (Job 3 Part 6): the route now reads the
        // centre row and the lockout policy. Benign, non-locked centre + empty config
        // so the gate passes through to the behaviour under test.
        if (table === 'centers') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: {
                      status: 'active',
                      is_blacklisted: false,
                      billing_status: 'paid',
                      next_payment_due: null,
                      auto_suspend_at: null,
                    },
                    error: null,
                  }),
              }),
            }),
          };
        }
        if (table === 'platform_config') {
          return { select: () => ({ in: () => Promise.resolve({ data: [], error: null }) }) };
        }
        throw new Error(`unexpected table in onboarding/first-student test mock: ${table}`);
      },
    };
  }),
}));

vi.mock('@sentry/nextjs', () => ({
  withScope: vi.fn((cb: (scope: { setTag: () => void }) => void) =>
    cb({ setTag: vi.fn() } as never),
  ),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

vi.mock('@/lib/csrf', () => ({
  validateCSRFRequest: (...args: unknown[]) => mockValidateCSRF(...(args as [])),
}));

import { POST } from '@/app/api/onboarding/first-student/route';

function makeRequest(
  body: Record<string, unknown> = { name: 'Ali', guardianConsentConfirmed: true },
  token = 'tok',
): import('next/server').NextRequest {
  return new Request('http://localhost/api/onboarding/first-student', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  }) as unknown as import('next/server').NextRequest;
}

const USER_ID = 'user-abc';
const CENTER_ID = 'center-xyz';

beforeEach(() => {
  mockGetUser.mockReset();
  usersCoreMaybeSingle.mockReset();
  usersPermsMaybeSingle.mockReset();
  studentsInsertSingle.mockReset();
  studentsInsertMock.mockReset();
  studentsInsertMock.mockImplementation((_payload?: Record<string, unknown>) => ({
    select: () => ({ single: studentsInsertSingle }),
  }));
  mockValidateCSRF.mockReset();
  mockValidateCSRF.mockReturnValue(true);

  mockGetUser.mockResolvedValue({
    data: { user: { id: USER_ID, email: '201112223344@centerhq.local' } },
    error: null,
  });
  studentsInsertSingle.mockResolvedValue({
    data: {
      id: 'stu-1',
      name: 'Ali',
      phone: null,
      student_number: 'TEST-00001',
    },
    error: null,
  });
});

describe('POST /api/onboarding/first-student — Rule 151 CORE+best-effort split', () => {
  it('CORE select db error -> 500 (NOT 401-locked) and PERMISSIONS select is skipped', async () => {
    usersCoreMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: 'cache stale: column missing', code: '42703' },
    });

    const res = await POST(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe('server_error');
    expect(usersPermsMaybeSingle).not.toHaveBeenCalled();
    expect(studentsInsertSingle).not.toHaveBeenCalled();
  });

  it('CORE select genuine no-row -> 401', async () => {
    usersCoreMaybeSingle.mockResolvedValue({ data: null, error: null });

    const res = await POST(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toBe('Unauthorized');
    expect(usersPermsMaybeSingle).not.toHaveBeenCalled();
    expect(studentsInsertSingle).not.toHaveBeenCalled();
  });

  it('CORE ok, PERMISSIONS select errors -> onboarding PROCEEDS (canManage defaults true)', async () => {
    usersCoreMaybeSingle.mockResolvedValue({
      data: { id: USER_ID, center_id: CENTER_ID },
      error: null,
    });
    usersPermsMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: 'column "can_manage_students" does not exist', code: '42703' },
    });

    const res = await POST(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.student.id).toBe('stu-1');
    expect(studentsInsertSingle).toHaveBeenCalled();
  });

  it('CORE ok, can_manage_students === false -> 403 Forbidden (explicit deny preserved)', async () => {
    usersCoreMaybeSingle.mockResolvedValue({
      data: { id: USER_ID, center_id: CENTER_ID },
      error: null,
    });
    usersPermsMaybeSingle.mockResolvedValue({
      data: { can_manage_students: false },
      error: null,
    });

    const res = await POST(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toBe('Forbidden');
    expect(studentsInsertSingle).not.toHaveBeenCalled();
  });

  it('happy path -> 200 with student payload', async () => {
    usersCoreMaybeSingle.mockResolvedValue({
      data: { id: USER_ID, center_id: CENTER_ID },
      error: null,
    });
    usersPermsMaybeSingle.mockResolvedValue({
      data: { can_manage_students: true },
      error: null,
    });

    const res = await POST(
      makeRequest({ name: 'Ali', phone: '+201111111111', guardianConsentConfirmed: true }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.student).toEqual({
      id: 'stu-1',
      name: 'Ali',
      phone: '',
      student_number: 'TEST-00001',
    });
  });

  it('rejects with 403 when guardian consent is not confirmed (server is the gate)', async () => {
    usersCoreMaybeSingle.mockResolvedValue({
      data: { id: USER_ID, center_id: CENTER_ID },
      error: null,
    });
    usersPermsMaybeSingle.mockResolvedValue({
      data: { can_manage_students: true },
      error: null,
    });

    const res = await POST(makeRequest({ name: 'Ali' })); // no guardianConsentConfirmed
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.code).toBe('GUARDIAN_CONSENT_REQUIRED');
    expect(studentsInsertSingle).not.toHaveBeenCalled();
  });

  it('records guardian_consent_confirmed_at/_by on the inserted row', async () => {
    usersCoreMaybeSingle.mockResolvedValue({
      data: { id: USER_ID, center_id: CENTER_ID },
      error: null,
    });
    usersPermsMaybeSingle.mockResolvedValue({
      data: { can_manage_students: true },
      error: null,
    });

    let capturedInsert: Record<string, unknown> | undefined;
    studentsInsertMock.mockImplementation((payload?: Record<string, unknown>) => {
      capturedInsert = payload;
      return { select: () => ({ single: studentsInsertSingle }) };
    });

    const res = await POST(makeRequest({ name: 'Ali', guardianConsentConfirmed: true }));
    expect(res.status).toBe(200);
    expect(capturedInsert?.guardian_consent_confirmed_by).toBe(USER_ID);
    expect(typeof capturedInsert?.guardian_consent_confirmed_at).toBe('string');
  });

  it('fails closed with 403 when the CSRF token is missing/invalid (no student inserted)', async () => {
    usersCoreMaybeSingle.mockResolvedValue({
      data: { id: USER_ID, center_id: CENTER_ID },
      error: null,
    });
    usersPermsMaybeSingle.mockResolvedValue({ data: { can_manage_students: true }, error: null });
    mockValidateCSRF.mockReturnValue(false);

    const res = await POST(makeRequest({ name: 'Ali', guardianConsentConfirmed: true }));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toBe('Invalid CSRF token');
    expect(studentsInsertSingle).not.toHaveBeenCalled();
  });
});
