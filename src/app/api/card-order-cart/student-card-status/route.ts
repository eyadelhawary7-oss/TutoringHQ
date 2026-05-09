import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';
import { parseBodyWithLimit } from '@/lib/validate';
import { fetchStudentCardStatusMap } from '@/lib/card-order-cart/server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const idsRaw = body.ids;
  if (!Array.isArray(idsRaw)) {
    return NextResponse.json({ error: 'ids array required' }, { status: 400 });
  }

  const ids = idsRaw
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim())
    .filter(Boolean);

  if (ids.length > 500) {
    return NextResponse.json({ error: 'Too many ids' }, { status: 400 });
  }

  const map = await fetchStudentCardStatusMap(auth.supabaseAdmin, auth.centerId, ids);
  return NextResponse.json({ statusByStudentId: map });
}
