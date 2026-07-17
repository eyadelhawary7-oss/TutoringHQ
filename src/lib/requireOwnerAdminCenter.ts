import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { centerAccessGateResponse } from '@/lib/centerAccessGate';

export type OwnerAdminContext = {
  supabaseAdmin: SupabaseClient;
  centerId: string;
  userId: string;
};

export type RequireOwnerAdminOptions = {
  /**
   * When true, a suspended / blacklisted / single-day-locked centre still passes.
   * Only pay / reactivation routes should opt in; every other owner route enforces
   * the gate so a locked centre cannot reach its own tenant data.
   */
  allowSuspended?: boolean;
};

/**
 * Bearer session + users row: owner/admin with center_id.
 * Matches authenticated /api routes that use the anon key + service role.
 */
export async function requireOwnerAdminCenter(
  request: Request,
  options: RequireOwnerAdminOptions = {},
): Promise<OwnerAdminContext | NextResponse> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  let supabaseAdmin: SupabaseClient;
  try {
    supabaseAdmin = getSupabaseAdmin();
  } catch {
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const {
    data: { user },
    error: authErr,
  } = await supabaseAuth.auth.getUser();

  if (authErr || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: userRow } = await supabaseAdmin
    .from('users')
    .select('id, role, center_id')
    .eq('id', user.id)
    .maybeSingle();

  if (!userRow || !['owner', 'admin'].includes(userRow.role as string)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!userRow.center_id) {
    return NextResponse.json({ error: 'No center associated' }, { status: 400 });
  }

  // Suspension / blacklist / single-day billing-lock gate (Job 3 Part 6/9). Folded in
  // here, in ONE place, so every owner route that uses this helper inherits it.
  // Previously this helper had NO gate, so a locked centre owner could still reach its
  // own tenant data through the ~11 routes built on it (e.g. parent-pack/announcement
  // reads students and INSERTS invoices). The lock half is gated by the lockout policy
  // (auto-charge interlock, first_charge_release HELD, kill switch), so nothing locks
  // while auto-charge is inert. Evaluated at request time against the lock moment, not
  // a cron-flipped status. Pay / reactivation routes opt out via allowSuspended.
  if (!options.allowSuspended) {
    const gate = await centerAccessGateResponse(
      supabaseAdmin,
      userRow.center_id as string,
    );
    if (gate) return gate;
  }

  return {
    supabaseAdmin,
    centerId: userRow.center_id as string,
    userId: userRow.id as string,
  };
}
