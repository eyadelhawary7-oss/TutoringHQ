import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function POST(request: NextRequest) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;
  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  let body: { name?: string; subject?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name : '';
  if (!name?.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  }

  const subject =
    typeof body.subject === 'string' && body.subject.trim()
      ? body.subject.trim()
      : null;

  const { error: insertErr } = await supabaseAdmin.from('student_groups').insert({
    center_id: auth.centerId,
    name: name.trim(),
    subject,
  });

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  const { error: rpcErr } = await supabaseAdmin.rpc('complete_onboarding_step_rpc', {
    p_center_id: auth.centerId,
    p_step: 2,
  });

  if (rpcErr) {
    return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
