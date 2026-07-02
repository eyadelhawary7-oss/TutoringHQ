import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Parent-portal token helpers (H6 hardening).
 *
 * The raw token travels in the WhatsApp portal link the parent receives; the DB
 * stores only its SHA-256 hash, so a leaked table can't reconstruct live links.
 * Lookups hash the incoming token and compare, and skip revoked/expired rows.
 */

/** Deterministic hash of a raw portal token, for storage + lookup. */
export function hashParentPortalToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

/** Generate a fresh 128-bit token: returns the raw value (for the link) and its stored hash. */
export function newParentPortalToken(): { raw: string; hash: string } {
  const raw = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return { raw, hash: hashParentPortalToken(raw) };
}

const DEFAULT_LIFETIME_DAYS = 30;

/**
 * Portal-link lifetime in days, from platform_config
 * `parent_portal.link_lifetime_days` (interim 30-day default — Adsero-pending).
 * Falls back to 30 on any missing/invalid config so a link is never minted with
 * the old year-long TTL.
 */
export async function getParentPortalLifetimeDays(supabase: SupabaseClient): Promise<number> {
  try {
    const { data } = await supabase
      .from('platform_config')
      .select('value')
      .eq('key', 'parent_portal.link_lifetime_days')
      .maybeSingle();
    const raw = (data as { value?: unknown } | null)?.value;
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseFloat(raw) : NaN;
    if (Number.isFinite(n) && n > 0) return n;
  } catch {
    /* fall through to default */
  }
  return DEFAULT_LIFETIME_DAYS;
}
