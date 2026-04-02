import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: 'Missing Supabase config' }, { status: 500 });
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { count, error } = await supabaseAdmin
    .from('centers')
    .select('id', { count: 'exact', head: true })
    .eq('pack_request_status', 'pending');

  if (error) {
    console.error('[cron/pack-request-check]', error);
    return NextResponse.json({ error: 'Count failed' }, { status: 500 });
  }

  const n = count ?? 0;
  console.log(`[pack-request-check] Pending WA pack requests: ${n}`);
  return NextResponse.json({ pendingRequests: n });
}
