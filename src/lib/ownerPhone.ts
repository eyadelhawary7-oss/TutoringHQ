import type { SupabaseClient } from '@supabase/supabase-js';

const CENTERHQ_LOCAL_SUFFIX = '@centerhq.local';

/** Phone digits from `auth.users.email` when it uses `{digits}@centerhq.local`. */
export function phoneFromCenterhqAuthEmail(email: string | null | undefined): string | null {
  if (!email || !email.endsWith(CENTERHQ_LOCAL_SUFFIX)) return null;
  const prefix = email.slice(0, -CENTERHQ_LOCAL_SUFFIX.length);
  const digits = prefix.replace(/\D/g, '');
  return digits || null;
}

export type OwnerContact = { authId: string; userPhone: string | null };

/** First owner row per center (`users.id` is the Supabase Auth user id). */
export async function ownerContactByCenterId(
  admin: SupabaseClient,
  centerIds: string[],
): Promise<Map<string, OwnerContact>> {
  const map = new Map<string, OwnerContact>();
  if (centerIds.length === 0) return map;

  const { data, error } = await admin
    .from('users')
    .select('id, center_id, phone')
    .eq('role', 'owner')
    .in('center_id', centerIds);

  if (error || !data) return map;

  for (const row of data as { id: string; center_id: string | null; phone: string | null }[]) {
    if (row.center_id && !map.has(row.center_id)) {
      map.set(row.center_id, { authId: row.id, userPhone: row.phone ?? null });
    }
  }
  return map;
}

/**
 * WhatsApp-ready owner phone: auth email digits, else `public.users.phone`, else center landline.
 */
export async function resolveOwnerWaPhone(
  admin: SupabaseClient,
  ownerAuthId: string | null,
  ownerRowPhone: string | null | undefined,
  fallbackCenterPhone: string | null | undefined,
): Promise<string | null> {
  if (ownerAuthId) {
    const { data, error } = await admin.auth.admin.getUserById(ownerAuthId);
    if (!error && data?.user?.email) {
      const fromEmail = phoneFromCenterhqAuthEmail(data.user.email);
      if (fromEmail) return fromEmail;
    }
  }
  const u = (ownerRowPhone ?? '').trim();
  if (u) return u;
  const c = (fallbackCenterPhone ?? '').trim();
  return c || null;
}

export async function resolveOwnerWaPhoneCached(
  admin: SupabaseClient,
  ownerAuthId: string | null,
  ownerRowPhone: string | null | undefined,
  fallbackCenterPhone: string | null | undefined,
  cache: Map<string, string | null>,
): Promise<string | null> {
  if (!ownerAuthId) {
    return resolveOwnerWaPhone(admin, null, ownerRowPhone, fallbackCenterPhone);
  }
  const hit = cache.get(ownerAuthId);
  if (hit !== undefined) return hit;
  const phone = await resolveOwnerWaPhone(admin, ownerAuthId, ownerRowPhone, fallbackCenterPhone);
  cache.set(ownerAuthId, phone);
  return phone;
}
