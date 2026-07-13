/**
 * staff_invites — CEO-minted, single-use, expiring invite links for the staff intake flow.
 *
 * The link grants NOTHING on its own: it only permits submitting ONE intake for its
 * pre-chosen role. Provisioning happens later, on CEO approval, via provisionStaffLogin.
 *
 * Token model mirrors pin_setup_tokens: the plaintext token leaves the DB exactly once
 * (returned to the CEO to copy/share) and only its SHA-256 hash is stored. Lookups hash the
 * candidate and match on the hash, so the plaintext is never persisted or logged.
 *
 * Lazy-init: this module accepts an injected admin (service-role) client; it never reads
 * process.env at import time.
 */
import { createHash, randomBytes } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AssignableInternalRole } from '@/lib/admin-roles';

/** Default invite lifetime. Single-use AND time-bounded. */
export const STAFF_INVITE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export type StaffInviteRow = {
  id: string;
  role: AssignableInternalRole;
  custom_permissions: string[];
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

function generatePlaintextToken(): string {
  return randomBytes(32)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function hashInviteToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

/**
 * Mint a new invite. Returns the plaintext token to the caller for one-time display; only
 * the hash is stored. The role/permissions are fixed here by the CEO and copied verbatim
 * onto any intake submitted against this invite — the invitee can never change them.
 */
export async function mintStaffInvite(
  admin: SupabaseClient,
  opts: {
    role: AssignableInternalRole;
    customPermissions: string[];
    createdBy: string | null;
    ttlSeconds?: number;
  },
): Promise<{ id: string; plaintext: string; expiresAt: string }> {
  const plaintext = generatePlaintextToken();
  const token_hash = hashInviteToken(plaintext);
  const ttl = opts.ttlSeconds ?? STAFF_INVITE_TTL_SECONDS;
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

  const { data, error } = await admin
    .from('staff_invites')
    .insert({
      token_hash,
      role: opts.role,
      custom_permissions: opts.role === 'custom' ? opts.customPermissions : [],
      created_by: opts.createdBy,
      expires_at: expiresAt,
    })
    .select('id')
    .single();

  if (error || !data) {
    throw error ?? new Error('mintStaffInvite: insert returned no row');
  }
  return { id: (data as { id: string }).id, plaintext, expiresAt };
}

/**
 * Look up an OPEN invite by its plaintext token. "Open" = exists, not used, not revoked,
 * not expired. Returns null otherwise (unknown / consumed / revoked / expired) with no
 * distinction, so the intake page cannot use it as an oracle beyond "usable or not".
 */
export async function findOpenInviteByPlaintext(
  admin: SupabaseClient,
  plaintext: string,
): Promise<StaffInviteRow | null> {
  const token_hash = hashInviteToken(plaintext);
  const { data, error } = await admin
    .from('staff_invites')
    .select('id, role, custom_permissions, expires_at, used_at, revoked_at, created_at')
    .eq('token_hash', token_hash)
    .is('used_at', null)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  return (data as StaffInviteRow | null) ?? null;
}

/**
 * Atomically mark an invite consumed. Single-use: the UPDATE only matches a still-open row
 * (used_at IS NULL AND revoked_at IS NULL AND not expired), so the first submit wins and a
 * replay lands on rowCount = 0 → returns false. Callers MUST treat false as "link no longer
 * usable" and insert nothing.
 */
export async function consumeStaffInvite(
  admin: SupabaseClient,
  inviteId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from('staff_invites')
    .update({ used_at: new Date().toISOString() })
    .eq('id', inviteId)
    .is('used_at', null)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('id')
    .maybeSingle();
  if (error) throw error;
  return !!data;
}
