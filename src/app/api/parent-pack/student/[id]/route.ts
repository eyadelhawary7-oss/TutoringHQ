import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';
import { currentBillingPeriod } from '@/lib/parentPack';
import { afterStudentPackToggle } from '@/lib/studentParentPackWelcome';
import { parseBodyWithLimit } from '@/lib/validate';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;
  // Preserve the original owner/admin-only gate.
  if (!['owner', 'admin'].includes(auth.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { supabaseAdmin, centerId } = auth;

  const { data: student } = await supabaseAdmin
    .from('students')
    .select('id, name, parent_phone, parent_pack_opted_in')
    .eq('id', id)
    .eq('center_id', centerId)
    .maybeSingle();

  if (!student) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let body: { parent_pack_opted_in?: boolean; opted_in?: boolean };
  try {
    body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const nextOpted =
    typeof body.parent_pack_opted_in === 'boolean'
      ? body.parent_pack_opted_in
      : typeof body.opted_in === 'boolean'
        ? body.opted_in
        : undefined;

  if (typeof nextOpted !== 'boolean') {
    return NextResponse.json({ error: 'parent_pack_opted_in or opted_in boolean required' }, { status: 400 });
  }

  if (nextOpted) {
    if (!student.parent_phone?.trim()) {
      return NextResponse.json({ error: 'no_parent_phone' }, { status: 400 });
    }
  }

  const prevOptedIn = student.parent_pack_opted_in === true;

  const { error: updateError } = await supabaseAdmin
    .from('students')
    .update({ parent_pack_opted_in: nextOpted })
    .eq('id', id)
    .eq('center_id', centerId);

  if (updateError) {
    console.error('[PATCH /api/parent-pack/student/[id]]', updateError);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }

  await afterStudentPackToggle(
    supabaseAdmin,
    centerId,
    {
      name: student.name ?? '',
      parent_phone: student.parent_phone,
    },
    nextOpted,
    prevOptedIn,
  );

  if (nextOpted) {
    const { data: row } = await supabaseAdmin
      .from('students')
      .select('parent_phone, center_id')
      .eq('id', id)
      .maybeSingle();

    if (row?.parent_phone) {
      const { error: countErr } = await supabaseAdmin.from('parent_pack_monthly_counts').upsert(
        {
          center_id: row.center_id,
          billing_period: currentBillingPeriod(),
          student_id: id,
          parent_phone: row.parent_phone,
          opted_in_at: new Date().toISOString(),
        },
        { onConflict: 'center_id,billing_period,student_id', ignoreDuplicates: true },
      );
      if (countErr) {
        console.error('[PATCH /api/parent-pack/student/[id]] monthly_counts', countErr);
      }
    }
  }

  const { data: centerRow } = await supabaseAdmin
    .from('centers')
    .select('parent_pack_active_parents')
    .eq('id', centerId)
    .maybeSingle();

  const activeParents = centerRow?.parent_pack_active_parents ?? 0;

  return NextResponse.json({
    success: true,
    activeParents,
    activeCount: activeParents,
  });
}
