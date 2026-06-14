import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hashOtp } from '@/lib/teacherSignupOtp';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

type WriteResult = { error: { message: string } | null };
type CreateResult = { data: { user: { id: string } } | null; error: { message: string } | null };
type DupResult = { data: { id: string } | null; error: { message: string } | null };
type OtpResult = {
  data: { id: string; code_hash: string; attempts: number } | null;
  error: { message: string } | null;
};

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
// teacher_signup_otps spies.
const otpMaybeSingle = vi.fn<() => Promise<OtpResult>>();
const otpUpdateEq = vi.fn<() => Promise<WriteResult>>(async () => ({ error: null }));
const otpDeleteEq = vi.fn<() => Promise<WriteResult>>(async () => ({ error: null }));

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
    if (table === 'teacher_signup_otps') {
      return {
        select: () => ({
          eq: () => ({
            is: () => ({
              gt: () => ({
                order: () => ({ limit: () => ({ maybeSingle: otpMaybeSingle }) }),
              }),
            }),
          }),
        }),
        update: () => ({ eq: otpUpdateEq }),
        delete: () => ({ eq: otpDeleteEq }),
      };
    }
    throw new Error(`unexpected table in teacher-signup mock: ${table}`);
  },
};

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => adminClient,
}));

// Rate limiting is mocked: OTP verify is fail-CLOSED (needs getUpstashRedis truthy
// + a successful verify limiter). Both are controllable per test.
const mockRateLimit = vi.fn(async () => ({ success: true, remaining: 5, reset: 0 }));
const mockGetUpstashRedis = vi.fn<() => unknown>(() => ({}));
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: (...args: unknown[]) => mockRateLimit(...(args as [])),
  getUpstashRedis: () => mockGetUpstashRedis(),
  rateLimitExceededResponse: () =>
    new Response(JSON.stringify({ error: 'rate' }), { status: 429 }),
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

const VALID_CODE = '481923';
const VALID_BODY = {
  phone: '01012345678',
  pin: '837461',
  name: 'Ahmed Aly',
  subject: 'Physics',
  code: VALID_CODE,
  termsAccepted: true,
  privacyAccepted: true,
};
const NEW_USER = { data: { user: { id: 'new-user-1' } }, error: null };

function validOtpRow(attempts = 0): OtpResult {
  return { data: { id: 'otp-1', code_hash: hashOtp(VALID_CODE), attempts }, error: null };
}

beforeEach(() => {
  mockCreateUser.mockReset();
  mockDeleteUser.mockClear();
  usersDupMaybeSingle.mockReset();
  usersInsert.mockClear();
  usersDeleteEq.mockClear();
  profilesInsert.mockClear();
  otpMaybeSingle.mockReset();
  otpUpdateEq.mockClear();
  otpDeleteEq.mockClear();
  mockSentryCaptureException.mockReset();
  mockRateLimit.mockReset();
  mockGetUpstashRedis.mockReset();
  // Defaults: no duplicate, all inserts succeed, valid unexpired OTP present,
  // Upstash available, rate limit passes.
  usersDupMaybeSingle.mockResolvedValue({ data: null, error: null });
  usersInsert.mockResolvedValue({ error: null });
  profilesInsert.mockResolvedValue({ error: null });
  otpMaybeSingle.mockResolvedValue(validOtpRow());
  mockRateLimit.mockResolvedValue({ success: true, remaining: 5, reset: 0 });
  mockGetUpstashRedis.mockReturnValue({});
});

describe('POST /api/auth/teacher/signup', () => {
  it('happy path -> 201, createUser called with Rule 152 token fields = empty string (REGRESSION)', async () => {
    mockCreateUser.mockResolvedValueOnce(NEW_USER);

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(201);
    const body = (await res.json()) as { userId: string; planIntent: string | null };
    expect(body.userId).toBe('new-user-1');
    expect(body.planIntent).toBeNull();

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
    // No pro intent in the default body.
    expect(profilePayload.signup_plan_intent).toBeNull();

    // OTP consumed (verified_at set) after the account is committed.
    expect(otpUpdateEq).toHaveBeenCalled();
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
  });

  it('invalid phone -> 400 INVALID_PHONE, nothing created', async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, phone: '12345' }));

    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('INVALID_PHONE');
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('weak PIN -> 400 WEAK_PIN, nothing created', async () => {
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

  // --- OTP gate (ITEM 8) ---

  it('missing code -> 400 INVALID_CODE, no account created', async () => {
    const { code: _omit, ...noCode } = VALID_BODY;
    void _omit;
    const res = await POST(makeRequest(noCode));

    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('INVALID_CODE');
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('no Upstash (fail-CLOSED) -> 503, no account created', async () => {
    mockGetUpstashRedis.mockReturnValue(null);
    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: string }).code).toBe('VERIFICATION_UNAVAILABLE');
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('wrong code -> 400 OTP_INVALID, attempts incremented, no account created', async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, code: '000000' }));

    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('OTP_INVALID');
    expect(otpUpdateEq).toHaveBeenCalled(); // attempts bumped
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('expired / no OTP row -> 410 OTP_EXPIRED, no account created', async () => {
    otpMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(410);
    expect(((await res.json()) as { code: string }).code).toBe('OTP_EXPIRED');
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('too many attempts -> 429 OTP_TOO_MANY_ATTEMPTS, row deleted, no account', async () => {
    otpMaybeSingle.mockResolvedValueOnce(validOtpRow(4)); // 5th attempt
    const res = await POST(makeRequest({ ...VALID_BODY, code: '000000' }));

    expect(res.status).toBe(429);
    expect(((await res.json()) as { code: string }).code).toBe('OTP_TOO_MANY_ATTEMPTS');
    expect(otpDeleteEq).toHaveBeenCalled();
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  // --- pro intent (ITEM 1) ---

  it('planIntent pro -> persisted on teacher_profiles, returned, trial untouched', async () => {
    mockCreateUser.mockResolvedValueOnce(NEW_USER);
    const res = await POST(makeRequest({ ...VALID_BODY, planIntent: 'pro' }));

    expect(res.status).toBe(201);
    expect(((await res.json()) as { planIntent: string | null }).planIntent).toBe('pro');
    const profilePayload = profilesInsert.mock.calls[0][0] as Record<string, unknown>;
    expect(profilePayload.signup_plan_intent).toBe('pro');
    // No teacher_subscriptions write here: the trial is the DB trigger's job.
  });

  it('junk planIntent -> ignored (null), still creates account', async () => {
    mockCreateUser.mockResolvedValueOnce(NEW_USER);
    const res = await POST(makeRequest({ ...VALID_BODY, planIntent: 'xyz' }));

    expect(res.status).toBe(201);
    expect(((await res.json()) as { planIntent: string | null }).planIntent).toBeNull();
    const profilePayload = profilesInsert.mock.calls[0][0] as Record<string, unknown>;
    expect(profilePayload.signup_plan_intent).toBeNull();
  });

  // --- existing account-creation invariants (now behind a verified OTP) ---

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
