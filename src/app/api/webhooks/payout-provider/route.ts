// POST /api/webhooks/payout-provider
//
// The payout provider's server-to-server callback sink.
//
// ── THE ONE RULE THIS HANDLER EXISTS TO ENFORCE (§6 rule 1) ─────────────────
//
//   "A callback may ONLY enqueue an inquiry job. It may never write a ledger
//    entry, never call the transition RPC, never move a payout state."
//
// This file contains no ledger write, no `payout_transition` call and no
// balance mutation. The only thing it can do is INSERT one row into
// `payout_provider_events`. That is enforced structurally as well, by the
// grants at the foot of the migration proposal.
//
// ── ATTACK A1, IN FULL ──────────────────────────────────────────────────────
//
// HMAC is OFF BY DEFAULT at Paymob and must be requested from the account
// manager by email; the payout HMAC algorithm, field order and transport are
// UNDOCUMENTED (§8 question 4). The callback URL is a public POST with no event
// id, signature or timestamp. A centre owner can see their own payout's
// transaction_id on their own detail screen. They POST a fabricated
// `disbursement_status: "failed"` for a payout that already settled, the
// handler credits their balance back, and they repeat per historical payout.
// Unbounded, repeatable, no credentials needed beyond their own session.
//
// TWO INDEPENDENT DEFENCES, both live in this file:
//   (a) the handler cannot credit anything — it only enqueues;
//   (b) with the HMAC secret at its placeholder, EVERY callback is rejected.
//
// ── AMOUNT RE-VERIFICATION ──────────────────────────────────────────────────
//
// A webhook that trusts its payload amount is a critical defect. This handler
// never reads an amount for any purpose. The reconciliation sweep re-derives
// every figure from a provider INQUIRY against our own `center_payouts` row —
// the callback body is evidence that something happened, never evidence of what.
//
// ── MIDDLEWARE ──────────────────────────────────────────────────────────────
//
// Registered in PUBLIC_WEBHOOK_PREFIXES in src/proxy.ts, so it is exempt from
// the CORS allowlist and from session auth, exactly like the Paymob, Bosta and
// WhatsApp webhooks. It therefore MUST verify its own HMAC, which it does below
// with a timing-safe compare from src/lib/verifyHmac.ts.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { hmacSha512Hex, hmacSha256Hex, timingSafeEqualHex } from '@/lib/verifyHmac';
import { readCallbackHmacSecret, ENV_KEYS, COLLECTION_PAYOUT_CONFIG_POINT } from '@/lib/collectionPayout/config';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 256 * 1024;

/** Headers the provider might carry the signature in. Checked in order. */
const SIGNATURE_HEADERS = ['x-paymob-hmac', 'hmac', 'x-signature', 'x-hub-signature-256'];

function svc() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(request: NextRequest) {
  // ── Gate 1: the HMAC secret must not be a placeholder. ────────────────────
  //
  // FAIL VISIBLY. A 503 with a named cause, not a silent 200. Returning 200
  // here would tell the provider the callback was accepted, and we would then
  // never learn that a whole class of events was dropped.
  const secret = readCallbackHmacSecret();
  if (!secret.present) {
    return NextResponse.json(
      {
        ok: false,
        error: 'payout_callback_hmac_not_configured',
        configPoint: COLLECTION_PAYOUT_CONFIG_POINT,
        unsetKey: ENV_KEYS.railCallbackHmacSecret,
        detail:
          'The payout callback HMAC secret holds a placeholder, so no callback can be authenticated. Every callback is rejected. Paymob has HMAC off by default and its payout HMAC algorithm, field order and transport are undocumented (PAYOUT-SYSTEM-SPEC.md §8 question 4). Accepting an unauthenticated callback is attack A1.',
      },
      { status: 503 },
    );
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: 'body_too_large' }, { status: 413 });
  }

  let signature = '';
  for (const h of SIGNATURE_HEADERS) {
    const v = request.headers.get(h);
    if (v && v.trim()) {
      signature = v.trim().replace(/^sha256=/i, '');
      break;
    }
  }
  if (!signature) {
    return NextResponse.json({ ok: false, error: 'missing_signature' }, { status: 401 });
  }

  // The algorithm is undocumented (§8 q4). Both SHA-512 (what Paymob Accept
  // uses) and SHA-256 are accepted, each with a timing-safe compare, and the
  // one that matched is RECORDED on the event row — so when Paymob answers,
  // the stored rows show which it actually was rather than requiring a guess.
  let algorithm: 'sha512' | 'sha256' | null = null;
  if (timingSafeEqualHex(signature, hmacSha512Hex(secret.secret, raw))) algorithm = 'sha512';
  else if (timingSafeEqualHex(signature, hmacSha256Hex(secret.secret, raw))) algorithm = 'sha256';

  const client = svc();
  if (!client) {
    return NextResponse.json({ ok: false, error: 'server_misconfigured' }, { status: 500 });
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = { unparsed: raw.slice(0, 4096) };
  }

  // An unverified callback is EVIDENCE OF AN ATTEMPT and is stored, not
  // discarded — with hmac_verified = false so nothing downstream can mistake it
  // for a provider fact. The reconciliation sweep only ever picks up rows where
  // hmac_verified is true.
  const { error } = await client.from('payout_provider_events').insert({
    source: 'callback',
    raw_body: {
      body: parsed,
      algorithm,
      received_headers: {
        'content-type': request.headers.get('content-type'),
      },
    },
    hmac_verified: algorithm !== null,
  });

  if (error) {
    // The event sink does not exist yet (the migration is a proposal). Say so
    // with a 503 rather than a 200 — a 200 would tell the provider we have the
    // event when we have nothing at all.
    return NextResponse.json(
      {
        ok: false,
        error: 'payout_provider_events_unavailable',
        detail:
          'payout_provider_events does not exist in the live catalog. It is proposed in supabase/migrations/20260804140000_PROPOSAL_payout_system_1_ledger.sql, which Eyad applies by hand. The callback was NOT stored.',
        dbMessage: error.message,
      },
      { status: 503 },
    );
  }

  if (algorithm === null) {
    return NextResponse.json({ ok: false, error: 'invalid_signature' }, { status: 401 });
  }

  // Accepted = ENQUEUED. Not "processed", not "applied". Nothing about the
  // payout has changed and nothing will until an INQUIRY confirms it.
  return NextResponse.json({ ok: true, enqueued: true, stateChanged: false });
}
