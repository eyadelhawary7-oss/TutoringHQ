import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The canonical store for admin-portal permission grants.
 *
 * Eyad's decision, 29 July 2026: `public.permissions` is canonical because it
 * carries `enabled` and `created_at`, so there is a record of who was granted
 * what and when. `admin_users.custom_permissions` is a jsonb blob with no
 * history and is now **dead** — nothing in this file writes it, and nothing
 * should read it. One store, no dual-write.
 *
 * `permissions.user_id` references `admin_users(id)` as of
 * `20260730090000_permissions_canonical_admin_store.sql`. It previously
 * referenced `users(id)` — the centre-tenant table — which would have made
 * every admin permission write fail on a foreign-key violation.
 *
 * ⚠ That migration is MANUAL APPLY to production. Supabase Branching applies to
 * preview branches only, never to production on merge (tested 2026-07-15).
 * Apply it by hand and confirm the constraint in `pg_constraint` before the
 * code that depends on it deploys.
 */

/** A revoked grant is kept as a row with `enabled = false`, never deleted — that IS the audit trail. */
export async function fetchAdminPermissionKeys(
  supabase: SupabaseClient,
  userId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('permissions')
    .select('permission')
    .eq('user_id', userId)
    .eq('enabled', true);

  // Fail CLOSED. An unreadable permission table must not read as "no extra
  // grants but the role still applies" — it returns nothing, and every gate
  // that consumes this falls back to the role's own permission set.
  if (error) return [];
  return ((data ?? []) as { permission: string }[]).map((r) => r.permission);
}

/**
 * Replace an admin's grants with exactly `keys`.
 *
 * Grants are never hard-deleted: a key that is dropped is flipped to
 * `enabled = false` so the row — and its `created_at` — survives. That is the
 * whole reason this table was chosen over the jsonb blob.
 */
export async function setAdminPermissionKeys(
  supabase: SupabaseClient,
  userId: string,
  keys: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const wanted = [...new Set(keys.filter((k) => typeof k === 'string' && k.length > 0))];

  const { data: existingRows, error: readErr } = await supabase
    .from('permissions')
    .select('permission, enabled')
    .eq('user_id', userId);
  if (readErr) return { ok: false, error: readErr.message };

  const existing = new Map(
    ((existingRows ?? []) as { permission: string; enabled: boolean | null }[]).map((r) => [
      r.permission,
      r.enabled !== false,
    ]),
  );

  const toEnable = wanted.filter((k) => existing.get(k) !== true);
  const toDisable = [...existing.entries()].filter(([k, on]) => on && !wanted.includes(k)).map(([k]) => k);

  if (toEnable.length > 0) {
    // (user_id, permission) is UNIQUE, so a previously revoked grant is
    // re-enabled in place and keeps its original created_at.
    const { error } = await supabase
      .from('permissions')
      .upsert(
        toEnable.map((permission) => ({ user_id: userId, permission, enabled: true })),
        { onConflict: 'user_id,permission' },
      );
    if (error) return { ok: false, error: error.message };
  }

  if (toDisable.length > 0) {
    const { error } = await supabase
      .from('permissions')
      .update({ enabled: false })
      .eq('user_id', userId)
      .in('permission', toDisable);
    if (error) return { ok: false, error: error.message };
  }

  return { ok: true };
}

/** Every admin's grants in one round trip — for the team list, which renders all of them. */
export async function fetchPermissionKeysForAdmins(
  supabase: SupabaseClient,
  userIds: string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (userIds.length === 0) return out;

  const { data, error } = await supabase
    .from('permissions')
    .select('user_id, permission')
    .in('user_id', userIds)
    .eq('enabled', true);
  if (error) return out;

  for (const row of (data ?? []) as { user_id: string; permission: string }[]) {
    const list = out.get(row.user_id) ?? [];
    list.push(row.permission);
    out.set(row.user_id, list);
  }
  return out;
}
