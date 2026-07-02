import { describe, it, expect, vi, beforeEach } from 'vitest';
import { normalizePhone } from '@/lib/utils/phone';

type InsertOutcome = { data: { id: string } | null; error: { message: string } | null };

// Controllable rate-limit + insert spies.
const mockRateLimit = vi.fn<
  () => Promise<{ success: boolean; remaining: number; reset: number }>
>(async () => ({ success: true, remaining: 5, reset: 0 }));

// Outcome of privacy_requests insert(...).select('id').single(). The route now
// chains .select('id').single() to read back the new id, so the insert spy
// returns that chain and this fn controls its resolved value.
const privacyInsertOutcome = vi.fn<() => Promise<InsertOutcome>>(
  async () => ({ data: { id: 'stub-request-id' }, error: null }),
);

// Payload-capturing insert spy; returns the .select('id').single() chain.
const privacyInsert = vi.fn((_payload: Record<string, unknown>) => ({
  select: () => ({ single: () => privacyInsertOutcome() }),
}));

// The route also best-effort raises an admin alert + in-app notifications to
// every admin after a successful insert (H8). Stub those tables so that path
// runs without hitting the unexpected-table guard.
const adminAlertsInsert = vi.fn(async () => ({ error: null }));
const adminUsersSelect = vi.fn(async () => ({ data: [{ id: 'admin-1' }], error: null }));
const inAppInsert = vi.fn(async () => ({ error: null }));

const adminClient = {
  from: (table: string) => {
    switch (table) {
      case 'privacy_requests':
        return { insert: privacyInsert };
      case 'admin_alerts':
        return { insert: adminAlertsInsert };
      case 'admin_users':
        return { select: adminUsersSelect };
      case 'in_app_notifications':
        return { insert: inAppInsert };
      default:
        throw new Error(`unexpected table in privacy-request mock: ${table}`);
    }
  },
};

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => adminClient,
}));

vi.mock('@/lib/ratelimit', () => ({
  getClientIp: () => 'test-ip',
  rateLimit: () => mockRateLimit(),
  rateLimitExceededResponse: () =>
    new Response(JSON.stringify({ error: 'rate_limited' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    }),
}));

const mockSentryCaptureException = vi.fn();
vi.mock('@sentry/nextjs', () => ({
  withScope: (fn: (s: { setTag: (k: string, v: string) => void }) => void) => {
    fn({ setTag: () => undefined });
  },
  captureException: (err: unknown) => mockSentryCaptureException(err),
  captureMessage: vi.fn(),
}));

import { POST } from '@/app/api/privacy-request/route';

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/privacy-request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  name: 'Mona Said',
  phone: '01012345678',
  email: 'mona@example.com',
  requestType: 'deletion',
  message: 'Please delete my data.',
};

beforeEach(() => {
  mockRateLimit.mockReset();
  mockRateLimit.mockResolvedValue({ success: true, remaining: 5, reset: 0 });
  privacyInsert.mockClear();
  privacyInsertOutcome.mockReset();
  privacyInsertOutcome.mockResolvedValue({ data: { id: 'stub-request-id' }, error: null });
  adminAlertsInsert.mockClear();
  adminUsersSelect.mockClear();
  inAppInsert.mockClear();
  mockSentryCaptureException.mockReset();
});

describe('POST /api/privacy-request', () => {
  it('happy path -> 201, inserts correctly mapped fields into privacy_requests', async () => {
    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(201);
    expect(((await res.json()) as { message: string }).message).toBe('Request received');

    expect(privacyInsert).toHaveBeenCalledTimes(1);
    const payload = privacyInsert.mock.calls[0][0];
    expect(payload.full_name).toBe('Mona Said');
    expect(payload.phone).toBe(normalizePhone('01012345678'));
    expect(payload.email).toBe('mona@example.com');
    // request_types is an array column - the single form value is wrapped.
    expect(payload.request_types).toEqual(['deletion']);
    expect(payload.description).toBe('Please delete my data.');
    expect(payload.status).toBe('pending');
  });

  it('rate limit exceeded -> 429, no insert', async () => {
    mockRateLimit.mockResolvedValueOnce({ success: false, remaining: 0, reset: 0 });

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(429);
    expect(privacyInsert).not.toHaveBeenCalled();
  });

  it('missing name -> 400, no insert', async () => {
    const { name: _omit, ...noName } = VALID_BODY;
    void _omit;
    const res = await POST(makeRequest(noName));

    expect(res.status).toBe(400);
    expect(privacyInsert).not.toHaveBeenCalled();
  });

  it('missing phone -> 400, no insert', async () => {
    const { phone: _omit, ...noPhone } = VALID_BODY;
    void _omit;
    const res = await POST(makeRequest(noPhone));

    expect(res.status).toBe(400);
    expect(privacyInsert).not.toHaveBeenCalled();
  });

  it('invalid requestType -> 400, no insert', async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, requestType: 'sell_my_data' }));

    expect(res.status).toBe(400);
    expect(privacyInsert).not.toHaveBeenCalled();
  });

  it('insert error -> 500 server_error + Sentry, not 201', async () => {
    privacyInsertOutcome.mockResolvedValueOnce({ data: null, error: { message: 'insert failed' } });

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(500);
    expect(((await res.json()) as { code: string }).code).toBe('server_error');
    expect(mockSentryCaptureException).toHaveBeenCalled();
  });

  it('status is always pending regardless of body', async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, status: 'approved' }));

    expect(res.status).toBe(201);
    const payload = privacyInsert.mock.calls[0][0];
    expect(payload.status).toBe('pending');
  });
});
