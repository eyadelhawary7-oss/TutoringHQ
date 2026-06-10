/**
 * pin_setup_tokens - Set-PIN-on-first-login authority.
 *
 * Two issuance sources (rows are NEVER created from a browser redirect):
 *
 *   1. Webhook (Paymob HMAC-verified payment): `issueForWebhook(...)`.
 *      Row has token_hash = NULL. The /set-pin page authorizes the SUBMIT via
 *      the signed signup-session cookie AND the center's paid+activated state;
 *      no plaintext token leaves the database for this path.
 *
 *   2. Fallback link request (anti-enumerated, rate-limited): `mintForFallback(...)`.
 *      Returns the plaintext token to the caller for out-of-band delivery
 *      (WhatsApp chq_pin_setup_link). Only the SHA-256 hash is persisted.
 *
 * Consumption: `claimByUser(...)` for the cookie path, `claimByPlaintext(...)`
 * for the fallback URL path. Both perform an atomic single-row UPDATE
 *   ... WHERE id = $1 AND used_at IS NULL AND expires_at > now()
 * - first claim wins; replays land on rowCount = 0.
 *
 * Lazy-init per ADR 018: this module accepts an injected admin client; it
 * never reads process.env at import time.
 */
import { createHash, randomBytes } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export const WEBHOOK_TOKEN_TTL_SECONDS = 15 * 60;
export const FALLBACK_TOKEN_TTL_SECONDS = 30 * 60;

export type PinSetupTokenSource = 'webhook_paymob' | 'fallback_link';

export type PinSetupTokenRow = {
  id: string;
  user_id: string;
  token_hash: string | null;
  source: PinSetupTokenSource;
  created_at: string;
  expires_at: string;
  used_at: string | null;
};

function generatePlaintextToken(): string {
  return randomBytes(32)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function hashToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

/**
 * Issue a webhook-backed grant. Idempotent: the partial unique index
 * pin_setup_tokens_one_live_webhook_per_user_idx ensures that a duplicate
 * Paymob webhook delivery does NOT create a second live row. On conflict the
 * function returns the existing live row's id.
 */
export async function issueForWebhook(
  admin: SupabaseClient,
  opts: { userId: string },
): Promise<{ rowId: string; created: boolean }> {
  const expiresAt = new Date(Date.now() + WEBHOOK_TOKEN_TTL_SECONDS * 1000).toISOString();
  const { data, error } = await admin
    .from('pin_setup_tokens')
    .insert({
      user_id: opts.userId,
      token_hash: null,
      source: 'webhook_paymob',
      expires_at: expiresAt,
    })
    .select('id')
    .maybeSingle();

  if (!error && data) {
    return { rowId: (data as { id: string }).id, created: true };
  }

  // Treat unique-violation as success (idempotent webhook replay).
  const existing = await admin
    .from('pin_setup_tokens')
    .select('id')
    .eq('user_id', opts.userId)
    .eq('source', 'webhook_paymob')
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (existing.data) {
    return { rowId: (existing.data as { id: string }).id, created: false };
  }

  throw error ?? new Error('issueForWebhook: insert failed and no existing live row');
}

/**
 * Mint a fallback grant with a plaintext token. Returns the plaintext for
 * out-of-band delivery; only the hash is stored. Multiple alive fallback rows
 * per user are permitted (older ones age out via TTL) - rate-limit lives at
 * the route layer.
 */
export async function mintForFallback(
  admin: SupabaseClient,
  opts: { userId: string },
): Promise<{ rowId: string; plaintext: string }> {
  const plaintext = generatePlaintextToken();
  const token_hash = hashToken(plaintext);
  const expiresAt = new Date(Date.now() + FALLBACK_TOKEN_TTL_SECONDS * 1000).toISOString();

  const { data, error } = await admin
    .from('pin_setup_tokens')
    .insert({
      user_id: opts.userId,
      token_hash,
      source: 'fallback_link',
      expires_at: expiresAt,
    })
    .select('id')
    .single();

  if (error || !data) {
    throw error ?? new Error('mintForFallback: insert returned no row');
  }
  return { rowId: (data as { id: string }).id, plaintext };
}

/**
 * Find a single live grant for the user (any source). Used by the cookie path
 * on /set-pin / set-initial-pin to decide whether the webhook has finished
 * setting things up.
 */
export async function findLiveTokenForUser(
  admin: SupabaseClient,
  userId: string,
): Promise<PinSetupTokenRow | null> {
  const { data, error } = await admin
    .from('pin_setup_tokens')
    .select('id, user_id, token_hash, source, created_at, expires_at, used_at')
    .eq('user_id', userId)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as PinSetupTokenRow | null) ?? null;
}

/**
 * Look up a fallback row by its plaintext token (hashes server-side). Returns
 * null if the token is unknown or already consumed/expired.
 */
export async function findLiveTokenByPlaintext(
  admin: SupabaseClient,
  plaintext: string,
): Promise<PinSetupTokenRow | null> {
  const token_hash = hashToken(plaintext);
  const { data, error } = await admin
    .from('pin_setup_tokens')
    .select('id, user_id, token_hash, source, created_at, expires_at, used_at')
    .eq('token_hash', token_hash)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  return (data as PinSetupTokenRow | null) ?? null;
}

/**
 * Atomic single-use claim. Returns the user_id on success, null on race
 * (already used / expired between findLive and claim). Caller must verify the
 * row's user_id matches the user_id derived from independent trust input
 * (cookie + payment record) BEFORE invoking claim - claim trusts its rowId arg.
 */
export async function claimToken(
  admin: SupabaseClient,
  opts: { rowId: string; ip: string | null },
): Promise<{ userId: string } | null> {
  const { data, error } = await admin
    .from('pin_setup_tokens')
    .update({ used_at: new Date().toISOString(), used_ip: opts.ip })
    .eq('id', opts.rowId)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('user_id')
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { userId: (data as { user_id: string }).user_id };
}

/**
 * Best-effort invalidation of sibling live rows for the same user. Called
 * after a successful PIN set so that any leaked-but-unused fallback link is
 * neutralized.
 */
export async function invalidateSiblingTokens(
  admin: SupabaseClient,
  userId: string,
): Promise<void> {
  await admin
    .from('pin_setup_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('used_at', null);
}
