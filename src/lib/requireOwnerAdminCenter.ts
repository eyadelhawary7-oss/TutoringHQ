import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export type OwnerAdminContext = {
  supabaseAdmin: SupabaseClient;
  centerId: string;
  userId: string;
};

/**
 * Bearer session + users row: owner/admin with center_id.
 * Matches authenticated /api routes that use the anon key + service role.
 */
export async function requireOwnerAdminCenter(
  request: Request,
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

  return {
    supabaseAdmin,
    centerId: userRow.center_id as string,
    userId: userRow.id as string,
  };
}
