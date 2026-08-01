import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';
import { parseBodyWithLimit } from '@/lib/validate';

/** GET: List waitlist for group */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> },
) {
  try {
    const auth = await requireCenterAuth(request);
    if (!auth.ok) return auth.response;

    const { groupId } = await params;
    if (!groupId) return NextResponse.json({ error: 'groupId required' }, { status: 400 });

    const { data: group, error: gErr } = await auth.supabaseAdmin
      .from('student_groups')
      .select('id, center_id')
      .eq('id', groupId)
      .maybeSingle();
    if (gErr || !group || (group as { center_id: string }).center_id !== auth.centerId) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }

    const { data: students, error } = await auth.supabaseAdmin
      .from('students')
      .select('id, name, student_number, parent_phone, waitlist_position')
      .eq('waitlist_group_id', groupId)
      .order('waitlist_position', { ascending: true, nullsFirst: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ waitlist: students ?? [] });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/** POST: Add student to waitlist */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> },
) {
  try {
    const auth = await requireCenterAuth(request);
    if (!auth.ok) return auth.response;

    const { groupId } = await params;
    const body = (await parseBodyWithLimit(request, 65536).catch(() => ({}))) as Record<string, unknown>;
    const studentId = typeof body.student_id === 'string' ? body.student_id : null;

    if (!groupId || !studentId) {
      return NextResponse.json({ error: 'groupId and student_id required' }, { status: 400 });
    }

    const { data: group } = await auth.supabaseAdmin
      .from('student_groups')
      .select('id, center_id')
      .eq('id', groupId)
      .single();

    if (!group || (group as { center_id: string }).center_id !== auth.centerId) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }

    const { data: maxRow } = await auth.supabaseAdmin
      .from('students')
      .select('waitlist_position')
      .eq('waitlist_group_id', groupId)
      .order('waitlist_position', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    const position = ((maxRow as { waitlist_position: number | null } | null)?.waitlist_position ?? 0) + 1;

    const { error: updateError } = await auth.supabaseAdmin
      .from('students')
      .update({ waitlist_group_id: groupId, waitlist_position: position })
      .eq('id', studentId)
      .eq('center_id', (group as { center_id: string }).center_id);

    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

    return NextResponse.json({ ok: true, position });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/** DELETE: Remove a student from a group's waitlist (e.g. once they're enrolled as a full member). */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> },
) {
  try {
    const auth = await requireCenterAuth(request);
    if (!auth.ok) return auth.response;

    const { groupId } = await params;
    const body = (await parseBodyWithLimit(request, 65536).catch(() => ({}))) as Record<string, unknown>;
    const studentId = typeof body.student_id === 'string' ? body.student_id : null;

    if (!groupId || !studentId) {
      return NextResponse.json({ error: 'groupId and student_id required' }, { status: 400 });
    }

    const { data: group } = await auth.supabaseAdmin
      .from('student_groups')
      .select('id, center_id')
      .eq('id', groupId)
      .single();

    if (!group || (group as { center_id: string }).center_id !== auth.centerId) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }

    const { error: updateError } = await auth.supabaseAdmin
      .from('students')
      .update({ waitlist_group_id: null, waitlist_position: null })
      .eq('id', studentId)
      .eq('waitlist_group_id', groupId)
      .eq('center_id', (group as { center_id: string }).center_id);

    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
