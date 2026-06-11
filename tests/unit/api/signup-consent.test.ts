import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
// No Upstash env -> rateLimit fails open (success: true).
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

// Capture the centers insert payload to assert consent columns are written.
const centerInsertSpy = vi.fn<(payload: Record<string, unknown>) => void>();

function makeCentersBuilder() {
  const selectChain = {
    eq: () => selectChain,
    limit: () => selectChain,
    maybeSingle: async () => ({ data: null, error: null }),
  };
  return {
    select: () => selectChain,
    insert: (payload: Record<string, unknown>) => {
      centerInsertSpy(payload);
      return {
        select: () => ({
          single: async () => ({ data: { id: 'center-1' }, error: null }),
        }),
      };
    },
  };
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: () => makeCentersBuilder() }),
}));

import { POST } from '@/app/api/signup/route';

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// initiatePayment omitted -> the non-payment branch (no Paymob), which still
// inserts the center row with consent timestamps.
const VALID_BODY = {
  centerName: 'Al Noor Center',
  ownerName: 'Mona Said',
  phone: '01012345678',
  email: 'mona@example.com',
  city: 'cairo',
  plan: 'starter',
  billingPeriod: 'quarterly',
  termsAccepted: true,
  privacyAccepted: true,
};

beforeEach(() => {
  centerInsertSpy.mockClear();
});

describe('POST /api/signup (PDPL consent)', () => {
  it('termsAccepted missing -> 400 CONSENT_REQUIRED, no center created', async () => {
    const { termsAccepted: _omit, ...noTerms } = VALID_BODY;
    void _omit;
    const res = await POST(makeRequest(noTerms));

    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('CONSENT_REQUIRED');
    expect(centerInsertSpy).not.toHaveBeenCalled();
  });

  it('privacyAccepted missing -> 400 CONSENT_REQUIRED, no center created', async () => {
    const { privacyAccepted: _omit, ...noPrivacy } = VALID_BODY;
    void _omit;
    const res = await POST(makeRequest(noPrivacy));

    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('CONSENT_REQUIRED');
    expect(centerInsertSpy).not.toHaveBeenCalled();
  });

  it('both consents false -> 400 CONSENT_REQUIRED, no center created', async () => {
    const res = await POST(
      makeRequest({ ...VALID_BODY, termsAccepted: false, privacyAccepted: false }),
    );

    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('CONSENT_REQUIRED');
    expect(centerInsertSpy).not.toHaveBeenCalled();
  });

  it('happy path with both true -> success, consent columns written to centers insert', async () => {
    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(200);
    expect(((await res.json()) as { success: boolean }).success).toBe(true);

    expect(centerInsertSpy).toHaveBeenCalledTimes(1);
    const payload = centerInsertSpy.mock.calls[0][0];
    expect(payload.policy_version).toBe('1.0');
    expect(typeof payload.policy_accepted_at).toBe('string');
    expect(typeof payload.terms_accepted_at).toBe('string');
  });
});
