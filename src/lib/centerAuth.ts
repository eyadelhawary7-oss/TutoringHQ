import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as Sentry from '@sentry/nextjs';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { isSuperAdminPhone } from '@/lib/admin-access';
import { phoneFromCenterhqAuthEmail } from '@/lib/ownerPhone';

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
  | 'NO_CENTER_ID'
  | 'CENTER_SUSPENDED'
  | 'CENTER_BLACKLISTED'
  | 'TEACHER_NOT_MEMBER'
  | 'TEACHER_NO_CENTER_CONTEXT'
  | 'NOT_A_TEACHER'
  | 'NO_PRIVATE_ACCESS';

export type RequireCenterAuthOptions = {
  /**
   * When true, a centre whose `status='suspended'` or `is_blacklisted=true`
   * may still pass auth. Only the reactivation / pay routes should opt in
   * (a suspended owner needs to be able to pay to come back online).
   *
   * Default: false , the gate is on for every centre-side route by default.
   */
  allowSuspended?: boolean;
};

export type CenterAuthOk = {
  ok: true;
  userId: string;
  centerId: string;
  /**
   * Centre-side role (`owner`/`assistant`/…) OR `'super_admin'` when the caller
   * is an admin_users-derived super-admin with no users row. Do NOT use this
   * string for super-admin gating - `public.users.role` is centre-tenant-writable
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

function suspended(code: 'CENTER_SUSPENDED' | 'CENTER_BLACKLISTED'): NextResponse {
  return NextResponse.json({ error: 'Center access blocked', code }, { status: 403 });
}

function forbidden(code: CenterAuthErrorCode): NextResponse {
  return NextResponse.json({ error: 'Forbidden', code }, { status: 403 });
}

/**
 * Center-side API auth (Bearer access token). Returns service-role client for server updates.
 *
 * Why two SELECTs against `users`: the old single SELECT pulled permission columns
 * alongside id/center_id/role. When a permission column was missing in the deployed
 * schema, PostgREST errored, supabase-js returned data:null, the error was discarded,
 * and the function treated silent column-drift as "no user row" - locking real users
 * out for nine days. The CORE select carries only the columns auth needs; the
 * PERMISSIONS select is best-effort and warns in Sentry on failure instead of 401ing.
 */
export async function requireCenterAuth(
  request: NextRequest,
  options: RequireCenterAuthOptions = {},
): Promise<CenterAuthOk | CenterAuthFail> {
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
  // real infrastructure failure (DB unreachable, etc.) - surface as a hard auth
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
  // Authoritative super-admin sources only. NEVER trust `users.role` here:
  // `public.users.role` is the centre-tenant role (owner/assistant/…) and is
  // writable by centre admins via /api/db. A prior P0 let `users.role =
  // 'super_admin'` elevate centerAuth and pivot cross-tenant via
  // `?center_id=` / `x-center-id`.
  //
  // Phone source: derive from the auth.users.email local-part. CenterHQ uses
  // phone+PIN auth where the auth email is `<phonedigits>@centerhq.local`,
  // set by `auth.admin.createUser({ email })` at signup; `auth.users.phone`
  // is left null. The email is the structural identity , it is set by us
  // server-side and is NOT writable via the /api/db proxy. Falling back to
  // auth.users.phone (in case Supabase phone-OTP is ever enabled) and then
  // public.users.phone (defence-in-depth, blocked at the proxy by
  // dbProxyProtectedColumns) preserves backward compatibility, but the email
  // path engages for every real centre/admin account today.
  const emailPhone = phoneFromCenterhqAuthEmail(
    (user as { email?: string | null }).email,
  );
  const sessionPhone = (user as { phone?: string | null }).phone ?? null;
  const userPhone =
    emailPhone ?? sessionPhone ?? (userRecord as { phone?: string | null } | null)?.phone ?? null;
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

  // Teacher branch (Model B). Teachers are centre-less on public.users
  // (center_id is NULL, same branch as super_admin). A teacher reaches a
  // centre-scoped route only by naming a centre they are an ACTIVE member of,
  // via ?center_id= or the x-center-id header. Membership lives in
  // teacher_center.teacher_id, which stores the user id directly
  // (teacher_center.teacher_id -> teacher_profiles.user_id -> users.id, one uuid).
  // A teacher naming no centre is in their private context, which this helper
  // does not serve, so return a distinct code and let the route use
  // requireTeacherAuth. On success centerId is the named member centre, a
  // non-null string, so no downstream route sees a nullable centre.
  if (effectiveRole === 'teacher') {
    if (!qp) {
      return { ok: false, response: forbidden('TEACHER_NO_CENTER_CONTEXT') };
    }
    const { data: memberships, error: membershipErr } = await admin
      .from('teacher_center')
      .select('center_id')
      .eq('teacher_id', user.id)
      .eq('status', 'active');
    if (membershipErr) {
      Sentry.withScope((scope) => {
        scope.setTag('route', 'centerAuth');
        scope.setTag('step', 'teacher_membership_lookup');
        Sentry.captureException(membershipErr);
      });
      return { ok: false, response: unauthorized('TOKEN_INVALID') };
    }
    const memberCenterIds = new Set(
      (memberships ?? []).map((m: { center_id: string }) => m.center_id),
    );
    if (!memberCenterIds.has(qp)) {
      return { ok: false, response: forbidden('TEACHER_NOT_MEMBER') };
    }
    centerId = qp;
  }

  if (!centerId) {
    return { ok: false, response: unauthorized('NO_CENTER_ID') };
  }

  // Suspension / blacklist gate. Previously enforced only by the middleware,
  // which skips `/api/*` routes (src/proxy.ts) , so a suspended or blacklisted
  // centre retained full API access by talking to the API directly. Now the
  // gate sits in centerAuth so every centre-side route inherits it from one
  // place. Super-admins (admin_users / SUPER_ADMIN_PHONES) bypass for support
  // workflows; the reactivation routes opt in via `allowSuspended: true` so a
  // suspended owner can still pay to come back online.
  if (!isSuperAdmin && !options.allowSuspended) {
    const { data: centerStatusRow } = await admin
      .from('centers')
      .select('status, is_blacklisted')
      .eq('id', centerId)
      .maybeSingle();

    const csr = centerStatusRow as
      | { status?: string | null; is_blacklisted?: boolean | null }
      | null;
    if (csr?.is_blacklisted === true) {
      return { ok: false, response: suspended('CENTER_BLACKLISTED') };
    }
    if (csr && String(csr.status ?? '').toLowerCase() === 'suspended') {
      return { ok: false, response: suspended('CENTER_SUSPENDED') };
    }
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

export type TeacherAuthOk = {
  ok: true;
  userId: string;
  centerIds: string[];
  supabaseAdmin: SupabaseClient;
};

/**
 * Centre-less teacher auth (Model B). For routes serving a teacher in their
 * private context where there is no single centre. Returns the teacher user id
 * and the set of centres they are an active member of (may be empty for a pure
 * private teacher). Suspension is NOT gated here, SELECT is never
 * suspension-gated; every teacher WRITE carries NOT is_auth_teacher_suspended()
 * in RLS and the RPCs.
 */
export async function requireTeacherAuth(
  request: NextRequest,
): Promise<TeacherAuthOk | CenterAuthFail> {
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

  const { data: userRecord, error: coreErr } = await admin
    .from('users')
    .select('id, role')
    .eq('id', user.id)
    .maybeSingle();
  if (coreErr) {
    Sentry.withScope((scope) => {
      scope.setTag('route', 'teacherAuth');
      scope.setTag('step', 'core_user_lookup');
      Sentry.captureException(coreErr);
    });
    return { ok: false, response: unauthorized('TOKEN_INVALID') };
  }
  if (!userRecord) {
    return { ok: false, response: unauthorized('NO_USER_ROW') };
  }
  if (String((userRecord as { role?: string }).role ?? '') !== 'teacher') {
    return { ok: false, response: forbidden('NOT_A_TEACHER') };
  }

  const { data: memberships, error: membershipErr } = await admin
    .from('teacher_center')
    .select('center_id')
    .eq('teacher_id', user.id)
    .eq('status', 'active');
  if (membershipErr) {
    Sentry.withScope((scope) => {
      scope.setTag('route', 'teacherAuth');
      scope.setTag('step', 'teacher_membership_lookup');
      Sentry.captureException(membershipErr);
    });
    return { ok: false, response: unauthorized('TOKEN_INVALID') };
  }

  const centerIds = Array.from(
    new Set((memberships ?? []).map((m: { center_id: string }) => m.center_id)),
  );

  return { ok: true, userId: user.id, centerIds, supabaseAdmin: admin };
}

export type TeacherPrivateAccessOk = TeacherAuthOk;
export type TeacherPrivateAccessFail = CenterAuthFail;

/**
 * Paid private-engine gate. Composes on requireTeacherAuth and additionally
 * requires an active or trialing teacher_subscriptions row, checked via the
 * STABLE SQL function teacher_private_access(p_user_id). Lapsed
 * (past_due/suspended/cancelled) and never-subscribed teachers get 403
 * NO_PRIVATE_ACCESS. The gate result is never cached, it is re-evaluated on
 * every call: the check is a single indexed existence test, and staleness
 * here would mean a lapsed teacher retaining access to paid data.
 *
 * Failure-mode rule (Rule 151 / ADR 023): an ERROR is not a STATE. If the
 * gate RPC itself fails that is infrastructure failure, so DENY (fail closed,
 * this is a security gate) but surface as 500 GATE_CHECK_FAILED + Sentry,
 * never as 403 NO_PRIVATE_ACCESS. A DB blip must never show a paying teacher
 * the "your subscription lapsed" state.
 */
export async function requireTeacherPrivateAccess(
  request: NextRequest,
): Promise<TeacherPrivateAccessOk | TeacherPrivateAccessFail> {
  const auth = await requireTeacherAuth(request);
  if (!auth.ok) {
    return auth;
  }

  const { data, error: gateErr } = await auth.supabaseAdmin.rpc(
    'teacher_private_access',
    { p_user_id: auth.userId },
  );

  if (gateErr) {
    Sentry.withScope((scope) => {
      scope.setTag('route', 'teacherPrivateAccess');
      scope.setTag('step', 'gate_rpc');
      Sentry.captureException(gateErr);
    });
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Server error', code: 'GATE_CHECK_FAILED' },
        { status: 500 },
      ),
    };
  }

  // The RPC returns boolean; anything other than strict true (false, null,
  // unexpected shape) is treated as no access.
  const hasAccess: unknown = data;
  if (hasAccess !== true) {
    return { ok: false, response: forbidden('NO_PRIVATE_ACCESS') };
  }

  return auth;
}
