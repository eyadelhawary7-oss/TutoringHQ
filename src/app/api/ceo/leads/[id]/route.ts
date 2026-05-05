import { requireSuperAdminApi } from '@/lib/admin-auth';
import { updateLead } from '@/lib/ceo';
import type { UpdateLeadInput } from '@/types/ceo';
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
    const body = (await parseBodyWithLimit(request, 65536)) as UpdateLeadInput;
    const lead = await updateLead(auth.supabaseAdmin, id, body);
    return NextResponse.json({ lead });
  } catch (e) {
    console.error('[PATCH /api/ceo/leads/[id]]', e);
    return NextResponse.json({ error: 'Failed to update lead' }, { status: 500 });
  }
}
