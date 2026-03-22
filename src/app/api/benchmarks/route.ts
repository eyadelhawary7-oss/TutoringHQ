import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

async function getUserContext(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) return null;

  const authHeader = request.headers.get('Authorization');
  const accessToken = authHeader?.replace('Bearer ', '');
  if (!accessToken) return null;

  const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  const { data: { user }, error } = await supabaseAuth.auth.getUser();
  if (error || !user) return null;

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  const { data: userRecord } = await supabaseAdmin
    .from('users')
    .select('id, center_id, organization_id')
    .eq('id', user.id)
    .single();

  if (!userRecord?.center_id && !userRecord?.organization_id) return null;

  return { user: userRecord, authUser: user, supabaseAdmin };
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getUserContext(request);
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { user: userRecord, authUser, supabaseAdmin } = ctx;
    const { searchParams } = new URL(request.url);
    const centerIdParam = searchParams.get('center_id');

    let centerId: string | null = userRecord.center_id;

    if (centerIdParam && userRecord.organization_id) {
      const { data: assignment } = await supabaseAdmin
        .from('branch_user_assignments')
        .select('center_id')
        .eq('user_id', authUser.id)
        .eq('center_id', centerIdParam)
        .maybeSingle();

      const { data: orgCenters } = await supabaseAdmin
        .from('centers')
        .select('id')
        .eq('organization_id', userRecord.organization_id)
        .eq('id', centerIdParam);

      if (assignment || (orgCenters?.length ?? 0) > 0) {
        centerId = centerIdParam;
      }
    } else if (centerIdParam && centerIdParam === userRecord.center_id) {
      centerId = centerIdParam;
    }

    if (!centerId && userRecord.organization_id) {
      const { data: firstCenter } = await supabaseAdmin
        .from('centers')
        .select('id')
        .eq('organization_id', userRecord.organization_id)
        .limit(1)
        .maybeSingle();
      if (firstCenter) centerId = (firstCenter as { id: string }).id;
    }

    if (!centerId) return NextResponse.json({ error: 'No center' }, { status: 400 });

    const { data, error } = await supabaseAdmin.rpc('get_center_benchmarks', {
      p_center_id: centerId,
    });

    if (error) {
      console.error('[benchmarks] RPC error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data ?? {});
  } catch (err) {
    console.error('[benchmarks] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
