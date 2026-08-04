/**
 * ============================================================================
 * THE FAILURE-PATH TEST. This is the one that matters.
 * ============================================================================
 * With the single config point unset, and again with it holding the literal
 * placeholders that `.env.example` actually ships, EVERY entry point must:
 *
 *   1. refuse — no silent no-op, no optimistic success, no swallowed error
 *   2. name the cause — `valify_not_configured`, machine-readable and stable
 *   3. say so legibly to the user, in both locales
 *   4. never assert verification anywhere in the response
 *
 * Requirement 4 is checked mechanically as well as specifically: each response
 * body is scanned so that no field anywhere in it can be read as a claim of
 * success. A green checkmark backed by no integration is the worst possible
 * outcome of this work, and this test is what stops one appearing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'crypto';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.NEXT_PUBLIC_APP_URL = 'https://tutoringhq.app';

const CENTER_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

/**
 * Auth is stubbed as SUCCEEDING throughout. That is deliberate: it proves the
 * refusals below come from the Valify guard and not incidentally from an auth
 * failure. A test where auth also fails would pass for the wrong reason.
 */
const supabaseAdminStub = {
  from() {
    throw new Error(
      'The database must NOT be reached while unconfigured. The guard should have refused first.',
    );
  },
};

vi.mock('@/lib/centerAuth', () => ({
  requireCenterAuth: vi.fn(async () => ({
    ok: true as const,
    userId: USER_ID,
    centerId: CENTER_ID,
    role: 'owner',
    supabaseAdmin: supabaseAdminStub,
  })),
  requireTeacherAuth: vi.fn(async () => ({
    ok: true as const,
    userId: USER_ID,
    centerIds: [],
    supabaseAdmin: supabaseAdminStub,
  })),
}));

// CSRF passes, for the same reason auth does.
vi.mock('@/lib/csrf', () => ({ validateCSRFRequest: () => true }));

vi.mock('@sentry/nextjs', () => ({
  withScope: (fn: (s: unknown) => void) =>
    fn({ setTag: () => {}, setUser: () => {}, setLevel: () => {} }),
  captureException: () => {},
  captureMessage: () => {},
}));

import { POST as startPOST } from '@/app/api/verification/start/route';
import { GET as statusGET } from '@/app/api/verification/status/route';
import { GET as returnGET } from '@/app/api/verification/return/route';
import { POST as webhookPOST } from '@/app/api/webhooks/valify/route';
import { VALIFY_ENV_KEYS } from '@/lib/valifyConfig';

import type { NextRequest } from 'next/server';

const ORIGINAL: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of VALIFY_ENV_KEYS) {
    ORIGINAL[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of VALIFY_ENV_KEYS) {
    if (ORIGINAL[k] === undefined) delete process.env[k];
    else process.env[k] = ORIGINAL[k];
  }
});

/** The two states the config point can be in today. Both must refuse. */
const UNCONFIGURED_MODES: [string, () => void][] = [
  ['config point entirely UNSET', () => {}],
  [
    'config point holding the literal PLACEHOLDERS from .env.example',
    () => {
      for (const k of VALIFY_ENV_KEYS) process.env[k] = 'placeholder';
    },
  ],
];

function req(path: string, init?: RequestInit): NextRequest {
  return new Request(`https://tutoringhq.app${path}`, {
    headers: { Authorization: 'Bearer fake-token', ...(init?.headers ?? {}) },
    ...init,
  }) as unknown as NextRequest;
}

/**
 * Assert that nothing in a response body can be read as a claim of success.
 * Deliberately blunt: it walks the whole object rather than checking named
 * fields, so a future field called `ok`, `verified` or `success` cannot slip a
 * truthy success signal in unnoticed.
 */
function expectNoSuccessClaim(body: unknown): void {
  const CLAIM_KEYS = ['verified', 'isverified', 'success', 'ok', 'approved', 'complete'];
  const walk = (node: unknown, path: string): void => {
    if (node == null) return;
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, `${path}[${i}]`));
      return;
    }
    if (typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (CLAIM_KEYS.includes(k.toLowerCase()) && v === true) {
        throw new Error(`Response claims success at ${path}.${k} === true`);
      }
      if (k.toLowerCase() === 'state' && v === 'verified') {
        throw new Error(`Response claims state 'verified' at ${path}.${k}`);
      }
      walk(v, `${path}.${k}`);
    }
  };
  walk(body, '$');
}

describe.each(UNCONFIGURED_MODES)('ENTRY POINTS with the %s', (_label, applyMode) => {
  beforeEach(() => applyMode());

  it('POST /api/verification/start refuses 503 with the named cause and bilingual copy', async () => {
    const res = await startPOST(
      req('/api/verification/start', { method: 'POST', body: '{}' }),
    );

    expect(res.status).toBe(503);

    const body = await res.json();
    expect(body.cause).toBe('valify_not_configured');
    expect(body.verified).toBe(false);
    expect(body.state).toBe('unconfigured');
    expect(body.message.en).toMatch(/not available yet/i);
    expect(body.message.ar).toMatch(/[؀-ۿ]/);

    // No link, under any name.
    expect(body).not.toHaveProperty('redirectUrl');
    expect(JSON.stringify(body)).not.toMatch(/valifysolutions|session_token/i);
    expectNoSuccessClaim(body);

    // Operator-facing header names the exact keys to set.
    expect(res.headers.get('X-Verification-Cause')).toBe('valify_not_configured');
    expect(res.headers.get('X-Verification-Missing-Config')).toContain('VALIFY_API_KEY');
  });

  it('GET /api/verification/status reports unconfigured and isVerified false', async () => {
    const res = await statusGET(req('/api/verification/status'));

    // 200 here is correct and deliberate: "we cannot verify anyone" is a
    // complete, successfully-computed answer. The BODY carries the refusal.
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.state).toBe('unconfigured');
    expect(body.cause).toBe('valify_not_configured');
    expect(body.isVerified).toBe(false);
    expect(body.canStartVerification).toBe(false);
    expect(body.verifiedAt).toBeNull();
    expect(body.message.en.length).toBeGreaterThan(20);
    expect(body.message.ar).toMatch(/[؀-ۿ]/);

    // Nothing is unlocked.
    expect(body.capabilities).toEqual({
      onlineCollection: false,
      withdrawals: false,
      automatedFeeCollection: false,
    });

    // The sensitive columns are never returned by this endpoint, in any state.
    expect(body).not.toHaveProperty('nationalId');
    expect(body).not.toHaveProperty('legalName');
    expectNoSuccessClaim(body);
  });

  it('GET /api/verification/return redirects carrying the unconfigured state, never a success', async () => {
    const res = await returnGET(req('/api/verification/return?ref=abc'));

    expect(res.status).toBe(307);
    const location = res.headers.get('location') ?? '';
    const url = new URL(location);

    expect(url.pathname).toBe('/ar/settings');
    expect(url.searchParams.get('verification')).toBe('unconfigured');
    expect(url.searchParams.get('cause')).toBe('valify_not_configured');
    expect(url.searchParams.get('verification')).not.toBe('verified');
  });

  it('POST /api/webhooks/valify 401s every callback, however it is signed', async () => {
    const payload = JSON.stringify({
      reference_id: 'r1',
      outcome: 'passed',
      data: { national_id: '29805150102345', full_name: 'Dina Fouad' },
    });

    // Unsigned, signed with the placeholder secret (which anyone reading
    // .env.example knows), and signed with a guessed secret. All rejected.
    const attempts: (string | undefined)[] = [
      undefined,
      createHmac('sha256', 'placeholder').update(payload).digest('hex'),
      createHmac('sha256', 'guess').update(payload).digest('hex'),
    ];

    for (const sig of attempts) {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (sig) headers['x-valify-signature'] = sig;

      const res = await webhookPOST(
        new Request('https://tutoringhq.app/api/webhooks/valify', {
          method: 'POST',
          headers,
          body: payload,
        }),
      );

      expect(res.status).toBe(401);
      const body = await res.json();
      expectNoSuccessClaim(body);
      // The response does NOT tell an anonymous caller that our provider is
      // unconfigured — that is free reconnaissance. The named cause goes to
      // our logs instead.
      expect(JSON.stringify(body)).not.toMatch(/valify_not_configured/);
    }
  });
});

describe('the refusal is not incidental to auth or CSRF', () => {
  beforeEach(() => {
    for (const k of VALIFY_ENV_KEYS) process.env[k] = 'placeholder';
  });

  it('start refuses BEFORE it ever touches the database', async () => {
    // supabaseAdminStub.from() throws. Reaching 503 rather than that error
    // proves the guard short-circuited ahead of every query.
    const res = await startPOST(req('/api/verification/start', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(503);
  });

  it('status refuses BEFORE it ever touches the database', async () => {
    const res = await statusGET(req('/api/verification/status'));
    expect(res.status).toBe(200);
    expect((await res.json()).isVerified).toBe(false);
  });
});

describe('a partially-configured deploy is still unconfigured', () => {
  it('two real credentials and one placeholder still refuses, naming the one', async () => {
    // The likeliest real-world half-state: someone pastes the API key and base
    // URL from Valify's onboarding email and forgets the webhook secret. The
    // webhook secret is the trust anchor, so this MUST refuse.
    process.env.VALIFY_API_KEY = 'vk_live_8f3a91c2b7e04d5a9f1c6e2b8d4a7c30';
    process.env.VALIFY_BASE_URL = 'https://verify.valifysolutions.com';
    process.env.VALIFY_WEBHOOK_SECRET = 'placeholder';

    const res = await startPOST(req('/api/verification/start', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(503);
    expect(res.headers.get('X-Verification-Missing-Config')).toBe('VALIFY_WEBHOOK_SECRET');

    const body = await res.json();
    expect(body.verified).toBe(false);
    expectNoSuccessClaim(body);
  });
});
