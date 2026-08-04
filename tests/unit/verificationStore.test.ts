/**
 * The persistence layer, and specifically the F26 case.
 *
 * `verification_records` and `verification_attempts` DO NOT EXIST in the live
 * database — verified against project lczmjpnbuhnsislcvzar on 4 August 2026.
 * The migration is a proposal Eyad applies by hand. So the code on this branch
 * can be deployed while the tables are absent, and what happens then is not
 * incidental: it must be a NAMED refusal, never an opaque 500 and never a
 * silent "not verified yet".
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { VALIFY_ENV_KEYS } from '@/lib/valifyConfig';
import {
  VerificationStoreError,
  getEffectiveVerification,
  isMissingRelation,
  persistVerificationOutcome,
  recordAttemptStarted,
  resolveSubjectForReference,
} from '@/lib/verificationStore';

const CENTER_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

const ORIGINAL: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of VALIFY_ENV_KEYS) {
    ORIGINAL[k] = process.env[k];
    delete process.env[k];
  }
  // Most of these tests need the guard SATISFIED, so that what they exercise is
  // the schema gate rather than the credential gate.
  process.env.VALIFY_API_KEY = 'vk_live_8f3a91c2b7e04d5a9f1c6e2b8d4a7c30';
  process.env.VALIFY_BASE_URL = 'https://verify.valifysolutions.com';
  process.env.VALIFY_WEBHOOK_SECRET = 'whsec_2b9e4a7c1f8d3e6a5c0b9d2f4e7a1c83';
});

afterEach(() => {
  for (const k of VALIFY_ENV_KEYS) {
    if (ORIGINAL[k] === undefined) delete process.env[k];
    else process.env[k] = ORIGINAL[k];
  }
});

/** The error PostgREST actually returns for a table that is not there. */
const UNDEFINED_TABLE = {
  code: 'PGRST205',
  message:
    "Could not find the table 'public.verification_records' in the schema cache",
};

interface StubResult {
  data: unknown;
  error: unknown;
}

/** Minimal Supabase stub: records the calls and returns a canned result. */
function stubClient(result: StubResult, captured: { rows: unknown[] } = { rows: [] }) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  Object.assign(chain, {
    select: self,
    eq: self,
    maybeSingle: async () => result,
    insert: async (row: unknown) => {
      captured.rows.push(row);
      return result;
    },
    upsert: async (row: unknown) => {
      captured.rows.push(row);
      return result;
    },
  });
  return {
    client: { from: () => chain } as unknown as SupabaseClient,
    captured,
  };
}

describe('isMissingRelation', () => {
  it('recognises the PostgREST schema-cache miss', () => {
    expect(isMissingRelation(UNDEFINED_TABLE)).toBe(true);
  });

  it('recognises the raw Postgres undefined_table code', () => {
    expect(isMissingRelation({ code: '42P01', message: 'relation does not exist' })).toBe(true);
  });

  it('recognises a missing COLUMN too — a partial apply is not an apply', () => {
    expect(isMissingRelation({ code: '42703', message: 'column does not exist' })).toBe(true);
    expect(isMissingRelation({ code: 'PGRST204', message: 'column not found' })).toBe(true);
  });

  it('does NOT swallow an unrelated error', () => {
    expect(isMissingRelation({ code: '23505', message: 'duplicate key value' })).toBe(false);
    expect(isMissingRelation({ code: '42501', message: 'permission denied' })).toBe(false);
    expect(isMissingRelation(null)).toBe(false);
    expect(isMissingRelation('boom')).toBe(false);
  });
});

describe('getEffectiveVerification when the schema is NOT applied — the live state today', () => {
  it('resolves to unconfigured with the named cause, not a crash', async () => {
    const { client } = stubClient({ data: null, error: UNDEFINED_TABLE });

    const effective = await getEffectiveVerification(client, {
      kind: 'center',
      centerId: CENTER_ID,
    });

    expect(effective.state).toBe('unconfigured');
    expect(effective.cause).toBe('verification_schema_not_applied');
    expect(effective.isVerified).toBe(false);
    expect(effective.canStartVerification).toBe(false);
  });

  it('never resolves to verified because a table is missing', async () => {
    const { client } = stubClient({ data: null, error: UNDEFINED_TABLE });
    for (const subject of [
      { kind: 'center' as const, centerId: CENTER_ID },
      { kind: 'teacher' as const, userId: USER_ID },
    ]) {
      expect((await getEffectiveVerification(client, subject)).isVerified).toBe(false);
    }
  });
});

describe('getEffectiveVerification distinguishes "no schema" from "broken query"', () => {
  it('THROWS on a real query failure rather than reporting "not verified"', async () => {
    // A permission error is not the same as "you have not verified". Silently
    // downgrading it would hide a genuine fault behind a plausible answer.
    const { client } = stubClient({
      data: null,
      error: { code: '42501', message: 'permission denied for table verification_records' },
    });

    const err = await getEffectiveVerification(client, {
      kind: 'center',
      centerId: CENTER_ID,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(VerificationStoreError);
    expect((err as VerificationStoreError).cause_code).toBe('query_failed');
  });
});

describe('getEffectiveVerification when the guard is unhappy', () => {
  it('short-circuits and never queries at all', async () => {
    for (const k of VALIFY_ENV_KEYS) process.env[k] = 'placeholder';

    const client = {
      from() {
        throw new Error('must not query while unconfigured');
      },
    } as unknown as SupabaseClient;

    const effective = await getEffectiveVerification(client, {
      kind: 'center',
      centerId: CENTER_ID,
    });
    expect(effective.state).toBe('unconfigured');
    expect(effective.cause).toBe('valify_not_configured');
  });
});

describe('reading a row', () => {
  it('reads a verified row as verified', async () => {
    const { client } = stubClient({
      data: {
        state: 'verified',
        verified_at: '2026-07-12T09:00:00.000Z',
        legal_name: 'Dina Fouad',
        national_id: '29805150102345',
        last_outcome: 'passed',
      },
      error: null,
    });

    const effective = await getEffectiveVerification(client, {
      kind: 'center',
      centerId: CENTER_ID,
    });
    expect(effective.state).toBe('verified');
    expect(effective.isVerified).toBe(true);
  });

  it('treats an UNRECOGNISED stored state as absent, never as verified', async () => {
    const { client } = stubClient({
      data: { state: 'totally-bogus', verified_at: null },
      error: null,
    });

    const effective = await getEffectiveVerification(client, {
      kind: 'teacher',
      userId: USER_ID,
    });
    expect(effective.state).toBe('unverified');
    expect(effective.isVerified).toBe(false);
  });

  it('a missing row is unverified, not an error', async () => {
    const { client } = stubClient({ data: null, error: null });
    const effective = await getEffectiveVerification(client, {
      kind: 'center',
      centerId: CENTER_ID,
    });
    expect(effective.state).toBe('unverified');
  });
});

describe('writes name the schema gap rather than leaking a driver error', () => {
  it('recordAttemptStarted throws verification_schema_not_applied', async () => {
    const { client } = stubClient({ data: null, error: UNDEFINED_TABLE });

    const err = await recordAttemptStarted(
      client,
      { kind: 'center', centerId: CENTER_ID },
      { referenceId: 'ref-1', expiresAt: '2026-08-04T12:30:00.000Z' },
    ).catch((e) => e);

    expect(err).toBeInstanceOf(VerificationStoreError);
    expect((err as VerificationStoreError).cause_code).toBe('verification_schema_not_applied');
  });

  it('persistVerificationOutcome says the outcome was NOT recorded', async () => {
    const { client } = stubClient({ data: null, error: UNDEFINED_TABLE });

    const err = await persistVerificationOutcome(
      client,
      { kind: 'center', centerId: CENTER_ID },
      {
        outcome: 'passed',
        providerReference: 'vf-1',
        nationalId: '29805150102345',
        legalName: 'Dina Fouad',
        occurredAt: '2026-08-04T09:00:00.000Z',
        occurredOnCairoDay: '2026-08-04',
      },
    ).catch((e) => e);

    expect((err as VerificationStoreError).cause_code).toBe('verification_schema_not_applied');
    expect((err as Error).message).toMatch(/NOT recorded/i);
  });
});

describe('multi-tenancy: the subject shape written to the row', () => {
  it('a centre subject writes center_id and NULL user_id', async () => {
    const { client, captured } = stubClient({ data: null, error: null });

    await recordAttemptStarted(
      client,
      { kind: 'center', centerId: CENTER_ID },
      { referenceId: 'ref-1', expiresAt: '2026-08-04T12:30:00.000Z' },
    );

    expect(captured.rows[0]).toMatchObject({
      subject_type: 'center',
      center_id: CENTER_ID,
      user_id: null,
    });
  });

  it('a TEACHER subject writes user_id and NULL center_id — teachers are centre-less', async () => {
    const { client, captured } = stubClient({ data: null, error: null });

    await recordAttemptStarted(
      client,
      { kind: 'teacher', userId: USER_ID },
      { referenceId: 'ref-2', expiresAt: '2026-08-04T12:30:00.000Z' },
    );

    expect(captured.rows[0]).toMatchObject({
      subject_type: 'teacher',
      user_id: USER_ID,
      center_id: null,
    });
  });
});

describe('persistVerificationOutcome — what is stored, and what is not', () => {
  it('stores the tax skeleton ONLY on a pass, with the Cairo day', async () => {
    const { client, captured } = stubClient({ data: null, error: null });

    await persistVerificationOutcome(
      client,
      { kind: 'center', centerId: CENTER_ID },
      {
        outcome: 'passed',
        providerReference: 'vf-8823-0412',
        nationalId: '29805150102345',
        legalName: 'Dina Fouad',
        occurredAt: '2026-08-04T09:00:00.000Z',
        occurredOnCairoDay: '2026-08-04',
      },
    );

    expect(captured.rows[0]).toMatchObject({
      state: 'verified',
      national_id: '29805150102345',
      legal_name: 'Dina Fouad',
      verified_at: '2026-08-04T09:00:00.000Z',
      verified_cairo_day: '2026-08-04',
      provider: 'valify',
      provider_reference: 'vf-8823-0412',
    });
  });

  it('NULLS the sensitive columns on every non-pass, even if values were passed', async () => {
    // No receipt is issued for a failed check, so there is no legal obligation
    // and therefore no lawful basis to retain the number. This also stops a
    // previous attempt's data lingering against a now-unverified provider.
    for (const outcome of ['failed', 'abandoned', 'expired', 'provider_error'] as const) {
      const { client, captured } = stubClient({ data: null, error: null });

      await persistVerificationOutcome(
        client,
        { kind: 'teacher', userId: USER_ID },
        {
          outcome,
          providerReference: 'vf-1',
          nationalId: '29805150102345',
          legalName: 'Dina Fouad',
          occurredAt: '2026-08-04T09:00:00.000Z',
          occurredOnCairoDay: '2026-08-04',
        },
      );

      const row = captured.rows[0] as Record<string, unknown>;
      expect(row.national_id).toBeNull();
      expect(row.legal_name).toBeNull();
      expect(row.verified_at).toBeNull();
      expect(row.verified_cairo_day).toBeNull();
      expect(row.state).not.toBe('verified');
    }
  });

  it('writes no column that could hold a document image', async () => {
    const { client, captured } = stubClient({ data: null, error: null });
    await persistVerificationOutcome(
      client,
      { kind: 'center', centerId: CENTER_ID },
      {
        outcome: 'passed',
        providerReference: 'vf-1',
        nationalId: '29805150102345',
        legalName: 'Dina Fouad',
        occurredAt: '2026-08-04T09:00:00.000Z',
        occurredOnCairoDay: '2026-08-04',
      },
    );

    const keys = Object.keys(captured.rows[0] as Record<string, unknown>);
    for (const forbidden of ['image', 'selfie', 'photo', 'document', 'religion', 'marital']) {
      expect(keys.some((k) => k.includes(forbidden))).toBe(false);
    }
  });
});

describe('resolveSubjectForReference — the webhook cannot name its own subject', () => {
  it('refuses a reference we never issued', async () => {
    const { client } = stubClient({ data: null, error: null });

    const err = await resolveSubjectForReference(client, 'never-issued').catch((e) => e);

    expect(err).toBeInstanceOf(VerificationStoreError);
    expect((err as VerificationStoreError).cause_code).toBe('attempt_not_found');
  });

  it('refuses a row with no usable subject binding', async () => {
    const { client } = stubClient({
      data: { subject_type: 'center', center_id: null, user_id: null },
      error: null,
    });

    const err = await resolveSubjectForReference(client, 'ref-1').catch((e) => e);
    expect((err as VerificationStoreError).cause_code).toBe('attempt_not_found');
  });

  it('returns the subject from OUR row', async () => {
    const { client } = stubClient({
      data: { subject_type: 'center', center_id: CENTER_ID, user_id: null },
      error: null,
    });

    expect(await resolveSubjectForReference(client, 'ref-1')).toEqual({
      kind: 'center',
      centerId: CENTER_ID,
    });
  });
});
