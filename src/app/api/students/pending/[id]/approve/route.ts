import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';
import { afterStudentWriteParentPackEffects } from '@/lib/studentParentPackWelcome';
import { logAdminAction } from '@/lib/audit';
import { parseBodyWithLimit } from '@/lib/validate';

type ApproveStudentRpcRow = {
  new_student_count?: number | null;
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) {
    return auth.response;
  }

  const { supabaseAdmin, centerId, userId } = auth;
  const { id: studentId } = await context.params;

  const body = (await parseBodyWithLimit(request, 65536).catch(() => ({}))) as {
    groupIds?: string[];
    guardianConsentConfirmed?: unknown;
  };
  const groupIds: string[] = body.groupIds ?? [];

  // Server-side guardian-consent gate: approving a pending enrollment brings a
  // student onto the center's active roster, so the center must confirm it holds
  // the guardian's consent. Reject if absent; the two proof columns are stamped
  // on the student row after the approval RPC succeeds.
  if (body.guardianConsentConfirmed !== true) {
    return NextResponse.json(
      { error: 'guardian_consent_required', code: 'GUARDIAN_CONSENT_REQUIRED' },
      { status: 403 },
    );
  }

  const { data: rpcResult, error: rpcErr } = await supabaseAdmin.rpc('approve_student_rpc', {
    p_student_id: studentId,
    p_center_id: centerId,
    p_group_ids: groupIds,
    p_approved_by: userId ?? null,
  });

  if (rpcErr) {
    if (rpcErr.message === 'student_not_found') {
      return NextResponse.json({ error: 'student_not_found' }, { status: 404 });
    }
    if (rpcErr.message === 'student_already_active') {
      return NextResponse.json({ error: 'already_active' }, { status: 409 });
    }
    return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  }

  // Record the guardian-consent proof on the now-approved student row.
  await supabaseAdmin
    .from('students')
    .update({
      guardian_consent_confirmed_at: new Date().toISOString(),
      guardian_consent_confirmed_by: userId ?? null,
    })
    .eq('id', studentId)
    .eq('center_id', centerId);

  await logAdminAction(userId ?? 'unknown', 'student_approval', { studentId, centerId }, centerId);

  const { data: studentRow } = await supabaseAdmin
    .from('students')
    .select('id, name, parent_phone, parent_pack_opted_in')
    .eq('id', studentId)
    .eq('center_id', centerId)
    .maybeSingle();

  const postProcessingTasks: Promise<unknown>[] = [];
  if (studentRow) {
    postProcessingTasks.push(
      afterStudentWriteParentPackEffects(supabaseAdmin, {
        kind: 'insert',
        centerId,
        // chq_parent_welcome intentionally not wired to approval - send manually when ready
        skipParentWelcome: true,
        row: {
          id: studentRow.id,
          name: studentRow.name,
          parent_phone: studentRow.parent_phone,
          parent_pack_opted_in: studentRow.parent_pack_opted_in,
        },
      }),
    );
  }

  await Promise.all(postProcessingTasks);

  const row = rpcResult as ApproveStudentRpcRow | null;
  return NextResponse.json({
    success: true,
    studentId,
    newStudentCount: row?.new_student_count ?? null,
  });
}
