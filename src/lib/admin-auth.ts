import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { isSuperAdminPhone } from '@/lib/admin-access';

export type InternalRole = 'super_admin' | 'internal_admin' | 'internal_viewer';

export interface AdminContext {
  userId: string;
  internalRole: InternalRole;
  supabaseAdmin: SupabaseClient;
}

export async function getAdminContext(request: Request): Promise<AdminContext | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
    return null;
  }

  let user: { id: string } | null = null;

  const authHeader = request.headers.get('Authorization');
  const accessToken = authHeader?.replace(/^Bearer\s+/i, '')?.trim();
  if (accessToken) {
    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const {
      data: { user: bearerUser },
      error: authError,
    } = await supabaseAuth.auth.getUser();
    if (!authError && bearerUser) {
      user = bearerUser;
    }
  }

  if (!user) {
    const cookieStore = await cookies();
    const supabaseCookie = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            /* read-only cookie context */
          }
        },
      },
    });
    const {
      data: { user: cookieUser },
    } = await supabaseCookie.auth.getUser();
    user = cookieUser ?? null;
  }

  if (!user) {
    return null;
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Check admin_users table first (maybeSingle: internal team may have no public.users row)
  const { data: adminRow } = await supabaseAdmin
    .from('admin_users')
    .select('id, role')
    .eq('id', user.id)
    .maybeSingle();

  const { data: userRecord } = await supabaseAdmin
    .from('users')
    .select('phone, role')
    .eq('id', user.id)
    .maybeSingle();

  const adminByPhone = isSuperAdminPhone(userRecord?.phone ?? null);
  const superByUsersRole = userRecord?.role === 'super_admin';

  if (!adminRow && !adminByPhone && !superByUsersRole) {
    return null;
  }

  // Determine role: phone-based admins are always super_admin; only super_admin can manage team
  let internalRole: InternalRole = 'internal_viewer';
  if (adminByPhone || adminRow?.role === 'super_admin' || superByUsersRole) {
    internalRole = 'super_admin';
  } else if (adminRow?.role === 'admin' || adminRow?.role === 'internal_admin') {
    internalRole = 'internal_admin';
  } else if (
    adminRow?.role === 'staff' ||
    adminRow?.role === 'sales_rep' ||
    adminRow?.role === 'support_agent' ||
    adminRow?.role === 'accountant' ||
    adminRow?.role === 'custom' ||
    adminRow?.role === 'internal_viewer'
  ) {
    internalRole = 'internal_viewer';
  }

  return { userId: user.id, internalRole, supabaseAdmin };
}

/** Informational hierarchy for future use; gates use explicit role names / internalRole, not numeric comparison. */
export const ROLE_HIERARCHY: Record<string, number> = {
  super_admin: 100,
  admin: 80,
  internal_admin: 60,
  accountant: 40,
  sales_rep: 30,
  support_agent: 30,
  internal_viewer: 20,
  custom: 10,
};

function internalRolePermitted(ctx: AdminContext, permitted: ReadonlyArray<string>): boolean {
  const superOnly = permitted.length === 1 && permitted[0] === 'super_admin';
  if (superOnly) return ctx.internalRole === 'super_admin';
  if (permitted.includes('super_admin') && permitted.includes('admin')) {
    return ctx.internalRole === 'super_admin' || ctx.internalRole === 'internal_admin';
  }
  return permitted.includes(ctx.internalRole);
}

/**
 * Returns null when the caller is allowed, or a 403 JSON Response otherwise.
 * Use after `getAdminContext` (pass full {@link AdminContext}) or with `{ role }` from `admin_users`.
 */
export function requireAdminRole(
  admin: AdminContext | { role: string },
  permitted: ReadonlyArray<string>,
): Response | null {
  if ('internalRole' in admin && 'userId' in admin) {
    const ctx = admin as AdminContext;
    if (internalRolePermitted(ctx, permitted)) return null;
    return Response.json(
      { error: 'insufficient_admin_role', required: permitted, current: ctx.internalRole },
      { status: 403 },
    );
  }
  const row = admin as { role: string };
  const allowed =
    permitted.includes(row.role) ||
    (permitted.includes('admin') && row.role === 'internal_admin');
  if (allowed) return null;
  return Response.json(
    { error: 'insufficient_admin_role', required: permitted, current: row.role },
    { status: 403 },
  );
}

export type RequireSuperAdminResult =
  | { ok: true; supabaseAdmin: SupabaseClient; userId: string }
  | { ok: false; response: NextResponse };

/** Bearer JWT + admin context; only `super_admin` internal role (same rules as getAdminContext). */
export async function requireSuperAdminApi(request: Request): Promise<RequireSuperAdminResult> {
  const ctx = await getAdminContext(request);
  if (!ctx) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  if (ctx.internalRole !== 'super_admin') {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { ok: true, supabaseAdmin: ctx.supabaseAdmin, userId: ctx.userId };
}

export type RequireInternalAdminResult =
  | { ok: true; supabaseAdmin: SupabaseClient; userId: string }
  | { ok: false; response: NextResponse };

/** Cookie or Bearer JWT + admin context; allows `super_admin` and `internal_admin`, not `internal_viewer`. */
export async function requireInternalAdminApi(request: Request): Promise<RequireInternalAdminResult> {
  const ctx = await getAdminContext(request);
  if (!ctx) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  if (ctx.internalRole === 'internal_viewer') {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { ok: true, supabaseAdmin: ctx.supabaseAdmin, userId: ctx.userId };
}
