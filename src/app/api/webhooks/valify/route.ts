/**
 * POST /api/webhooks/valify — the ONLY route to verified state.
 *
 * ============================================================================
 * FAIL CLOSED, ALWAYS, IN EVERY ENVIRONMENT.
 * ============================================================================
 * No secret → 401. No signature header → 401. Bad signature → 401. Unconfigured
 * → 401. There is no environment flag, no dev bypass and no build-phase escape
 * that lets an unsigned callback through. A webhook that trusts its payload
 * would let anyone who can POST to a public URL mark an account verified and
 * thereby unlock its payouts and online collection — the critical defect this
 * feature is most exposed to.
 *
 * Public by routing: registered in `PUBLIC_WEBHOOK_PREFIXES` in `src/proxy.ts`,
 * so the middleware does not apply auth or the CORS Origin check. It therefore
 * verifies its own HMAC, with a TIMING-SAFE compare via `verifyHmac.ts`, exactly
 * as the Paymob and Bosta webhooks do.
 *
 * ----------------------------------------------------------------------------
 * THE SUBJECT IS NEVER TAKEN FROM THE PAYLOAD
 * ----------------------------------------------------------------------------
 * The callback carries only OUR opaque reference. `resolveSubjectForReference()`
 * looks that up in `verification_attempts` — a row WE wrote, server-side, at
 * start time — and the subject comes from there. A callback cannot name whose
 * account it is verifying, even with a valid signature. An unknown reference is
 * refused rather than guessed at.
 *
 * ----------------------------------------------------------------------------
 * THE AMOUNT-REVERIFICATION RULE, AND WHY IT DOES NOT APPLY HERE
 * ----------------------------------------------------------------------------
 * A payment webhook must re-verify the amount against the expected total; a
 * webhook that trusts its payload amount is a critical defect. This callback
 * carries NO amount and moves NO money — it reports an identity outcome. The
 * equivalent integrity rule for this webhook is the one enforced above: the
 * subject is re-derived from our own record rather than trusted from the body,
 * and the outcome is accepted only for a reference we ourselves issued. When the
 * payout webhooks are built they need the amount rule in full.
 *
 * ----------------------------------------------------------------------------
 * TODAY THIS ROUTE ALWAYS 401s, because `VALIFY_WEBHOOK_SECRET` is a
 * placeholder and the guard reports unconfigured. Correct and intended.
 */

import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { readRawBodyWithLimit, ValidationError } from '@/lib/validate';
import { cairoDateKey } from '@/lib/cairo/day';
import { getValifyConfigStatus } from '@/lib/valifyGuardLogic';
import {
  VALIFY_SIGNATURE_HEADER,
  parseValifyWebhook,
  verifyValifyWebhookSignature,
} from '@/lib/valifyClient';
import {
  VerificationStoreError,
  persistVerificationOutcome,
  resolveSubjectForReference,
} from '@/lib/verificationStore';

export const dynamic = 'force-dynamic';

const BODY_LIMIT = 64 * 1024;

export async function POST(request: Request) {
  // 1. Guard. An unconfigured deployment cannot authenticate anything, so the
  //    only safe answer to any callback is to reject it.
  const guard = getValifyConfigStatus();
  if (!guard.configured) {
    // 401, not 503: to an unauthenticated caller this is indistinguishable
    // from a bad signature, and it should be. Announcing "our verification
    // provider is not configured" to an anonymous POST is a free reconnaissance
    // signal. The named cause goes to our logs, not to the response body.
    console.warn('[webhooks/valify] rejected: valify_not_configured', {
      missing: guard.missing,
    });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2. Raw body, read ONCE. Re-serialising parsed JSON changes key order and
  //    whitespace, which would break every signature.
  let rawBody: string;
  try {
    rawBody = await readRawBodyWithLimit(request, BODY_LIMIT);
  } catch (e) {
    if (e instanceof ValidationError) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    }
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  // 3. HMAC, timing-safe. Fails closed in every direction.
  const signature = request.headers.get(VALIFY_SIGNATURE_HEADER);
  if (!verifyValifyWebhookSignature(rawBody, signature)) {
    console.warn('[webhooks/valify] rejected: signature verification failed');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 4. Parse. Refuses rather than guessing when the payload is unrecognised —
  //    the vendor contract is undocumented (VERIFICATION-SPEC §2b).
  const parsed = parseValifyWebhook(rawBody);
  if (!parsed.ok) {
    Sentry.withScope((scope) => {
      scope.setTag('route', 'webhooks/valify');
      scope.setTag('parse_cause', parsed.cause);
      scope.setLevel('error');
      Sentry.captureMessage(`Valify webhook not understood: ${parsed.cause}`);
    });
    // 422 and NOT 200. A 200 would tell Valify we handled it and stop the
    // retry, silently losing a real verification outcome. Nothing was recorded,
    // so say nothing was accepted.
    return NextResponse.json(
      { error: 'Webhook payload not understood', cause: parsed.cause },
      { status: 422 },
    );
  }

  const { referenceId, outcome, providerReference, nationalId, legalName } = parsed.result;

  let supabaseAdmin;
  try {
    supabaseAdmin = getSupabaseAdmin();
  } catch {
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  try {
    // 5. Subject from OUR row, keyed by OUR reference. Never from the payload.
    const subject = await resolveSubjectForReference(supabaseAdmin, referenceId);

    // The Cairo calendar day is computed HERE, once, and stored alongside the
    // instant. The user-visible verification date is a Cairo date; deriving it
    // from a UTC instant at render time drifts by a day for anything after
    // 22:00 Cairo. `cairoDateKey` is the repo's helper for exactly this.
    const now = new Date();
    const result = await persistVerificationOutcome(supabaseAdmin, subject, {
      outcome,
      providerReference,
      nationalId,
      legalName,
      occurredAt: now.toISOString(),
      occurredOnCairoDay: cairoDateKey(now),
    });

    // Never log nationalId or legalName. The whole point of the column grants
    // in the migration is that these two values do not travel; putting them in
    // a log line would route them straight back out.
    console.info('[webhooks/valify] recorded', {
      state: result.state,
      outcome,
      cairoDay: cairoDateKey(now),
    });

    return NextResponse.json({ received: true, state: result.state });
  } catch (e) {
    if (e instanceof VerificationStoreError) {
      Sentry.withScope((scope) => {
        scope.setTag('route', 'webhooks/valify');
        scope.setTag('store_cause', e.cause_code);
        Sentry.captureException(e);
      });
      if (e.cause_code === 'attempt_not_found') {
        // A correctly-signed callback for a reference we never issued. Do not
        // create a record from it — that would be a subject supplied by the
        // caller. 404 so Valify stops retrying something we cannot attribute.
        return NextResponse.json(
          { error: 'Unknown verification reference', cause: e.cause_code },
          { status: 404 },
        );
      }
      // Schema not applied, or a query failure: 500 so Valify RETRIES. The
      // outcome is real and must not be dropped just because we could not
      // store it yet.
      return NextResponse.json(
        { error: 'Could not record the verification outcome', cause: e.cause_code },
        { status: 500 },
      );
    }
    throw e;
  }
}
