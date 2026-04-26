import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

async function getOwnerAdminContext(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) return null;

  const accessToken = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!accessToken) return null;

  const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  const {
    data: { user },
    error,
  } = await supabaseAuth.auth.getUser();
  if (error || !user) return null;

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userRow } = await supabaseAdmin
    .from('users')
    .select('role, center_id')
    .eq('id', user.id)
    .maybeSingle();

  if (!userRow || !['owner', 'admin'].includes((userRow.role as string) ?? '') || !userRow.center_id) {
    return { unauthorized: true as const };
  }

  return {
    supabaseAdmin,
    centerId: userRow.center_id as string,
  };
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const ctx = await getOwnerAdminContext(request);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if ('unauthorized' in ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { supabaseAdmin, centerId } = ctx;
  const { id } = await context.params;

  const { error } = await supabaseAdmin
    .from('pending_enrollments')
    .update({ status: 'rejected' })
    .eq('id', id)
    .eq('center_id', centerId);

  if (error) {
    return NextResponse.json({ error: 'Failed to reject request' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
