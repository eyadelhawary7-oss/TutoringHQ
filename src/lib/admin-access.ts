import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

/** Env-based phone super-admins (same list as admin-auth). */
export function isSuperAdminPhone(phone: string | null): boolean {
  const admins = process.env.SUPER_ADMIN_PHONES || '';
  return !!phone && admins.split(',').map((p: string) => p.trim()).includes(phone);
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

export async function fetchAdminAccessFlags(
  supabase: SupabaseClient,
  userId: string,
): Promise<AdminAccessFlags> {
  const { data: userRow } = await supabase.from('users').select('phone').eq('id', userId).maybeSingle();
  const phoneSuper = isSuperAdminPhone(userRow?.phone ?? null);

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

  const { data: userRow } = await supabase.from('users').select('phone').eq('id', userId).maybeSingle();

  const isSuperAdmin = adminUser?.role === 'super_admin' || isSuperAdminPhone(userRow?.phone ?? null);

  if (!isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return null;
}
