import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.SUPER_ADMIN_PHONES = '';

const mockGetUser = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: mockGetUser },
  })),
}));

type AdminQueryResult = { data: unknown; error: { message: string } | null };

// Queue-per-table mock, mirroring tests/unit/centerAuth.test.ts. The route
// goes through the REAL requireTeacherAuth (users + teacher_center) and then
// its own rpc/teacher_subscriptions/centers calls.
const adminQueue: Record<string, AdminQueryResult[]> = {
  users_teacher: [],
  teacher_center: [],
  teacher_subscriptions: [],
  centers: [],
  rpc: [],
};

function resolveQuery(table: string): AdminQueryResult {
  if (table === 'users') {
    return adminQueue.users_teacher.shift() ?? { data: null, error: null };
  }
  if (table === 'teacher_center') {
    return adminQueue.teacher_center.shift() ?? { data: [], error: null };
  }
  if (table === 'teacher_subscriptions') {
    return adminQueue.teacher_subscriptions.shift() ?? { data: null, error: null };
  }
  if (table === 'centers') {
    return adminQueue.centers.shift() ?? { data: [], error: null };
  }
  return { data: null, error: null };
}

const mockRpc = vi.fn(async () => {
  return adminQueue.rpc.shift() ?? { data: null, error: null };
});

const mockGetSupabaseAdmin = vi.fn(() => ({
  rpc: mockRpc,
  from: (table: string) => {
    // Builder supports `.eq().maybeSingle()`, `.eq().limit().maybeSingle()`
    // (subscription presence), `.eq().eq()` awaited (teacher_center), and
    // `.in()` awaited (centers display).
    const builder = {
      eq: () => builder,
      in: () => builder,
      limit: () => builder,
      maybeSingle: async () => resolveQuery(table),
      then: (
        onFulfilled: (v: AdminQueryResult) => unknown,
        onRejected?: (e: unknown) => unknown,
      ) => Promise.resolve(resolveQuery(table)).then(onFulfilled, onRejected),
    };
    return { select: () => builder };
  },
}));

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => mockGetSupabaseAdmin(),
}));

const mockSentryCaptureException = vi.fn();
const mockSentryCaptureMessage = vi.fn();
vi.mock('@sentry/nextjs', () => ({
  withScope: (fn: (s: { setTag: (k: string, v: string) => void }) => void) => {
    fn({ setTag: () => undefined });
  },
  captureException: (err: unknown) => mockSentryCaptureException(err),
  captureMessage: (msg: string, level?: string) => mockSentryCaptureMessage(msg, level),
}));

import { GET } from '@/app/api/teacher/context/route';

function makeRequest(): NextRequest {
  const headers = new Map<string, string>([['Authorization', 'Bearer fake-token']]);
  return {
    headers: { get: (k: string) => headers.get(k) ?? null },
    nextUrl: { searchParams: new URLSearchParams() },
  } as unknown as NextRequest;
}

const VALID_USER = { id: 'user-1' };

function queueTeacherAuthOk() {
  mockGetUser.mockResolvedValueOnce({ data: { user: VALID_USER }, error: null });
  adminQueue.users_teacher = [
    { data: { id: 'user-1', role: 'teacher' }, error: null },
  ];
  adminQueue.teacher_center = [
    { data: [{ center_id: 'center-A' }, { center_id: 'center-B' }], error: null },
  ];
}

const CENTER_ROWS = [
  { id: 'center-A', name: 'Alpha Center', center_code: 'CHQ-001' },
  { id: 'center-B', name: 'Beta Center', center_code: 'CHQ-002' },
];

beforeEach(() => {
  mockGetUser.mockReset();
  mockRpc.mockClear();
  mockSentryCaptureException.mockReset();
  mockSentryCaptureMessage.mockReset();
  adminQueue.users_teacher = [];
  adminQueue.teacher_center = [];
  adminQueue.teacher_subscriptions = [];
  adminQueue.centers = [];
  adminQueue.rpc = [];
});

describe('GET /api/teacher/context', () => {
  it('non-teacher: requireTeacherAuth failure passes through (403 NOT_A_TEACHER) and rpc is never called', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: VALID_USER }, error: null });
    adminQueue.users_teacher = [
      { data: { id: 'user-1', role: 'owner' }, error: null },
    ];

    const res = await GET(makeRequest());

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.error).toBe('Forbidden');
    expect(body.code).toBe('NOT_A_TEACHER');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('gate true: 200 state unified, hasPrivateAccess true, centers populated from the centers select', async () => {
    queueTeacherAuthOk();
    adminQueue.rpc = [{ data: true, error: null }];
    adminQueue.centers = [{ data: CENTER_ROWS, error: null }];

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      state: string;
      centers: { id: string; name: string; center_code: string }[];
      hasPrivateAccess: boolean;
    };
    expect(body.state).toBe('unified');
    expect(body.hasPrivateAccess).toBe(true);
    expect(body.centers).toEqual(CENTER_ROWS);
    expect(mockRpc).toHaveBeenCalledWith('teacher_private_access', {
      p_user_id: 'user-1',
    });
    // Gate true -> subscription presence is never consulted.
    expect(adminQueue.teacher_subscriptions.length).toBe(0);
  });

  it('gate false + subscription row exists: state lapsed, no subscription detail leaks', async () => {
    queueTeacherAuthOk();
    adminQueue.rpc = [{ data: false, error: null }];
    adminQueue.teacher_subscriptions = [
      { data: { status: 'suspended' }, error: null },
    ];
    adminQueue.centers = [{ data: CENTER_ROWS, error: null }];

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.state).toBe('lapsed');
    expect(body.hasPrivateAccess).toBe(false);
    // The state word is the ONLY subscription signal in the response.
    expect(JSON.stringify(body)).not.toContain('suspended');
  });

  it('gate false + no subscription row: state center_only', async () => {
    queueTeacherAuthOk();
    adminQueue.rpc = [{ data: false, error: null }];
    adminQueue.teacher_subscriptions = [{ data: null, error: null }];
    adminQueue.centers = [{ data: CENTER_ROWS, error: null }];

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: string; hasPrivateAccess: boolean };
    expect(body.state).toBe('center_only');
    expect(body.hasPrivateAccess).toBe(false);
  });

  // Regression (Rule 151): an infra error in the gate is NOT a state.
  it('regression: gate rpc errors -> 500 server_error + Sentry exception, never a state', async () => {
    queueTeacherAuthOk();
    adminQueue.rpc = [{ data: null, error: { message: 'db down' } }];

    const res = await GET(makeRequest());

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; code: string; state?: string };
    expect(body.code).toBe('server_error');
    expect(body.state).toBeUndefined();
    expect(mockSentryCaptureException).toHaveBeenCalled();
  });

  // Unknown != lapsed: a failed presence lookup must not invent a lapse (and
  // must not show the resume card to a never-subscribed teacher by accident).
  it('regression: gate false + subscription select errors -> state center_only + Sentry warning', async () => {
    queueTeacherAuthOk();
    adminQueue.rpc = [{ data: false, error: null }];
    adminQueue.teacher_subscriptions = [
      { data: null, error: { message: 'connection reset' } },
    ];
    adminQueue.centers = [{ data: CENTER_ROWS, error: null }];

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: string };
    expect(body.state).toBe('center_only');
    expect(mockSentryCaptureMessage).toHaveBeenCalledWith(
      expect.stringContaining('subscription-presence lookup failed'),
      'warning',
    );
  });

  it('centers display select errors -> 200 with centers [] + Sentry warning (display is best-effort)', async () => {
    queueTeacherAuthOk();
    adminQueue.rpc = [{ data: true, error: null }];
    adminQueue.centers = [
      { data: null, error: { message: 'column does not exist' } },
    ];

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: string; centers: unknown[] };
    expect(body.state).toBe('unified');
    expect(body.centers).toEqual([]);
    expect(mockSentryCaptureMessage).toHaveBeenCalledWith(
      expect.stringContaining('center-display lookup failed'),
      'warning',
    );
  });
});
