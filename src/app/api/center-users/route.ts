import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';

export async function GET(request: NextRequest) {
  try {
    // Authenticate the caller and resolve their authoritative center_id.
    // Previously this route read `centerId` from the query string and queried
    // `users` via the service-role client with no ownership check, so any
    // authenticated user could read another center's staff by passing its id.
    const auth = await requireCenterAuth(request);
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const requestedCenterId = searchParams.get('centerId');
    const excludeUserId = searchParams.get('excludeUserId');

    // Reject cross-center reads. A non-super-admin may only read their own
    // center; a super-admin may target the requested center explicitly.
    if (
      requestedCenterId &&
      requestedCenterId !== auth.centerId &&
      !auth.isSuperAdmin
    ) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const centerId =
      auth.isSuperAdmin && requestedCenterId ? requestedCenterId : auth.centerId;

    let query = auth.supabaseAdmin
      .from('users')
      .select('id, phone, role')
      .eq('center_id', centerId);

    if (excludeUserId) {
      query = query.neq('id', excludeUserId);
    }

    const { data: users, error } = await query;

    if (error) {
      return NextResponse.json({ error: 'Failed to fetch users', details: error.message }, { status: 500 });
    }

    return NextResponse.json({ users: users || [] });
  } catch (error) {
    return NextResponse.json(
      { error: 'An unexpected error occurred', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
