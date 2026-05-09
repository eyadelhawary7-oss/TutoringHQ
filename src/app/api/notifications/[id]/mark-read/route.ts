import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';

export const dynamic = 'force-dynamic';

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  const nid = id?.trim();
  if (!nid) {
    return NextResponse.json({ error: 'Bad id' }, { status: 400 });
  }

  const { supabaseAdmin, userId } = auth;
  const now = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from('in_app_notifications')
    .update({ read_at: now })
    .eq('id', nid)
    .eq('user_id', userId)
    .select('id')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
