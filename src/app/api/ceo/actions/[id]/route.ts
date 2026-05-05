import { requireSuperAdminApi } from '@/lib/admin-auth';
import { resolveAction, snoozeAction } from '@/lib/ceo';
import { NextRequest, NextResponse } from 'next/server';
import { parseBodyWithLimit } from '@/lib/validate';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireSuperAdminApi(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  try {
    const body = (await parseBodyWithLimit(request, 65536)) as { resolved?: boolean; snoozed_until?: string };
    if (body.resolved) {
      await resolveAction(auth.supabaseAdmin, id);
    } else if (body.snoozed_until) {
      await snoozeAction(auth.supabaseAdmin, id, body.snoozed_until);
    } else {
      return NextResponse.json(
        { error: 'resolved or snoozed_until required' },
        { status: 400 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[PATCH /api/ceo/actions/[id]]', e);
    return NextResponse.json({ error: 'Failed to update action' }, { status: 500 });
  }
}
