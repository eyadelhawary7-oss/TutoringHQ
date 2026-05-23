import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { phoneFromCenterhqAuthEmail } from '@/lib/ownerPhone';

/**
 * Normalise a phone candidate to digits-only so format differences between
 * `auth.users.phone` (typically E.164 without `+`) and SUPER_ADMIN_PHONES
 * entries (often with `+`) do not let one form pass while the other fails.
 */
function normalisePhoneForCompare(raw: string | null | undefined): string {
  if (!raw) return '';
  return String(raw).replace(/\D/g, '');
}

/**
 * Env-based phone super-admins. Compares digit-equivalent values so the
 * verified-session phone (auth.users.phone) and SUPER_ADMIN_PHONES entries
 * match regardless of leading `+` / spacing. The caller should prefer the
 * Supabase-Auth-verified session phone (centerAuth/admin-auth pass user.phone
 * from getUser()) over public.users.phone, which is centre-tenant data.
 */
export function isSuperAdminPhone(phone: string | null): boolean {
  const candidate = normalisePhoneForCompare(phone);
  if (!candidate) return false;
  const admins = process.env.SUPER_ADMIN_PHONES || '';
  return admins
    .split(',')
    .map((p) => normalisePhoneForCompare(p))
    .filter(Boolean)
    .includes(candidate);
}

/**
 * Normalize admin_users.custom_permissions: supports legacy string[] or jsonb object flags.
 */
export function customPermissionsToKeys(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((x): x is string => typeof x === 'string');
  }
  if (raw && typeof raw === 'object') {
    return Object.entries(raw as Record<string, unknown>)
      .filter(([, v]) => v === true)
      .map(([k]) => k);
  }
  return [];
}

export type AdminAccessFlags = {
  isSuperAdmin: boolean;
  canApproveSignups: boolean;
  adminRole: string | null;
  customPermissionKeys: string[];
};

/**
 * Resolve the auth-authoritative phone for `userId`.
 *
 * CenterHQ uses phone+PIN auth where every account is created with an email
 * of the form `<phonedigits>@centerhq.local` (see `auth.admin.createUser` in
 * signupPaymobAutoApprove / admin/centers / accept-invite). `auth.users.phone`
 * is left null in this flow. The email local-part IS the verified phone
 * identity , it is set server-side and is NOT writable via the /api/db proxy.
 *
 * Order of preference:
 *   1. auth.users.email local-part (the real CenterHQ identity source).
 *   2. auth.users.phone (in case Supabase phone-OTP is ever enabled).
 *   3. public.users.phone (defence-in-depth; dbProxyProtectedColumns blocks
 *      writes to this column at the proxy, so this is a non-authoritative
 *      compatibility fallback).
 */
async function resolveAuthPhone(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  try {
    const { data, error } = await supabase.auth.admin.getUserById(userId);
    if (!error && data?.user) {
      const emailPhone = phoneFromCenterhqAuthEmail(data.user.email);
      if (emailPhone) return emailPhone;
      if (data.user.phone) return data.user.phone;
    }
  } catch {
    /* fall through to public.users.phone */
  }
  const { data: userRow } = await supabase
    .from('users')
    .select('phone')
    .eq('id', userId)
    .maybeSingle();
  return (userRow as { phone?: string | null } | null)?.phone ?? null;
}

export async function fetchAdminAccessFlags(
  supabase: SupabaseClient,
  userId: string,
): Promise<AdminAccessFlags> {
  // Re-sourced (FIX 1b follow-up): use auth.users.phone, not public.users.phone.
  // public.users.phone is centre-tenant data and was the prior storage path
  // for super-admin escalation against SUPER_ADMIN_PHONES.
  const sessionPhone = await resolveAuthPhone(supabase, userId);
  const phoneSuper = isSuperAdminPhone(sessionPhone);

  const { data: adminUser } = await supabase
    .from('admin_users')
    .select('role, custom_permissions')
    .eq('id', userId)
    .maybeSingle();

  const customPermissionKeys = customPermissionsToKeys(adminUser?.custom_permissions);
  const dbSuper = adminUser?.role === 'super_admin';
  const isSuperAdmin = dbSuper || phoneSuper;
  const canApproveSignups = isSuperAdmin || customPermissionKeys.includes('can_approve_signups');

  return {
    isSuperAdmin,
    canApproveSignups,
    adminRole: adminUser?.role ?? null,
    customPermissionKeys,
  };
}

/**
 * DB + phone super_admin check (for routes that must stay super_admin-only beyond JWT).
 * Returns a 403 response if not super_admin, else null.
 */
export async function requireSuperAdminRow(
  supabase: SupabaseClient,
  userId: string,
): Promise<NextResponse | null> {
  const { data: adminUser } = await supabase
    .from('admin_users')
    .select('role, custom_permissions')
    .eq('id', userId)
    .maybeSingle();

  // Re-sourced (FIX 1b follow-up): auth.users.phone, not public.users.phone.
  const sessionPhone = await resolveAuthPhone(supabase, userId);
  const isSuperAdmin = adminUser?.role === 'super_admin' || isSuperAdminPhone(sessionPhone);

  if (!isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return null;
}
