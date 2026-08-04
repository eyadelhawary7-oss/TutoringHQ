/**
 * The Valify webhook WITH credentials configured.
 *
 * This is the only route to verified state, so its behaviour under a valid
 * signature matters as much as its behaviour under a bad one. What is tested
 * here: the subject comes from OUR record and never from the payload; an
 * unrecognised payload is refused rather than guessed; and a failure to store
 * returns a status that makes Valify RETRY rather than silently dropping a real
 * outcome.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'crypto';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const SECRET = 'whsec_2b9e4a7c1f8d3e6a5c0b9d2f4e7a1c83';
const CENTER_ID = '11111111-1111-4111-8111-111111111111';
const ATTACKER_CENTER_ID = '99999999-9999-4999-8999-999999999999';

const state: {
  attemptRow: unknown;
  attemptError: unknown;
  upsertError: unknown;
  upserted: unknown[];
} = { attemptRow: null, attemptError: null, upsertError: null, upserted: [] };

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from(table: string) {
      const chain: Record<string, unknown> = {};
      Object.assign(chain, {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: state.attemptRow, error: state.attemptError }),
        upsert: async (row: unknown) => {
          if (table === 'verification_records') state.upserted.push(row);
          return { data: null, error: state.upsertError };
        },
      });
      return chain;
    },
  }),
}));

vi.mock('@sentry/nextjs', () => ({
  withScope: (fn: (s: unknown) => void) =>
    fn({ setTag: () => {}, setUser: () => {}, setLevel: () => {} }),
  captureException: () => {},
  captureMessage: () => {},
}));

import { POST } from '@/app/api/webhooks/valify/route';
import { VALIFY_ENV_KEYS } from '@/lib/valifyConfig';

const ORIGINAL: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of VALIFY_ENV_KEYS) {
    ORIGINAL[k] = process.env[k];
    delete process.env[k];
  }
  process.env.VALIFY_API_KEY = 'vk_live_8f3a91c2b7e04d5a9f1c6e2b8d4a7c30';
  process.env.VALIFY_BASE_URL = 'https://verify.valifysolutions.com';
  process.env.VALIFY_WEBHOOK_SECRET = SECRET;

  state.attemptRow = { subject_type: 'center', center_id: CENTER_ID, user_id: null };
  state.attemptError = null;
  state.upsertError = null;
  state.upserted = [];
});

afterEach(() => {
  for (const k of VALIFY_ENV_KEYS) {
    if (ORIGINAL[k] === undefined) delete process.env[k];
    else process.env[k] = ORIGINAL[k];
  }
});

function post(body: string, signature?: string): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (signature !== undefined) headers['x-valify-signature'] = signature;
  return POST(
    new Request('https://tutoringhq.app/api/webhooks/valify', {
      method: 'POST',
      headers,
      body,
    }),
  );
}

function sign(body: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

const PASS_BODY = JSON.stringify({
  reference_id: 'ref-1',
  transaction_id: 'vf-8823-0412',
  outcome: 'passed',
  data: { national_id: '29805150102345', full_name: 'Dina Fouad' },
});

describe('signature gate, with real credentials set', () => {
  it('401s an unsigned callback', async () => {
    expect((await post(PASS_BODY)).status).toBe(401);
    expect(state.upserted).toHaveLength(0);
  });

  it('401s a wrong signature and records NOTHING', async () => {
    const res = await post(PASS_BODY, sign(PASS_BODY, 'wrong-secret'));
    expect(res.status).toBe(401);
    expect(state.upserted).toHaveLength(0);
  });

  it('401s a signature computed over a DIFFERENT body', async () => {
    // The classic replay: a valid signature from an earlier callback pasted
    // onto a payload the attacker wrote.
    const otherBody = JSON.stringify({ reference_id: 'ref-1', outcome: 'failed' });
    expect((await post(PASS_BODY, sign(otherBody))).status).toBe(401);
    expect(state.upserted).toHaveLength(0);
  });

  it('accepts a correctly-signed pass and records verified', async () => {
    const res = await post(PASS_BODY, sign(PASS_BODY));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, state: 'verified' });

    expect(state.upserted).toHaveLength(1);
    expect(state.upserted[0]).toMatchObject({
      subject_type: 'center',
      center_id: CENTER_ID,
      state: 'verified',
      national_id: '29805150102345',
      legal_name: 'Dina Fouad',
    });
  });
});

describe('the subject comes from OUR record, never from the payload', () => {
  it('ignores a center_id supplied in the callback body', async () => {
    // A correctly-signed callback that also names a centre. Even with a valid
    // signature the payload must not be able to choose whose account is
    // verified — our attempt row is the only authority.
    const body = JSON.stringify({
      reference_id: 'ref-1',
      outcome: 'passed',
      center_id: ATTACKER_CENTER_ID,
      subject_type: 'center',
      data: { national_id: '29805150102345', full_name: 'Dina Fouad' },
    });

    const res = await post(body, sign(body));
    expect(res.status).toBe(200);

    const row = state.upserted[0] as Record<string, unknown>;
    expect(row.center_id).toBe(CENTER_ID);
    expect(row.center_id).not.toBe(ATTACKER_CENTER_ID);
  });

  it('404s a reference we never issued, and records nothing', async () => {
    state.attemptRow = null;

    const res = await post(PASS_BODY, sign(PASS_BODY));
    expect(res.status).toBe(404);
    expect((await res.json()).cause).toBe('attempt_not_found');
    expect(state.upserted).toHaveLength(0);
  });
});

describe('payloads the parser does not understand', () => {
  it('422s an unrecognised payload — NOT 200, so Valify retries', async () => {
    // A 200 would tell Valify we handled it and stop the retry, silently
    // losing a real verification outcome.
    const body = JSON.stringify({ reference_id: 'ref-1', mystery_field: 'who knows' });
    const res = await post(body, sign(body));

    expect(res.status).toBe(422);
    expect((await res.json()).cause).toBe('unrecognised_payload');
    expect(state.upserted).toHaveLength(0);
  });

  it('422s a payload with no reference', async () => {
    const body = JSON.stringify({ outcome: 'passed' });
    const res = await post(body, sign(body));
    expect(res.status).toBe(422);
    expect((await res.json()).cause).toBe('missing_reference');
  });

  it('422s malformed JSON', async () => {
    const body = 'not json at all';
    const res = await post(body, sign(body));
    expect(res.status).toBe(422);
    expect((await res.json()).cause).toBe('malformed_json');
  });
});

describe('a fail outcome', () => {
  it('records rejected and stores no identity data', async () => {
    const body = JSON.stringify({
      reference_id: 'ref-1',
      outcome: 'failed',
      data: { national_id: '29805150102345', full_name: 'Dina Fouad' },
    });

    const res = await post(body, sign(body));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ state: 'rejected' });

    const row = state.upserted[0] as Record<string, unknown>;
    expect(row.state).toBe('rejected');
    expect(row.national_id).toBeNull();
    expect(row.legal_name).toBeNull();
    expect(row.verified_at).toBeNull();
  });
});

describe('when the schema has not been applied', () => {
  it('500s so Valify RETRIES rather than dropping a real outcome', async () => {
    state.upsertError = {
      code: 'PGRST205',
      message: "Could not find the table 'public.verification_records' in the schema cache",
    };

    const res = await post(PASS_BODY, sign(PASS_BODY));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.cause).toBe('verification_schema_not_applied');
    // It never claims to have received-and-handled it.
    expect(body.received).toBeUndefined();
  });
});
