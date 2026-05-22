import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as Sentry from '@sentry/nextjs';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { isSuperAdminPhone } from '@/lib/admin-access';

export type CenterPermissions = {
  can_record_payments: boolean;
  can_view_payments: boolean;
  can_manage_billing: boolean;
  can_edit_center_profile: boolean;
  can_delete_students: boolean;
  can_manage_academic_calendar: boolean;
  can_place_card_orders: boolean;
  can_request_referral_payouts: boolean;
};

export type CenterAuthErrorCode =
  | 'NO_BEARER'
  | 'TOKEN_INVALID'
  | 'NO_USER_ROW'
  | 'NO_CENTER_ID';

export type CenterAuthOk = {
  ok: true;
  userId: string;
  centerId: string;
  /**
   * Centre-side role (`owner`/`assistant`/…) OR `'super_admin'` when the caller
   * is an admin_users-derived super-admin with no users row. Do NOT use this
   * string for super-admin gating — `public.users.role` is centre-tenant-writable
   * and not authoritative. Use `isSuperAdmin` instead.
   */
  role: string;
  /**
   * Strict super-admin flag. True ONLY when the caller has an `admin_users` row
   * OR their phone is in `SUPER_ADMIN_PHONES`. Never derived from
   * `public.users.role`. This is the authoritative cross-tenant authority check.
   */
  isSuperAdmin: boolean;
  permissions: CenterPermissions;
  supabaseAdmin: SupabaseClient;
};

/** Convenience alias used by centerPermissions helpers. */
export type CenterAuthContext = CenterAuthOk;

export type CenterAuthFail = { ok: false; response: NextResponse };

const ZERO_PERMISSIONS: CenterPermissions = {
  can_record_payments: false,
  can_view_payments: false,
  can_manage_billing: false,
  can_edit_center_profile: false,
  can_delete_students: false,
  can_manage_academic_calendar: false,
  can_place_card_orders: false,
  can_request_referral_payouts: false,
};

function unauthorized(code: CenterAuthErrorCode): NextResponse {
  return NextResponse.json({ error: 'Unauthorized', code }, { status: 401 });
}

/**
 * Center-side API auth (Bearer access token). Returns service-role client for server updates.
 *
 * Why two SELECTs against `users`: the old single SELECT pulled permission columns
 * alongside id/center_id/role. When a permission column was missing in the deployed
 * schema, PostgREST errored, supabase-js returned data:null, the error was discarded,
 * and the function treated silent column-drift as "no user row" — locking real users
 * out for nine days. The CORE select carries only the columns auth needs; the
 * PERMISSIONS select is best-effort and warns in Sentry on failure instead of 401ing.
 */
export async function requireCenterAuth(request: NextRequest): Promise<CenterAuthOk | CenterAuthFail> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Server misconfigured' }, { status: 500 }),
    };
  }

  const authHeader = request.headers.get('Authorization');
  const accessToken = authHeader?.replace(/^Bearer\s+/i, '')?.trim();
  if (!accessToken) {
    return { ok: false, response: unauthorized('NO_BEARER') };
  }

  const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  const {
    data: { user },
    error: authErr,
  } = await supabaseAuth.auth.getUser();
  if (authErr || !user) {
    Sentry.withScope((scope) => {
      scope.setTag('route', 'centerAuth');
      scope.setTag('step', 'getUser');
      Sentry.captureMessage(
        `centerAuth getUser rejected token: ${authErr?.message ?? 'no user'}`,
        'warning',
      );
    });
    return { ok: false, response: unauthorized('TOKEN_INVALID') };
  }

  let admin: SupabaseClient;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Server misconfigured' }, { status: 500 }),
    };
  }

  // CORE lookup: only the columns auth absolutely needs. A non-null error here is
  // real infrastructure failure (DB unreachable, etc.) — surface as a hard auth
  // failure with Sentry exception capture rather than silently coercing to null.
  const { data: userRecord, error: coreErr } = await admin
    .from('users')
    .select('id, center_id, role, phone')
    .eq('id', user.id)
    .maybeSingle();

  if (coreErr) {
    Sentry.withScope((scope) => {
      scope.setTag('route', 'centerAuth');
      scope.setTag('step', 'core_user_lookup');
      Sentry.captureException(coreErr);
    });
    return { ok: false, response: unauthorized('TOKEN_INVALID') };
  }

  const { data: adminRecord } = await admin
    .from('admin_users')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();

  if (!userRecord && !adminRecord) {
    Sentry.withScope((scope) => {
      scope.setTag('route', 'centerAuth');
      scope.setTag('step', 'no_user_row');
      Sentry.captureMessage(
        `centerAuth: authenticated user has no users or admin_users row (id=${user.id})`,
        'warning',
      );
    });
    return { ok: false, response: unauthorized('NO_USER_ROW') };
  }

  const roleFromUser = String((userRecord as { role?: string } | null)?.role ?? '');
  const userPhone = (userRecord as { phone?: string | null } | null)?.phone ?? null;
  // Authoritative super-admin sources only. NEVER trust `users.role` here:
  // `public.users.role` is the centre-tenant role (owner/assistant/…) and is
  // writable by centre admins via /api/db. A prior P0 let `users.role =
  // 'super_admin'` elevate centerAuth and pivot cross-tenant via
  // `?center_id=` / `x-center-id`.
  const isSuperAdmin = !!adminRecord || isSuperAdminPhone(userPhone);
  const effectiveRole = isSuperAdmin && !userRecord ? 'super_admin' : roleFromUser;

  let centerId = (userRecord as { center_id?: string | null } | null)?.center_id ?? null;
  const qp =
    request.nextUrl.searchParams.get('center_id')?.trim() ||
    request.headers.get('x-center-id')?.trim() ||
    null;
  if (isSuperAdmin && qp) {
    centerId = qp;
  }

  if (!centerId) {
    return { ok: false, response: unauthorized('NO_CENTER_ID') };
  }

  // PERMISSIONS lookup: best-effort. If a can_* column is missing (schema drift)
  // or the query fails for any other reason, warn in Sentry and default all flags
  // to false. Core auth still succeeds; owners/super_admins override these flags
  // in downstream callers anyway.
  let permissions: CenterPermissions = { ...ZERO_PERMISSIONS };
  if (userRecord) {
    const { data: permsRow, error: permsErr } = await admin
      .from('users')
      .select(
        'can_record_payments, can_view_payments, can_manage_billing, can_edit_center_profile, can_delete_students, can_manage_academic_calendar, can_place_card_orders, can_request_referral_payouts',
      )
      .eq('id', user.id)
      .maybeSingle();

    if (permsErr) {
      Sentry.withScope((scope) => {
        scope.setTag('route', 'centerAuth');
        scope.setTag('step', 'permission_flags');
        Sentry.captureMessage(
          `centerAuth permission-column lookup failed: ${permsErr.message}`,
          'warning',
        );
      });
    } else if (permsRow) {
      const pr = permsRow as Record<string, unknown>;
      permissions = {
        can_record_payments:          Boolean(pr.can_record_payments),
        can_view_payments:            Boolean(pr.can_view_payments),
        can_manage_billing:           Boolean(pr.can_manage_billing),
        can_edit_center_profile:      Boolean(pr.can_edit_center_profile),
        can_delete_students:          Boolean(pr.can_delete_students),
        can_manage_academic_calendar: Boolean(pr.can_manage_academic_calendar),
        can_place_card_orders:        Boolean(pr.can_place_card_orders),
        can_request_referral_payouts: Boolean(pr.can_request_referral_payouts),
      };
    }
  }

  return {
    ok: true,
    userId: user.id,
    centerId: centerId as string,
    role: effectiveRole || roleFromUser,
    isSuperAdmin,
    permissions,
    supabaseAdmin: admin,
  };
}
