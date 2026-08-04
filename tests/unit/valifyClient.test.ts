/**
 * The Valify client: refuses when unconfigured, verifies HMAC fail-closed, and
 * never invents an outcome.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'crypto';
import { VALIFY_ENV_KEYS } from '@/lib/valifyConfig';
import { ValifyNotConfiguredError } from '@/lib/valifyGuardLogic';
import {
  ValifyLinkError,
  parseValifyWebhook,
  requestValifyVerificationLink,
  verifyValifyWebhookSignature,
} from '@/lib/valifyClient';

const SECRET = 'whsec_2b9e4a7c1f8d3e6a5c0b9d2f4e7a1c83';
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

function configure(): void {
  process.env.VALIFY_API_KEY = 'vk_live_8f3a91c2b7e04d5a9f1c6e2b8d4a7c30';
  process.env.VALIFY_BASE_URL = 'https://verify.valifysolutions.com';
  process.env.VALIFY_WEBHOOK_SECRET = SECRET;
}

const LINK_INPUT = {
  referenceId: '3f2a9c14-5b8e-4d71-9a03-6c2e8b4f1d75',
  returnUrl: 'https://tutoringhq.app/api/verification/return?ref=3f2a9c14',
  expiresAt: '2026-08-04T12:30:00.000Z',
};

describe('requestValifyVerificationLink — the failure path', () => {
  it('THROWS a named error and makes NO network call when unconfigured', async () => {
    const fetchSpy = vi.fn();

    await expect(
      requestValifyVerificationLink(LINK_INPUT, fetchSpy as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(ValifyNotConfiguredError);

    // The guard runs BEFORE anything is built or sent. No half-formed request
    // ever leaves the process with a placeholder as its API key.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses on placeholders exactly as it does on absence', async () => {
    for (const k of VALIFY_ENV_KEYS) process.env[k] = 'placeholder';
    const fetchSpy = vi.fn();

    let thrown: unknown;
    try {
      await requestValifyVerificationLink(LINK_INPUT, fetchSpy as unknown as typeof fetch);
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(ValifyNotConfiguredError);
    expect((thrown as ValifyNotConfiguredError).cause_code).toBe('valify_not_configured');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('never returns a fabricated link instead of throwing', async () => {
    // Guards against the "helpful" refactor that returns a dummy/pretend
    // session so the UI has something to render.
    const result = await requestValifyVerificationLink(
      LINK_INPUT,
      (() => {
        throw new Error('unreachable');
      }) as unknown as typeof fetch,
    ).catch((e) => e);

    expect(result).toBeInstanceOf(Error);
    expect(result).not.toHaveProperty('redirectUrl');
  });

  it('names provider_unreachable when the network fails', async () => {
    configure();
    const fetchSpy = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const err = await requestValifyVerificationLink(
      LINK_INPUT,
      fetchSpy as unknown as typeof fetch,
    ).catch((e) => e);

    expect(err).toBeInstanceOf(ValifyLinkError);
    expect((err as ValifyLinkError).cause_code).toBe('provider_unreachable');
  });

  it('names provider_rejected_request on a non-2xx', async () => {
    configure();
    const fetchSpy = vi.fn().mockResolvedValue(new Response('nope', { status: 403 }));

    const err = await requestValifyVerificationLink(
      LINK_INPUT,
      fetchSpy as unknown as typeof fetch,
    ).catch((e) => e);

    expect((err as ValifyLinkError).cause_code).toBe('provider_rejected_request');
    expect((err as ValifyLinkError).status).toBe(403);
  });

  it('names provider_returned_no_link on a 200 with no session', async () => {
    configure();
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

    const err = await requestValifyVerificationLink(
      LINK_INPUT,
      fetchSpy as unknown as typeof fetch,
    ).catch((e) => e);

    // A 200 is not success. Success is a usable link.
    expect((err as ValifyLinkError).cause_code).toBe('provider_returned_no_link');
  });
});

describe('requestValifyVerificationLink — the happy path, once credentials exist', () => {
  it('sends the documented shape and returns the redirect URL', async () => {
    configure();
    process.env.VALIFY_FLOW_ID = 'flow-uuid-1234';

    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          session_token: 'sess_abc123',
          redirect_url: 'https://verify.valifysolutions.com/?token=sess_abc123',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const result = await requestValifyVerificationLink(
      LINK_INPUT,
      fetchSpy as unknown as typeof fetch,
    );

    expect(result.redirectUrl).toBe('https://verify.valifysolutions.com/?token=sess_abc123');

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://verify.valifysolutions.com/api/link/v1/request/?lang=en');
    expect((init as RequestInit).headers).toMatchObject({
      'X-Valify-Api-Key': 'vk_live_8f3a91c2b7e04d5a9f1c6e2b8d4a7c30',
    });

    const body = JSON.parse(String((init as RequestInit).body));
    expect(body).toEqual({
      return_url: LINK_INPUT.returnUrl,
      reference_id: LINK_INPUT.referenceId,
      expires_at: LINK_INPUT.expiresAt,
      flow: 'flow-uuid-1234',
    });
    // The request carries no document, no image and no personal data — only our
    // own opaque reference. Capture happens on Valify's page.
    expect(JSON.stringify(body)).not.toMatch(/image|photo|selfie|national/i);
  });

  it('omits `flow` when no flow id is configured', async () => {
    configure();
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ session_token: 's', redirect_url: 'https://v/?token=s' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await requestValifyVerificationLink(LINK_INPUT, fetchSpy as unknown as typeof fetch);
    const body = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body));
    expect(body).not.toHaveProperty('flow');
  });
});

describe('verifyValifyWebhookSignature — fails CLOSED in every direction', () => {
  const body = JSON.stringify({ reference_id: 'r1', outcome: 'passed' });

  function sign(b: string, secret = SECRET): string {
    return createHmac('sha256', secret).update(b, 'utf8').digest('hex');
  }

  it('rejects when Valify is not configured, even with a "correct" signature', () => {
    // No secret set: nothing can be authenticated, so nothing is accepted.
    expect(verifyValifyWebhookSignature(body, sign(body))).toBe(false);
  });

  it('rejects when the secret is still a placeholder', () => {
    for (const k of VALIFY_ENV_KEYS) process.env[k] = 'placeholder';
    // Signed with the literal placeholder — an attacker reading .env.example
    // knows this value. It must not verify.
    expect(verifyValifyWebhookSignature(body, sign(body, 'placeholder'))).toBe(false);
  });

  it('rejects a missing header', () => {
    configure();
    expect(verifyValifyWebhookSignature(body, null)).toBe(false);
    expect(verifyValifyWebhookSignature(body, undefined)).toBe(false);
    expect(verifyValifyWebhookSignature(body, '')).toBe(false);
    expect(verifyValifyWebhookSignature(body, '   ')).toBe(false);
  });

  it('rejects a wrong signature, a truncated one, and non-hex junk', () => {
    configure();
    expect(verifyValifyWebhookSignature(body, sign('a different body'))).toBe(false);
    expect(verifyValifyWebhookSignature(body, sign(body).slice(0, 32))).toBe(false);
    expect(verifyValifyWebhookSignature(body, 'not-hex-at-all')).toBe(false);
  });

  it('rejects a signature made with the wrong secret', () => {
    configure();
    expect(verifyValifyWebhookSignature(body, sign(body, 'some-other-secret'))).toBe(false);
  });

  it('accepts a correctly-signed body, case-insensitively on the hex', () => {
    configure();
    expect(verifyValifyWebhookSignature(body, sign(body))).toBe(true);
    expect(verifyValifyWebhookSignature(body, sign(body).toUpperCase())).toBe(true);
  });

  it('is sensitive to any body mutation', () => {
    configure();
    const sig = sign(body);
    expect(verifyValifyWebhookSignature(body + ' ', sig)).toBe(false);
    expect(verifyValifyWebhookSignature(JSON.stringify(JSON.parse(body)) + '\n', sig)).toBe(false);
  });
});

describe('parseValifyWebhook — refuses to guess', () => {
  it('rejects malformed JSON with a named cause', () => {
    const r = parseValifyWebhook('not json');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe('malformed_json');
  });

  it('rejects a payload with no reference — it cannot be bound to an attempt', () => {
    const r = parseValifyWebhook(JSON.stringify({ outcome: 'passed' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe('missing_reference');
  });

  it('THE KEY REFUSAL: an unrecognised payload does NOT default to passed', () => {
    const r = parseValifyWebhook(JSON.stringify({ reference_id: 'r1', something: 'else' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe('unrecognised_payload');
  });

  it('an unrecognised payload does not default to FAILED either', () => {
    // Defaulting to failed would look safe and would be wrong: it burns the
    // provider's retry budget and shows a rejection they never earned.
    const r = parseValifyWebhook(JSON.stringify({ reference_id: 'r1', decision: 'maybe' }));
    expect(r.ok).toBe(false);
  });

  it('maps the documented outcome vocabularies', () => {
    const cases: [string, string][] = [
      ['success', 'passed'],
      ['verified', 'passed'],
      ['failed', 'failed'],
      ['declined', 'failed'],
      ['abandoned', 'abandoned'],
      ['expired', 'expired'],
      ['provider_error', 'provider_error'],
    ];
    for (const [raw, expected] of cases) {
      const r = parseValifyWebhook(JSON.stringify({ reference_id: 'r1', outcome: raw }));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.result.outcome).toBe(expected);
    }
  });

  it('reads boolean status:false as a fail', () => {
    const r = parseValifyWebhook(JSON.stringify({ reference_id: 'r1', status: false }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.outcome).toBe('failed');
  });

  it('reads boolean status:true as a pass ONLY when identity fields came with it', () => {
    // VERIFICATION-SPEC §2b question 3: the vendor does not state whether
    // `status` means "transaction completed" or "person passed". Ambiguous
    // alone; unambiguous when the extracted tax fields are present.
    const bare = parseValifyWebhook(JSON.stringify({ reference_id: 'r1', status: true }));
    expect(bare.ok).toBe(false);

    const withData = parseValifyWebhook(
      JSON.stringify({
        reference_id: 'r1',
        status: true,
        data: { national_id: '29805150102345', full_name: 'Dina Fouad' },
      }),
    );
    expect(withData.ok).toBe(true);
    if (withData.ok) expect(withData.result.outcome).toBe('passed');
  });

  it('extracts ONLY the tax-skeleton fields and drops everything else', () => {
    const r = parseValifyWebhook(
      JSON.stringify({
        reference_id: 'r1',
        transaction_id: 'vf-8823-0412',
        outcome: 'passed',
        data: {
          national_id: '29805150102345',
          full_name: 'Dina Fouad',
          // Everything below is sensitive over-collection and must not survive.
          date_of_birth: '1998-05-15',
          address: '12 Nasr Road, Cairo',
          religion: 'Muslim',
          marital_status: 'Single',
          gender: 'F',
          document_expiry: '2030-01-01',
          front_image: 'data:image/jpeg;base64,AAAA',
          selfie: 'data:image/jpeg;base64,BBBB',
          face_match_score: 0.98,
        },
      }),
    );

    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.result.nationalId).toBe('29805150102345');
    expect(r.result.legalName).toBe('Dina Fouad');
    expect(r.result.providerReference).toBe('vf-8823-0412');

    // The returned object has FIVE keys and no more. Nothing sensitive beyond
    // the two tax fields can reach the database, because there is nowhere to
    // put it.
    expect(Object.keys(r.result).sort()).toEqual(
      ['legalName', 'nationalId', 'outcome', 'providerReference', 'referenceId'].sort(),
    );
    const serialised = JSON.stringify(r.result);
    expect(serialised).not.toMatch(/religion|marital|image|selfie|base64|address|date_of_birth/i);
  });

  it('does NOT retain identity fields on a non-pass', () => {
    // A failed check issues no receipt, so there is no legal obligation to
    // satisfy and therefore no lawful basis to retain a national ID from it.
    const r = parseValifyWebhook(
      JSON.stringify({
        reference_id: 'r1',
        outcome: 'failed',
        data: { national_id: '29805150102345', full_name: 'Dina Fouad' },
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result.nationalId).toBeNull();
    expect(r.result.legalName).toBeNull();
  });
});
