import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const mockGetUser = vi.fn();
const usersCoreMaybeSingle = vi.fn();
const usersPermsMaybeSingle = vi.fn();
const studentsInsertSingle = vi.fn();

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
            insert: () => ({
              select: () => ({ single: studentsInsertSingle }),
            }),
          };
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

import { POST } from '@/app/api/onboarding/first-student/route';

function makeRequest(
  body: Record<string, unknown> = { name: 'Ali' },
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

    const res = await POST(makeRequest({ name: 'Ali', phone: '+201111111111' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.student).toEqual({
      id: 'stu-1',
      name: 'Ali',
      phone: '',
      student_number: 'TEST-00001',
    });
  });
});
