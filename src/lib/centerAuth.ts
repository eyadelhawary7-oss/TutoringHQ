import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

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

export type CenterAuthOk = {
  ok: true;
  userId: string;
  centerId: string;
  role: string;
  permissions: CenterPermissions;
  supabaseAdmin: SupabaseClient;
};

/** Convenience alias used by centerPermissions helpers. */
export type CenterAuthContext = CenterAuthOk;

export type CenterAuthFail = { ok: false; response: NextResponse };

/**
 * Center-side API auth (Bearer access token). Returns service-role client for server updates.
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
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  const {
    data: { user },
    error,
  } = await supabaseAuth.auth.getUser();
  if (error || !user) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
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

  const { data: userRecord } = await admin
    .from('users')
    .select(
      'id, center_id, role, can_record_payments, can_view_payments, can_manage_billing, can_edit_center_profile, can_delete_students, can_manage_academic_calendar, can_place_card_orders, can_request_referral_payouts'
    )
    .eq('id', user.id)
    .maybeSingle();

  const { data: adminRecord } = await admin.from('admin_users').select('id').eq('id', user.id).maybeSingle();

  if (!userRecord && !adminRecord) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const roleFromUser = String((userRecord as { role?: string } | null)?.role ?? '');
  const isSuperAdmin = roleFromUser === 'super_admin' || !!adminRecord;
  const effectiveRole = adminRecord && !userRecord ? 'super_admin' : roleFromUser;

  let centerId = (userRecord as { center_id?: string | null } | null)?.center_id ?? null;
  const qp =
    request.nextUrl.searchParams.get('center_id')?.trim() ||
    request.headers.get('x-center-id')?.trim() ||
    null;
  if (isSuperAdmin && qp) {
    centerId = qp;
  }

  if (!centerId) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const ur = userRecord as Record<string, unknown> | null;
  const permissions: CenterPermissions = {
    can_record_payments:        Boolean(ur?.can_record_payments),
    can_view_payments:          Boolean(ur?.can_view_payments),
    can_manage_billing:         Boolean(ur?.can_manage_billing),
    can_edit_center_profile:    Boolean(ur?.can_edit_center_profile),
    can_delete_students:        Boolean(ur?.can_delete_students),
    can_manage_academic_calendar: Boolean(ur?.can_manage_academic_calendar),
    can_place_card_orders:      Boolean(ur?.can_place_card_orders),
    can_request_referral_payouts: Boolean(ur?.can_request_referral_payouts),
  };

  return {
    ok: true,
    userId: user.id,
    centerId: centerId as string,
    role: effectiveRole || roleFromUser,
    permissions,
    supabaseAdmin: admin,
  };
}
