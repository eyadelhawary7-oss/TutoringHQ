import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function POST(request: NextRequest) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;
  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  let body: { step?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const step = body.step;
  if (typeof step !== 'number' || step < 1 || step > 4) {
    return NextResponse.json({ error: 'Invalid step' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin.rpc('complete_onboarding_step_rpc', {
    p_center_id: auth.centerId,
    p_step: step,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
