import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';
import { parseBodyWithLimit } from '@/lib/validate';

const VALID_STATUSES = ['enrolled', 'active', 'at_risk', 'inactive', 'churned'] as const;

/** PATCH: Update student lifecycle_status */
export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireCenterAuth(request);
    if (!auth.ok) return auth.response;

    const body = (await parseBodyWithLimit(request, 65536).catch(() => ({}))) as Record<string, unknown>;
    const studentId = typeof body.student_id === 'string' ? body.student_id : null;
    const status = typeof body.lifecycle_status === 'string' ? body.lifecycle_status : null;

    if (!studentId || !status) {
      return NextResponse.json({ error: 'student_id and lifecycle_status required' }, { status: 400 });
    }

    if (!VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])) {
      return NextResponse.json({ error: 'Invalid lifecycle_status' }, { status: 400 });
    }

    const { supabaseAdmin, centerId } = auth;

    const { data: student, error: fetchError } = await supabaseAdmin
      .from('students')
      .select('id, center_id')
      .eq('id', studentId)
      .single();

    if (fetchError || !student) {
      return NextResponse.json({ error: 'Student not found' }, { status: 404 });
    }

    if ((student as { center_id?: string }).center_id !== centerId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const updateData: Record<string, unknown> = {
      lifecycle_status: status,
      last_status_change: new Date().toISOString(),
    };
    if (status === 'at_risk') {
      updateData.at_risk_since = new Date().toISOString();
    } else {
      updateData.at_risk_since = null;
    }

    const { error: updateError } = await supabaseAdmin
      .from('students')
      .update(updateData)
      .eq('id', studentId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
