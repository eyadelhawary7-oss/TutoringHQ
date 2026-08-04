/**
 * Valify client — the hosted Web Verification Flow.
 *
 * ============================================================================
 * THE DOCUMENT IMAGE NEVER REACHES OUR SERVERS. BY CONSTRUCTION.
 * ============================================================================
 * There is no upload endpoint in this module, no multipart handling, no base64
 * decode, no call to Valify's Fetch Images API, and no field anywhere in this
 * file that could hold an image. The provider leaves our app entirely, completes
 * document capture and liveness on Valify's own page, and returns with an
 * outcome. That is the decision of 26 July 2026
 * (design/DECISION-national-id-2026-07-26.md §3) and it is a legal position, not
 * a preference: the front of an Egyptian national ID carries RELIGION and
 * MARITAL STATUS, both independently sensitive under Law 151/2020. Holding the
 * image would put that data on our infrastructure for no purpose any screen
 * needs.
 *
 * If a future change adds image handling here, it needs the legal review in
 * DECISION-national-id §6 answered first. Do not add it because it was
 * convenient.
 *
 * ----------------------------------------------------------------------------
 * WHAT WE STORE, AND WHY EACH FIELD IS PRESENT
 * ----------------------------------------------------------------------------
 * Exactly three outcome fields, plus a provider reference:
 *
 *   national_id   — required BY EGYPTIAN TAX LAW on the ETA e-receipt we
 *                   self-bill the provider for their 90% share. Legal basis is
 *                   COMPLIANCE WITH A LEGAL OBLIGATION, not consent
 *                   (DECISION-national-id §2). There is no opt-out and it cannot
 *                   be hashed — ETA needs the number itself, so a one-way hash
 *                   would satisfy an identity purpose but not this one.
 *   legal_name    — the name as Valify read it, for the payout account-holder
 *                   match rule (VERIFICATION-SPEC §9.7).
 *   verified_at   — the verification date.
 *   provider_reference — Valify's transaction id. Backend only, never rendered.
 *
 * Everything else Valify returns is DISCARDED at the parse boundary below and
 * never reaches the database: date of birth, address, gender, marital status,
 * document expiry, face-match score, liveness score, and both card images.
 * Storing the whole `extractedData` blob would be over-collection
 * (VERIFICATION-SPEC §2c) and lands straight on the PDPL conflicts in §7.
 *
 * ----------------------------------------------------------------------------
 * THE TRUST ANCHOR IS THE WEBHOOK. NEVER THE REDIRECT RETURN.
 * ----------------------------------------------------------------------------
 * VERIFICATION-SPEC §2 names this as the security boundary of the whole feature:
 * "if verified state is settable from whatever comes back on the redirect,
 * hitting the success URL makes you verified". This module therefore exposes NO
 * function that turns a redirect return into a verified outcome. The return URL
 * handler can read state; only `parseValifyWebhook()` — reachable solely after
 * `verifyValifyWebhookSignature()` passes — can produce one.
 *
 * ----------------------------------------------------------------------------
 * ⚠ VENDOR-UNKNOWN, AND NOT GUESSED
 * ----------------------------------------------------------------------------
 * Valify's public docs do not document the webhook payload, its field names, or
 * how it is authenticated (VERIFICATION-SPEC §2b, blocking questions 1 and 3).
 * `parseValifyWebhook()` below therefore accepts a SUPERSET of plausible field
 * names and refuses — loudly, with `unrecognised_payload` — when it cannot find
 * a decision it is confident about. It does NOT default to a pass, and it does
 * NOT default to a fail that would burn the provider's retry budget. Confirm the
 * real contract with techsupport@valify.me before the first credential is set.
 */

import {
  getValifyApiKey,
  getValifyBaseUrl,
  getValifyFlowId,
  getValifyWebhookSecret,
} from '@/lib/valifyConfig';
import {
  ValifyNotConfiguredError,
  assertValifyConfigured,
  getValifyConfigStatus,
} from '@/lib/valifyGuardLogic';
import { hmacSha256Hex, timingSafeEqualHex } from '@/lib/verifyHmac';
import type { VerificationOutcome } from '@/lib/verificationState';

/** Header Valify is assumed to sign with. See the VENDOR-UNKNOWN note above. */
export const VALIFY_SIGNATURE_HEADER = 'x-valify-signature';

/** How long a hosted session link stays usable. */
export const VALIFY_LINK_TTL_MINUTES = 30;

export interface ValifyLinkRequest {
  /**
   * OUR opaque reference for this attempt. Must NOT be the center id or user id
   * — it is a session identifier we mint, and it is the only thing that comes
   * back on the redirect. Binding the subject to it happens server-side against
   * our own row, never from the returned value.
   */
  referenceId: string;
  /** Where Valify sends the browser afterwards. A UX destination only. */
  returnUrl: string;
  /** ISO 8601. Valify expires the link at this instant. */
  expiresAt: string;
}

export interface ValifyLinkResult {
  sessionToken: string;
  /** The URL to send the browser to. The provider leaves our app here. */
  redirectUrl: string;
  expiresAt: string;
}

/** Every way the link request can fail, named. */
export type ValifyLinkFailure =
  | 'valify_not_configured'
  | 'provider_unreachable'
  | 'provider_rejected_request'
  | 'provider_returned_no_link';

export class ValifyLinkError extends Error {
  readonly cause_code: ValifyLinkFailure;
  readonly status?: number;

  constructor(cause: ValifyLinkFailure, message: string, status?: number) {
    super(message);
    this.name = 'ValifyLinkError';
    this.cause_code = cause;
    this.status = status;
  }
}

/**
 * Ask Valify for a hosted verification session and get back the URL to redirect
 * the provider to.
 *
 * Refuses before any network call when the guard says unconfigured — which is
 * the state today, and will stay the state until Eyad contracts Valify. The
 * refusal is a thrown `ValifyNotConfiguredError` carrying the named cause and
 * the missing keys. It never returns a fabricated link, never returns a
 * "pretend" session, and never resolves to `undefined` for a caller to
 * misread as success.
 */
export async function requestValifyVerificationLink(
  input: ValifyLinkRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<ValifyLinkResult> {
  // Guard first, before anything is built, sent, or logged.
  assertValifyConfigured();

  const baseUrl = getValifyBaseUrl();
  const apiKey = getValifyApiKey();
  // Cannot be null: assertValifyConfigured() proved both are real. Narrowing
  // only, with a named throw rather than a `!` so a future edit that reorders
  // this function cannot silently send `undefined` as a credential.
  if (!baseUrl || !apiKey) {
    throw new ValifyNotConfiguredError(
      'valify_not_configured',
      getValifyConfigStatus().missing,
    );
  }

  const flowId = getValifyFlowId();

  const body: Record<string, string> = {
    return_url: input.returnUrl,
    reference_id: input.referenceId,
    expires_at: input.expiresAt,
  };
  if (flowId) body.flow = flowId;

  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/api/link/v1/request/?lang=en`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Valify-Api-Key': apiKey,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new ValifyLinkError(
      'provider_unreachable',
      `Could not reach Valify: ${e instanceof Error ? e.message : 'network error'}`,
    );
  }

  if (!response.ok) {
    throw new ValifyLinkError(
      'provider_rejected_request',
      `Valify rejected the link request with HTTP ${response.status}.`,
      response.status,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ValifyLinkError(
      'provider_returned_no_link',
      'Valify returned a non-JSON body to the link request.',
    );
  }

  const p = (payload ?? {}) as Record<string, unknown>;
  const sessionToken = typeof p.session_token === 'string' ? p.session_token : '';
  const redirectUrl = typeof p.redirect_url === 'string' ? p.redirect_url : '';

  if (!sessionToken || !redirectUrl) {
    throw new ValifyLinkError(
      'provider_returned_no_link',
      'Valify accepted the request but returned no session_token / redirect_url.',
    );
  }

  return { sessionToken, redirectUrl, expiresAt: input.expiresAt };
}

/**
 * Verify the inbound webhook's HMAC over the RAW request body.
 *
 * Fails CLOSED in every direction: no secret, no header, wrong length, bad hex,
 * or mismatch all return false. There is no environment in which an unsigned
 * Valify callback is accepted — a webhook that trusts its payload could mark any
 * account verified and unlock its payouts, which is the critical defect this
 * feature is most exposed to.
 *
 * Comparison is `timingSafeEqualHex` from the existing `verifyHmac.ts`, the same
 * primitive the Paymob and Bosta webhooks use. Never `===`.
 *
 * MUST be called with the raw body string, read once via
 * `readRawBodyWithLimit()`. Re-serialising parsed JSON changes key order and
 * whitespace and would break every signature.
 */
export function verifyValifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
): boolean {
  const secret = getValifyWebhookSecret();
  // Placeholder secrets must not verify anything. Ask the guard, do not
  // truthiness-check the raw value.
  if (!getValifyConfigStatus().configured) return false;
  if (!secret) return false;
  if (signatureHeader == null) return false;

  const provided = String(signatureHeader).trim();
  if (provided.length === 0) return false;

  const expected = hmacSha256Hex(secret, rawBody);
  return timingSafeEqualHex(provided, expected);
}

/** A parsed, signature-verified Valify result. Contains no image, ever. */
export interface ValifyWebhookResult {
  /** Our reference minted at link time. Binds the result to a stored attempt. */
  referenceId: string;
  outcome: VerificationOutcome;
  /** Valify's transaction id. Stored for audit; never rendered. */
  providerReference: string | null;
  /** Only on `passed`. Tax-skeleton field, see the header note. */
  nationalId: string | null;
  /** Only on `passed`. Payout name-match field. */
  legalName: string | null;
}

export type ValifyWebhookParseFailure =
  | 'malformed_json'
  | 'missing_reference'
  | 'unrecognised_payload';

export type ValifyWebhookParse =
  | { ok: true; result: ValifyWebhookResult }
  | { ok: false; cause: ValifyWebhookParseFailure; message: string };

function firstString(source: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const k of keys) {
    const v = source[k];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return null;
}

/**
 * Parse a Valify webhook body into an outcome.
 *
 * Accepts a superset of plausible field names because the payload is not
 * publicly documented (see the VENDOR-UNKNOWN note). Where it cannot determine a
 * decision it returns `unrecognised_payload` and the caller records nothing and
 * alerts. It never guesses a pass.
 *
 * The `data` sub-object is read for EXACTLY two fields and otherwise ignored.
 * Whatever else Valify puts there — date of birth, address, gender, marital
 * status, expiry, images — is dropped here and cannot reach the database,
 * because the returned type has nowhere to put it.
 */
export function parseValifyWebhook(rawBody: string): ValifyWebhookParse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { ok: false, cause: 'malformed_json', message: 'Webhook body was not valid JSON.' };
  }

  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, cause: 'malformed_json', message: 'Webhook body was not a JSON object.' };
  }

  const p = parsed as Record<string, unknown>;

  const referenceId = firstString(p, ['reference_id', 'referenceId', 'reference']);
  if (!referenceId) {
    return {
      ok: false,
      cause: 'missing_reference',
      message: 'Webhook carried no reference_id; it cannot be bound to an attempt.',
    };
  }

  const providerReference = firstString(p, [
    'transaction_id',
    'transactionId',
    'session_id',
    'sessionID',
  ]);

  const outcome = readOutcome(p);
  if (outcome === null) {
    return {
      ok: false,
      cause: 'unrecognised_payload',
      message:
        'Webhook carried no field this parser recognises as a decision. Refusing to guess — the real payload contract must be confirmed with Valify.',
    };
  }

  // Tax-skeleton fields are read ONLY on a pass. A failed check yields no
  // lawful basis to retain a national ID, because no receipt will be issued.
  let nationalId: string | null = null;
  let legalName: string | null = null;
  if (outcome === 'passed') {
    const data =
      p.data != null && typeof p.data === 'object' && !Array.isArray(p.data)
        ? (p.data as Record<string, unknown>)
        : p;
    nationalId = firstString(data, ['national_id', 'nationalId', 'nid', 'id_number']);
    legalName = firstString(data, ['full_name', 'fullName', 'name', 'legal_name']);
  }

  return {
    ok: true,
    result: { referenceId, outcome, providerReference, nationalId, legalName },
  };
}

/**
 * Extract a decision, or null when the payload does not clearly carry one.
 *
 * Null is a REFUSAL, not a default. `parseValifyWebhook` turns it into
 * `unrecognised_payload`, the caller records nothing and raises. Defaulting to
 * `failed` would look safe and would be wrong: it would consume the provider's
 * retry budget and show them a rejection they never earned.
 */
function readOutcome(p: Record<string, unknown>): VerificationOutcome | null {
  const explicit = firstString(p, ['outcome', 'result', 'verification_status']);
  if (explicit) {
    const v = explicit.toLowerCase();
    if (['passed', 'pass', 'success', 'successful', 'verified', 'approved'].includes(v)) {
      return 'passed';
    }
    if (['failed', 'fail', 'rejected', 'declined', 'unsuccessful'].includes(v)) return 'failed';
    if (['abandoned', 'cancelled', 'canceled', 'incomplete'].includes(v)) return 'abandoned';
    if (['expired', 'timeout', 'timed_out'].includes(v)) return 'expired';
    if (['error', 'provider_error', 'internal_error'].includes(v)) return 'provider_error';
    return null;
  }

  // Transaction Inquiry documents a boolean `status`. VERIFICATION-SPEC §2b
  // blocking question 3 records that whether it means "the transaction
  // completed" or "the person passed" is NOT stated by the vendor. We read
  // `true` as a pass only when the payload also carries the extracted tax
  // fields, which a merely-completed-but-failed transaction would not.
  if (typeof p.status === 'boolean') {
    if (p.status === false) return 'failed';
    const data =
      p.data != null && typeof p.data === 'object' && !Array.isArray(p.data)
        ? (p.data as Record<string, unknown>)
        : p;
    const hasIdentity =
      firstString(data, ['national_id', 'nationalId', 'nid', 'id_number']) !== null;
    return hasIdentity ? 'passed' : null;
  }

  return null;
}
