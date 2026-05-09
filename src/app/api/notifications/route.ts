import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;

  const { supabaseAdmin, userId } = auth;
  const limit = Math.min(50, Math.max(1, Number(request.nextUrl.searchParams.get('limit')) || 20));
  const page = Math.max(1, Number(request.nextUrl.searchParams.get('page')) || 1);
  const offset = (page - 1) * limit;

  const { count: unreadCount, error: unreadErr } = await supabaseAdmin
    .from('in_app_notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('read_at', null);

  if (unreadErr) {
    console.error('[GET /api/notifications] unread count', unreadErr.message);
    return NextResponse.json({ error: unreadErr.message }, { status: 500 });
  }

  const { data: notifications, error } = await supabaseAdmin
    .from('in_app_notifications')
    .select('id, kind, title, body, href, read_at, created_at, center_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error('[GET /api/notifications]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const list = [...(notifications ?? [])].sort((a, b) => {
    const ra = (a as { read_at?: string | null }).read_at ? 1 : 0;
    const rb = (b as { read_at?: string | null }).read_at ? 1 : 0;
    if (ra !== rb) return ra - rb;
    const ta = new Date(String((a as { created_at?: string }).created_at ?? 0)).getTime();
    const tb = new Date(String((b as { created_at?: string }).created_at ?? 0)).getTime();
    return tb - ta;
  });

  return NextResponse.json({
    notifications: list,
    unreadCount: unreadCount ?? 0,
    page,
    limit,
  });
}
