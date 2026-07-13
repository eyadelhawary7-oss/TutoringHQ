// /api/admin/staff-requests
//
// GET : the CEO's pending-intake queue. super_admin ONLY (no other role may see or act on
//       it). Returns pending staff_requests awaiting approve/decline.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminContext } from '@/lib/admin-auth';

const REQUEST_SELECT =
  'id, name, phone, email, role, custom_permissions, status, created_at';

export async function GET(request: NextRequest) {
  const ctx = await getAdminContext(request);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // ONLY super_admin sees the queue — no accountant/manager/viewer access.
  if (ctx.internalRole !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data, error } = await ctx.supabaseAdmin
    .from('staff_requests')
    .select(REQUEST_SELECT)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[GET /api/admin/staff-requests]', error);
    return NextResponse.json({ error: 'Failed to load requests' }, { status: 500 });
  }
  return NextResponse.json({ requests: data ?? [] });
}
