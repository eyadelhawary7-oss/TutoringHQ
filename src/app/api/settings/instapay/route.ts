import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';

export const dynamic = 'force-dynamic';

function normalizeInstapay(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length !== 11 || !digits.startsWith('01')) return null;
  return digits;
}

export async function PATCH(request: NextRequest) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;
  if (auth.role !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { instapay_number?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const normalized = normalizeInstapay(typeof body.instapay_number === 'string' ? body.instapay_number : '');
  if (!normalized) {
    return NextResponse.json(
      { error: 'InstaPay number must be 11 digits starting with 01' },
      { status: 400 },
    );
  }

  const { error } = await auth.supabaseAdmin
    .from('centers')
    .update({ instapay_number: normalized })
    .eq('id', auth.centerId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
