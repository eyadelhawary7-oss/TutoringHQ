import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;
  // Preserve the original owner/admin-only gate.
  if (!['owner', 'admin'].includes(auth.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { supabaseAdmin, centerId } = auth;
  const { id } = await context.params;

  const { error } = await supabaseAdmin
    .from('pending_enrollments')
    .update({ status: 'rejected' })
    .eq('id', id)
    .eq('center_id', centerId);

  if (error) {
    return NextResponse.json({ error: 'Failed to reject request' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
