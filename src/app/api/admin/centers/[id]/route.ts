import { requireSuperAdminApi } from '@/lib/admin-auth';
import { NextRequest, NextResponse } from 'next/server';

const ALLOWED_CENTER_STATUSES = ['active', 'suspended', 'pending', 'rejected'] as const;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireSuperAdminApi(request);
  if (!auth.ok) return auth.response;

  const supabaseAdmin = auth.supabaseAdmin;
  const { id } = await params;

  try {
    const body = (await request.json()) as { status?: string };
    if (body.status && !(ALLOWED_CENTER_STATUSES as readonly string[]).includes(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }
    const updateData: Record<string, unknown> = {};
    if (body.status) updateData.status = body.status;
    const { data, error } = await supabaseAdmin
      .from('centers')
      .update(updateData)
      .eq('id', id)
      .select('id, name, status')
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ center: data });
  } catch (e) {
    console.error('[PATCH /api/admin/centers/[id]]', e);
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
