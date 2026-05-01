import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function POST(req: NextRequest) {
  const auth = await requireCenterAuth(req);
  if (!auth.ok) return auth.response;
  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  const { error: metricErr } = await supabaseAdmin.rpc('upsert_scan_metric', {
    p_center_id: auth.centerId,
    p_scanned_at: now,
    p_metric_date: today,
  });

  if (metricErr) {
    return NextResponse.json({ error: metricErr.message }, { status: 500 });
  }

  const { error: rpcErr } = await supabaseAdmin.rpc('complete_onboarding_step_rpc', {
    p_center_id: auth.centerId,
    p_step: 3,
  });

  if (rpcErr) {
    return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
