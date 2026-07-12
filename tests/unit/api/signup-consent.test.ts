import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.CSRF_SECRET = 'test-csrf-secret-value-at-least-32-characters-long';
// Rate limiting now fails CLOSED without Upstash; mock it to pass so these specs
// exercise the consent/signup logic, not the limiter (covered separately in
// rateLimitFailClosed.test.ts).
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
vi.mock('@/lib/ratelimit', () => ({
  getClientIp: () => '127.0.0.1',
  rateLimit: vi.fn().mockResolvedValue({ success: true, remaining: 3, reset: 0 }),
  rateLimitExceededResponse: vi.fn(),
}));

// Hoisted, mutable mock state (referenced by the hoisted vi.mock factories).
const h = vi.hoisted(() => ({
  centerInsertSpy: vi.fn<(payload: Record<string, unknown>) => void>(),
  // Configurable per test: trial_claims.insert() result ({error:null} = phone free).
  trialClaimsInsert: { error: null as null | { code: string } },
}));

// Trial-first signup provisions the owner and reads summer config; both hit
// server-only DB paths, so mock them to keep the route unit-testable.
vi.mock('@/lib/centerOwnerProvision', () => ({
  provisionCenterOwner: vi.fn(async () => 'user-1'),
}));
vi.mock('@/lib/summer/config', () => ({
  getSummerConfig: vi.fn(async () => ({
    enabled: true,
    freeUntil: '2026-08-16',
    firstChargeFloor: '2026-08-30',
    trialDays: 14,
    payWindowDays: 2,
    firstChargeRelease: 'HELD',
  })),
}));

function genericBuilder() {
  const c: Record<string, unknown> = {};
  const self = () => c;
  Object.assign(c, {
    select: self,
    update: self,
    delete: self,
    eq: self,
    neq: self,
    in: self,
    is: self,
    not: self,
    or: self,
    order: self,
    limit: self,
    gte: self,
    lte: self,
    lt: self,
    gt: self,
    insert: async () => ({ data: null, error: null }),
    upsert: async () => ({ data: null, error: null }),
    single: async () => ({ data: null, error: null }),
    maybeSingle: async () => ({ data: null, error: null }),
    then: (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null }),
  });
  return c;
}

// centers: blacklist select -> maybeSingle null; insert -> single {id}.
function centersBuilder() {
  const selectChain = {
    eq: () => selectChain,
    limit: () => selectChain,
    maybeSingle: async () => ({ data: null, error: null }),
  };
  return {
    select: () => selectChain,
    insert: (payload: Record<string, unknown>) => {
      h.centerInsertSpy(payload);
      return { select: () => ({ single: async () => ({ data: { id: 'center-1' }, error: null }) }) };
    },
  };
}

// trial_claims: insert is the atomic one-per-phone lock; update/delete are await-only.
function trialClaimsBuilder() {
  return {
    insert: async () => h.trialClaimsInsert,
    update: () => ({ eq: async () => ({ error: null }) }),
    delete: () => ({ eq: async () => ({ error: null }) }),
  };
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === 'centers') return centersBuilder();
      if (table === 'trial_claims') return trialClaimsBuilder();
      return genericBuilder();
    },
    auth: {
      admin: {
        createUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }),
        deleteUser: async () => ({ error: null }),
      },
    },
  }),
}));

import { POST } from '@/app/api/signup/route';

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  centerName: 'Al Noor Center',
  ownerName: 'Mona Said',
  phone: '01012345678',
  email: 'mona@example.com',
  city: 'cairo',
  plan: 'starter',
  billingPeriod: 'monthly',
  termsAccepted: true,
  privacyAccepted: true,
};

beforeEach(() => {
  h.centerInsertSpy.mockClear();
  h.trialClaimsInsert = { error: null };
});

describe('POST /api/signup (PDPL consent)', () => {
  it('termsAccepted missing -> 400 CONSENT_REQUIRED, no center created', async () => {
    const { termsAccepted: _omit, ...noTerms } = VALID_BODY;
    void _omit;
    const res = await POST(makeRequest(noTerms));

    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('CONSENT_REQUIRED');
    expect(h.centerInsertSpy).not.toHaveBeenCalled();
  });

  it('privacyAccepted missing -> 400 CONSENT_REQUIRED, no center created', async () => {
    const { privacyAccepted: _omit, ...noPrivacy } = VALID_BODY;
    void _omit;
    const res = await POST(makeRequest(noPrivacy));

    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('CONSENT_REQUIRED');
    expect(h.centerInsertSpy).not.toHaveBeenCalled();
  });

  it('both consents false -> 400 CONSENT_REQUIRED, no center created', async () => {
    const res = await POST(
      makeRequest({ ...VALID_BODY, termsAccepted: false, privacyAccepted: false }),
    );

    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('CONSENT_REQUIRED');
    expect(h.centerInsertSpy).not.toHaveBeenCalled();
  });
});

describe('POST /api/signup (trial-first)', () => {
  it('happy path -> 200 pinSetup, billing-neutral trial center + consent columns', async () => {
    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; pinSetup: boolean };
    expect(body.success).toBe(true);
    expect(body.pinSetup).toBe(true);

    expect(h.centerInsertSpy).toHaveBeenCalledTimes(1);
    const payload = h.centerInsertSpy.mock.calls[0][0];
    // Consent columns.
    expect(payload.policy_version).toBe('1.0');
    expect(typeof payload.policy_accepted_at).toBe('string');
    expect(typeof payload.terms_accepted_at).toBe('string');
    // Trial-first: active + enrolled + billing neutralised (no charge at signup).
    expect(payload.status).toBe('active');
    expect(payload.summer_status).toBe('enrolled');
    expect(payload.next_payment_due).toBeNull();
    expect(payload.auto_suspend_at).toBeNull();
  });

  it('one free trial per phone -> 23505 on trial_claims -> 400 phone_exists, no center', async () => {
    h.trialClaimsInsert = { error: { code: '23505' } };
    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('phone_exists');
    expect(h.centerInsertSpy).not.toHaveBeenCalled();
  });
});
