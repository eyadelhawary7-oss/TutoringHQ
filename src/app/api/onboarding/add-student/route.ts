import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function POST(request: NextRequest) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;
  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  let body: { name?: string; phone?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name : '';
  if (!name?.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  }

  const phone =
    typeof body.phone === 'string' && body.phone.trim()
      ? body.phone.trim()
      : null;

  const { data: center, error: centerErr } = await supabaseAdmin
    .from('centers')
    .select('student_sequence')
    .eq('id', auth.centerId)
    .single();

  if (centerErr) {
    return NextResponse.json({ error: centerErr.message }, { status: 500 });
  }

  const seq =
    (center as { student_sequence?: number | null } | null)?.student_sequence ?? 1;
  const studentNumber = '#' + String(seq).padStart(4, '0');

  const { error: insertErr } = await supabaseAdmin.from('students').insert({
    center_id: auth.centerId,
    student_number: studentNumber,
    name: name.trim(),
    phone,
    is_active: true,
  });

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  const { error: updateErr } = await supabaseAdmin
    .from('centers')
    .update({ student_sequence: seq + 1 })
    .eq('id', auth.centerId);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  const { count, error: countErr } = await supabaseAdmin
    .from('students')
    .select('id', { count: 'exact', head: true })
    .eq('center_id', auth.centerId)
    .eq('is_active', true);

  if (countErr) {
    return NextResponse.json({ error: countErr.message }, { status: 500 });
  }

  const { error: rpcErr } = await supabaseAdmin.rpc('complete_onboarding_step_rpc', {
    p_center_id: auth.centerId,
    p_step: 1,
  });

  if (rpcErr) {
    return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    studentCount: count ?? 1,
  });
}
