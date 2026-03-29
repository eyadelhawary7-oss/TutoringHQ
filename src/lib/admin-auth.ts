import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export type InternalRole = 'super_admin' | 'internal_admin' | 'internal_viewer';

export interface AdminContext {
  userId: string;
  internalRole: InternalRole;
  supabaseAdmin: SupabaseClient;
}

function isSuperAdmin(phone: string | null): boolean {
  const admins = process.env.SUPER_ADMIN_PHONES || '';
  return !!phone && admins.split(',').map((p: string) => p.trim()).includes(phone);
}

export async function getAdminContext(request: Request): Promise<AdminContext | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
    return null;
  }

  const authHeader = request.headers.get('Authorization');
  const accessToken = authHeader?.replace('Bearer ', '');
  if (!accessToken) {
    return null;
  }

  const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
  if (authError || !user) {
    return null;
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Check admin_users table first
  const { data: adminRow } = await supabaseAdmin
    .from('admin_users')
    .select('id, role')
    .eq('id', user.id)
    .single();

  // Check phone-based super admin
  const { data: userRecord } = await supabaseAdmin
    .from('users')
    .select('phone')
    .eq('id', user.id)
    .single();
  const adminByPhone = isSuperAdmin(userRecord?.phone ?? null);
  if (!adminRow && !adminByPhone) {
    return null;
  }

  // Determine role: phone-based admins are always super_admin; only super_admin can manage team
  let internalRole: InternalRole = 'internal_viewer';
  if (adminByPhone || adminRow?.role === 'super_admin') {
    internalRole = 'super_admin';
  } else if (adminRow?.role === 'admin' || adminRow?.role === 'internal_admin') {
    internalRole = 'internal_admin';
  } else if (adminRow?.role === 'sales_rep' || adminRow?.role === 'support_agent' || adminRow?.role === 'accountant' || adminRow?.role === 'custom' || adminRow?.role === 'internal_viewer') {
    internalRole = 'internal_viewer';
  }

  return { userId: user.id, internalRole, supabaseAdmin };
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
