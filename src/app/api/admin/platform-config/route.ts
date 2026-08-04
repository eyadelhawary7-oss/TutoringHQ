/**
 * Platform config API (super_admin only for writes).
 *
 * SM onboarding SQL (document only - run when Sales Manager is hired):
 * -- Run this when Sales Manager is hired (at center 10):
 * -- INSERT INTO admin_users (id, name, email, role, custom_permissions)
 * -- VALUES (
 * --   '{sm_auth_user_id}',
 * --   'Sales Manager Name',
 * --   'sm@centerhq.com',
 * --   'staff',
 * --   '{
 * --     "can_view_centers": true,
 * --     "can_approve_signups": true,
 * --     "can_view_pipeline": true,
 * --     "can_view_commissions": true,
 * --     "can_approve_signups": true
 * --   }'::jsonb
 * -- );
 *
 * PATCH is not available on can_approve_signups alone - requires super_admin (see requireSuperAdmin).
 */

import { requireSuperAdminApi } from '@/lib/admin-auth';
import { requireSuperAdmin } from '@/lib/admin-access';
import { PLATFORM_CONFIG_INSERT_DEFAULTS } from '@/lib/platformConfigUi';
import { NextRequest, NextResponse } from 'next/server';
import { parseBodyWithLimit } from '@/lib/validate';

/** Accept boolean, number, string, null, or JSON-serializable object/array for jsonb. */
function normalizePatchValue(
  v: unknown,
): boolean | number | string | object | null | undefined {
  if (v === null) return null;
  if (typeof v === 'boolean' || typeof v === 'number' || typeof v === 'string') return v;
  if (typeof v === 'object' && v !== null) return v;
  return undefined;
}

/** GET - all platform_config rows (super_admin). */
export async function GET(request: NextRequest) {
  const auth = await requireSuperAdminApi(request);
  if (!auth.ok) return auth.response;

  const denied = await requireSuperAdmin(auth.supabaseAdmin, auth.userId);
  if (denied) return denied;
  // admin_users.role === 'super_admin' (or env phone super); not can_approve_signups.

  const { data, error } = await auth.supabaseAdmin
    .from('platform_config')
    .select('key, value')
    .order('key', { ascending: true });

  if (error) {
    console.error('[GET /api/admin/platform-config]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ config: data ?? [] });
}

/** PATCH - { key, value } where value is boolean | number | string (super_admin). */
export async function PATCH(request: NextRequest) {
  const auth = await requireSuperAdminApi(request);
  if (!auth.ok) return auth.response;

  const denied = await requireSuperAdmin(auth.supabaseAdmin, auth.userId);
  if (denied) return denied;
  // admin_users.role === 'super_admin'; can_approve_signups does not grant PATCH.

  try {
    const body = (await parseBodyWithLimit(request, 65536)) as { key?: string; value?: unknown };
    const key = typeof body.key === 'string' ? body.key.trim() : '';
    if (!key) {
      return NextResponse.json({ error: 'key is required' }, { status: 400 });
    }

    const { data: existing, error: existErr } = await auth.supabaseAdmin
      .from('platform_config')
      .select('key')
      .eq('key', key)
      .maybeSingle();

    if (existErr) {
      console.error('[PATCH /api/admin/platform-config] key lookup', existErr);
      return NextResponse.json({ error: existErr.message }, { status: 500 });
    }
    const jsonVal = normalizePatchValue(body.value);
    if (jsonVal === undefined) {
      return NextResponse.json(
        { error: 'value must be boolean, number, string, null, or a JSON object' },
        { status: 400 },
      );
    }

    if (!existing) {
      if (!(key in PLATFORM_CONFIG_INSERT_DEFAULTS)) {
        return NextResponse.json({ error: 'Unknown config key' }, { status: 400 });
      }
      const n = typeof jsonVal === 'number' ? jsonVal : Number(jsonVal);
      if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
        return NextResponse.json(
          { error: `${key} must be a non-negative integer` },
          { status: 400 },
        );
      }
      const { data: inserted, error: insErr } = await auth.supabaseAdmin
        .from('platform_config')
        .insert({
          key,
          value: n,
          updated_at: new Date().toISOString(),
        })
        .select('key, value, updated_at')
        .single();
      if (insErr) {
        console.error('[PATCH /api/admin/platform-config] insert', insErr);
        return NextResponse.json({ error: insErr.message }, { status: 500 });
      }
      return NextResponse.json(inserted);
    }

    if (key === 'breakeven_target') {
      const n = typeof jsonVal === 'number' ? jsonVal : Number(jsonVal);
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json({ error: 'breakeven_target must be a non-negative number' }, { status: 400 });
      }
    }
    if (key === 'pack_price_per_parent') {
      const n = typeof jsonVal === 'number' ? jsonVal : Number(jsonVal);
      if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
        return NextResponse.json(
          { error: 'pack_price_per_parent must be a non-negative integer' },
          { status: 400 },
        );
      }
    }

    const { data, error } = await auth.supabaseAdmin
      .from('platform_config')
      .update({ value: jsonVal, updated_at: new Date().toISOString() })
      .eq('key', key)
      .select('key, value, updated_at')
      .single();

    if (error) {
      console.error('[PATCH /api/admin/platform-config]', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (e) {
    console.error('[PATCH /api/admin/platform-config]', e);
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
