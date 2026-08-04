import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { phoneFromCenterhqAuthEmail } from '@/lib/ownerPhone';
import { normalizePhone, isValidEgyptianMobileE164 } from '@/lib/utils/phone';
import { fetchAdminPermissionKeys } from '@/lib/adminPermissionsStore';

/**
 * Env-based phone super-admins. Both the candidate session phone AND each
 * `SUPER_ADMIN_PHONES` entry are normalized to canonical +20 E.164 and compared
 * EXACTLY — never by digit-substring (the old `normalisePhoneForCompare` did a
 * digits-only `includes`, which is the trailing-match defect: it let one form
 * pass while another failed and could match numbers that are not equal).
 *
 * FAILS CLOSED both ways:
 *   - a candidate that is not a valid Egyptian mobile E.164 matches nobody;
 *   - a `SUPER_ADMIN_PHONES` entry that does not normalize to a valid E.164 is
 *     an operator misconfiguration: it is logged and matches nobody. It is
 *     NEVER silently "corrected" or dropped without the log — a malformed
 *     grant must be visible, not quietly ignored.
 *
 * The caller should prefer the Supabase-Auth-verified session phone
 * (centerAuth/admin-auth pass user.phone from getUser()) over public.users.phone,
 * which is centre-tenant data.
 */
export function isSuperAdminPhone(phone: string | null): boolean {
  const candidate = normalizePhone(typeof phone === 'string' ? phone : '');
  if (!isValidEgyptianMobileE164(candidate)) return false;

  const raw = process.env.SUPER_ADMIN_PHONES || '';
  for (const entry of raw.split(',').map((p) => p.trim()).filter(Boolean)) {
    const normalized = normalizePhone(entry);
    if (!isValidEgyptianMobileE164(normalized)) {
      console.error(
        `[isSuperAdminPhone] SUPER_ADMIN_PHONES entry does not normalize to a valid Egyptian E.164; it matches nobody: "${entry}"`,
      );
      continue;
    }
    if (normalized === candidate) return true;
  }
  return false;
}

/*
 * `customPermissionsToKeys` lived here and was deleted on 2026-07-30 when
 * `public.permissions` became the canonical admin permission store. It
 * normalised `admin_users.custom_permissions`, which nothing reads any more.
 * The column itself is dead and pending a drop — Eyad's call, not now. Keeping
 * an un-called normaliser for it is how a dead column gets re-adopted.
 */

export type AdminAccessFlags = {
  isSuperAdmin: boolean;
  canApproveSignups: boolean;
  adminRole: string | null;
  /** Grants from `public.permissions` — the canonical store since 2026-07-30. */
  permissionKeys: string[];
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
    .select('role')
    .eq('id', userId)
    .maybeSingle();

  // Canonical store. `admin_users.custom_permissions` is NOT read here and is
  // not consulted as a fallback — a dual-read is a dual-store with extra steps,
  // and it would let a stale blob silently out-grant the audited table.
  const permissionKeys = await fetchAdminPermissionKeys(supabase, userId);
  const dbSuper = adminUser?.role === 'super_admin';
  const isSuperAdmin = dbSuper || phoneSuper;
  const canApproveSignups = isSuperAdmin || permissionKeys.includes('can_approve_signups');

  return {
    isSuperAdmin,
    canApproveSignups,
    adminRole: adminUser?.role ?? null,
    permissionKeys,
  };
}

/**
 * Super-admin gate for routes that must stay super_admin-only beyond the JWT.
 * Returns a 403 response if the caller is not a super-admin, else null.
 *
 * RENAMED 4 August 2026, from `requireSuperAdminRow`. NO BEHAVIOUR CHANGED —
 * the body is byte-for-byte what it was. The old name promised a database row
 * and did not require one: it returns true for `adminUser?.role ===
 * 'super_admin'` OR `isSuperAdminPhone(sessionPhone)`, and that second arm
 * reads the SAME `SUPER_ADMIN_PHONES` env var that the first gate
 * (`requireSuperAdminApi` -> `admin-auth.ts`, which returns a session on
 * `adminRow || adminByPhone`) already consulted. Every route that called it
 * believing it had added an independent, DB-backed second check had added
 * nothing. The misleading name is the defect being fixed here; see S10 in
 * design/BUILD-AFTER-REDESIGN.md.
 *
 * THE INTENDED END STATE IS A DIFFERENT FUNCTION, NOT A DIFFERENT NAME.
 * A genuinely row-requiring variant — call it `requireSuperAdminDbRow`, one
 * that drops the `isSuperAdminPhone` arm entirely so an env-phone super-admin
 * with no `admin_users` row is refused — is what S10 actually asks for, at
 * minimum on money movement (PAYOUT-SYSTEM-SPEC.md §7.5) and honestly
 * everywhere. IT IS DELIBERATELY NOT BUILT HERE.
 *
 * Why not: Eyad's sequencing is (a)-first and it is not negotiable. A real
 * `admin_users.role='super_admin'` row must exist for every current
 * env-phone holder BEFORE any gate stops accepting the env phone. Live
 * catalog, 4 August 2026: `admin_users` holds 2 rows, exactly 1 of them
 * `super_admin`. Tightening the gate first would lock the only super-admin
 * out of the very surface needed to create the missing rows. Do not "finish
 * the job" by deleting the phone arm below until (a) is done and confirmed
 * against information_schema — that change is the outage, not the fix.
 */
export async function requireSuperAdmin(
  supabase: SupabaseClient,
  userId: string,
): Promise<NextResponse | null> {
  const { data: adminUser } = await supabase
    .from('admin_users')
    .select('role')
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
