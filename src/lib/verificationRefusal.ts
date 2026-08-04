/**
 * The one shape every verification refusal takes.
 *
 * Each entry point in this feature returns this body when it cannot proceed. It
 * always carries:
 *   - a stable `cause` code, so logs, Sentry and the UI agree on what happened
 *   - `en` and `ar` prose the user can actually read
 *   - `verified: false`, stated explicitly rather than left to be inferred
 *
 * That last field exists because of the specific failure this feature must not
 * have: a client that reads `res.ok === false` and falls through to a cached or
 * default `true` has produced a green checkmark backed by no integration. Every
 * refusal says, in the body, that nothing was verified.
 */

import { NextResponse } from 'next/server';
import { refusalMessage, type ValifyUnconfiguredCause } from '@/lib/valifyGuardLogic';

export interface VerificationRefusalBody {
  error: string;
  cause: string;
  verified: false;
  state: 'unconfigured' | 'unavailable';
  message: { en: string; ar: string };
}

/**
 * 503 refusal for the two "not switched on" causes.
 *
 * 503 and not 500: nothing is broken. The provider integration does not exist
 * yet. A 500 would page someone at 3am for a feature that was never contracted.
 * 503 and not 200-with-a-flag: an entry point that returns HTTP success while
 * refusing invites exactly the client-side misreading described above.
 */
export function valifyUnconfiguredResponse(
  cause: ValifyUnconfiguredCause,
  missing: readonly string[] = [],
): NextResponse<VerificationRefusalBody> {
  const message = refusalMessage(cause);
  const body: VerificationRefusalBody = {
    error: message.en,
    cause,
    verified: false,
    state: 'unconfigured',
    message,
  };

  const res = NextResponse.json(body, { status: 503 });
  // Operator-facing only; never rendered. Tells whoever is looking at the
  // network tab precisely which env keys are still placeholders.
  if (missing.length > 0) res.headers.set('X-Verification-Missing-Config', missing.join(','));
  res.headers.set('X-Verification-Cause', cause);
  return res;
}

/** Refusal for a named failure that is not a config gap (provider down, etc). */
export function verificationUnavailableResponse(
  cause: string,
  en: string,
  ar: string,
  status = 502,
): NextResponse<VerificationRefusalBody> {
  const body: VerificationRefusalBody = {
    error: en,
    cause,
    verified: false,
    state: 'unavailable',
    message: { en, ar },
  };
  const res = NextResponse.json(body, { status });
  res.headers.set('X-Verification-Cause', cause);
  return res;
}
