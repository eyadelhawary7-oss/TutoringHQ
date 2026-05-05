import { requireSuperAdminApi } from '@/lib/admin-auth';
import { createAction, getActionQueue } from '@/lib/ceo';
import type { CreateActionInput } from '@/types/ceo';
import { NextRequest, NextResponse } from 'next/server';
import { parseBodyWithLimit } from '@/lib/validate';

export async function GET(request: NextRequest) {
  const auth = await requireSuperAdminApi(request);
  if (!auth.ok) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') ?? '20', 10);
    const queue = await getActionQueue(auth.supabaseAdmin, limit);
    return NextResponse.json(queue);
  } catch (e) {
    console.error('[GET /api/ceo/actions]', e);
    return NextResponse.json({ error: 'Failed to load action queue' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireSuperAdminApi(request);
  if (!auth.ok) return auth.response;

  try {
    const body = (await parseBodyWithLimit(request, 65536)) as CreateActionInput;
    if (!body.title || !body.type || !body.priority) {
      return NextResponse.json(
        { error: 'title, type, and priority required' },
        { status: 400 }
      );
    }
    const action = await createAction(auth.supabaseAdmin, body);
    return NextResponse.json({ action }, { status: 201 });
  } catch (e) {
    console.error('[POST /api/ceo/actions]', e);
    return NextResponse.json({ error: 'Failed to create action' }, { status: 500 });
  }
}
