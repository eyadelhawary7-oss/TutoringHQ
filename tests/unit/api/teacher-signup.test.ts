import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
// No Upstash env -> rateLimit fails open (success: true) for these tests.
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

type WriteResult = { error: { message: string } | null };
type CreateResult = { data: { user: { id: string } } | null; error: { message: string } | null };
type DupResult = { data: { id: string } | null; error: { message: string } | null };

const mockCreateUser = vi.fn<(attrs: Record<string, unknown>) => Promise<CreateResult>>();
const mockDeleteUser = vi.fn<(id: string) => Promise<{ data: null; error: null }>>(
  async () => ({ data: null, error: null }),
);

// Per-table insert/select/delete spies.
const usersDupMaybeSingle = vi.fn<() => Promise<DupResult>>();
const usersInsert = vi.fn<(payload: Record<string, unknown>) => Promise<WriteResult>>(
  async () => ({ error: null }),
);
const usersDeleteEq = vi.fn<(col: string, val: unknown) => Promise<WriteResult>>(
  async () => ({ error: null }),
);
const profilesInsert = vi.fn<(payload: Record<string, unknown>) => Promise<WriteResult>>(
  async () => ({ error: null }),
);

const adminClient = {
  auth: { admin: { createUser: mockCreateUser, deleteUser: mockDeleteUser } },
  from: (table: string) => {
    if (table === 'users') {
      return {
        select: () => ({
          eq: () => ({ limit: () => ({ maybeSingle: usersDupMaybeSingle }) }),
        }),
        insert: usersInsert,
        delete: () => ({ eq: usersDeleteEq }),
      };
    }
    if (table === 'teacher_profiles') {
      return { insert: profilesInsert };
    }
    throw new Error(`unexpected table in teacher-signup mock: ${table}`);
  },
};

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => adminClient,
}));

const mockSentryCaptureException = vi.fn();
vi.mock('@sentry/nextjs', () => ({
  withScope: (fn: (s: { setTag: (k: string, v: string) => void }) => void) => {
    fn({ setTag: () => undefined });
  },
  captureException: (err: unknown) => mockSentryCaptureException(err),
  captureMessage: vi.fn(),
}));

import { POST } from '@/app/api/auth/teacher/signup/route';

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/auth/teacher/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  phone: '01012345678',
  pin: '837461',
  name: 'Ahmed Aly',
  subject: 'Physics',
  termsAccepted: true,
  privacyAccepted: true,
};
const NEW_USER = { data: { user: { id: 'new-user-1' } }, error: null };

beforeEach(() => {
  mockCreateUser.mockReset();
  mockDeleteUser.mockClear();
  usersDupMaybeSingle.mockReset();
  usersInsert.mockClear();
  usersDeleteEq.mockClear();
  profilesInsert.mockClear();
  mockSentryCaptureException.mockReset();
  // Defaults: no duplicate, all inserts succeed.
  usersDupMaybeSingle.mockResolvedValue({ data: null, error: null });
  usersInsert.mockResolvedValue({ error: null });
  profilesInsert.mockResolvedValue({ error: null });
});

describe('POST /api/auth/teacher/signup', () => {
  it('happy path -> 201, createUser called with Rule 152 token fields = empty string (REGRESSION)', async () => {
    mockCreateUser.mockResolvedValueOnce(NEW_USER);

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(201);
    const body = (await res.json()) as { userId: string };
    expect(body.userId).toBe('new-user-1');

    expect(mockCreateUser).toHaveBeenCalledTimes(1);
    const attrs = mockCreateUser.mock.calls[0][0] as Record<string, unknown>;
    // Rule 152: the four GoTrue token fields MUST be '' (never null).
    expect(attrs.confirmation_token).toBe('');
    expect(attrs.recovery_token).toBe('');
    expect(attrs.email_change_token_new).toBe('');
    expect(attrs.email_change).toBe('');
    // PIN is the password; email is the normalized phone.
    expect(attrs.password).toBe('837461');
    expect(attrs.email).toBe('201012345678@centerhq.local');
    expect(attrs.email_confirm).toBe(true);

    // PDPL: consent timestamps written to the teacher_profiles insert.
    const profilePayload = profilesInsert.mock.calls[0][0] as Record<string, unknown>;
    expect(profilePayload.policy_version).toBe('1.0');
    expect(typeof profilePayload.policy_accepted_at).toBe('string');
    expect(typeof profilePayload.terms_accepted_at).toBe('string');
  });

  it('termsAccepted missing -> 400 CONSENT_REQUIRED, no account created', async () => {
    const { termsAccepted: _omit, ...noTerms } = VALID_BODY;
    void _omit;
    const res = await POST(makeRequest(noTerms));

    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('CONSENT_REQUIRED');
    expect(mockCreateUser).not.toHaveBeenCalled();
    expect(usersInsert).not.toHaveBeenCalled();
    expect(profilesInsert).not.toHaveBeenCalled();
  });

  it('privacyAccepted missing -> 400 CONSENT_REQUIRED, no account created', async () => {
    const { privacyAccepted: _omit, ...noPrivacy } = VALID_BODY;
    void _omit;
    const res = await POST(makeRequest(noPrivacy));

    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('CONSENT_REQUIRED');
    expect(mockCreateUser).not.toHaveBeenCalled();
    expect(usersInsert).not.toHaveBeenCalled();
    expect(profilesInsert).not.toHaveBeenCalled();
  });

  it('both consents false -> 400 CONSENT_REQUIRED, no account created', async () => {
    const res = await POST(
      makeRequest({ ...VALID_BODY, termsAccepted: false, privacyAccepted: false }),
    );

    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('CONSENT_REQUIRED');
    expect(mockCreateUser).not.toHaveBeenCalled();
    expect(usersInsert).not.toHaveBeenCalled();
  });

  it('invalid phone -> 400 INVALID_PHONE, nothing created', async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, phone: '12345' }));

    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('INVALID_PHONE');
    expect(mockCreateUser).not.toHaveBeenCalled();
    expect(usersInsert).not.toHaveBeenCalled();
  });

  it('weak PIN -> 400 WEAK_PIN, nothing created', async () => {
    // 123456 is on the weak-PIN reject list.
    const res = await POST(makeRequest({ ...VALID_BODY, pin: '123456' }));

    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('WEAK_PIN');
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('short name -> 400 INVALID_NAME, nothing created', async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, name: 'A' }));

    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('INVALID_NAME');
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('duplicate phone (existing users row) -> 409 PHONE_ALREADY_REGISTERED, no createUser', async () => {
    usersDupMaybeSingle.mockResolvedValueOnce({ data: { id: 'existing' }, error: null });

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('PHONE_ALREADY_REGISTERED');
    expect(mockCreateUser).not.toHaveBeenCalled();
    expect(usersInsert).not.toHaveBeenCalled();
  });

  it('createUser duplicate-email error -> 409 PHONE_ALREADY_REGISTERED', async () => {
    mockCreateUser.mockResolvedValueOnce({
      data: null,
      error: { message: 'A user with this email address has already been registered' },
    });

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('PHONE_ALREADY_REGISTERED');
    expect(usersInsert).not.toHaveBeenCalled();
  });

  it('createUser fails (other error) -> 500, no public.users insert', async () => {
    mockCreateUser.mockResolvedValueOnce({ data: null, error: { message: 'gotrue down' } });

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(500);
    expect(usersInsert).not.toHaveBeenCalled();
    expect(mockSentryCaptureException).toHaveBeenCalled();
  });

  it('public.users insert fails -> 500, auth.users cleanup attempted (deleteUser with created id)', async () => {
    mockCreateUser.mockResolvedValueOnce(NEW_USER);
    usersInsert.mockResolvedValueOnce({ error: { message: 'users insert failed' } });

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(500);
    expect(mockDeleteUser).toHaveBeenCalledWith('new-user-1');
    expect(profilesInsert).not.toHaveBeenCalled();
    expect(mockSentryCaptureException).toHaveBeenCalled();
  });

  it('teacher_profiles insert fails -> 500, BOTH cleanups attempted', async () => {
    mockCreateUser.mockResolvedValueOnce(NEW_USER);
    profilesInsert.mockResolvedValueOnce({ error: { message: 'profile insert failed' } });

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(500);
    // public.users row deleted...
    expect(usersDeleteEq).toHaveBeenCalled();
    // ...and the auth.users row deleted.
    expect(mockDeleteUser).toHaveBeenCalledWith('new-user-1');
    expect(mockSentryCaptureException).toHaveBeenCalled();
  });

  it('role is always teacher and center_id null, regardless of body', async () => {
    mockCreateUser.mockResolvedValueOnce(NEW_USER);
    // Body tries to smuggle a privileged role and a center.
    const res = await POST(
      makeRequest({ ...VALID_BODY, role: 'owner', center_id: 'victim-center' }),
    );

    expect(res.status).toBe(201);
    const insertPayload = usersInsert.mock.calls[0][0] as Record<string, unknown>;
    expect(insertPayload.role).toBe('teacher');
    expect(insertPayload.center_id).toBeNull();
    // The smuggled fields never reach the insert.
    expect(insertPayload).not.toHaveProperty('owner');
  });
});
