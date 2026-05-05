import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';
import { parseBodyWithLimit } from '@/lib/validate';

/** GET: List families for center */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireCenterAuth(request);
    if (!auth.ok) return auth.response;

    const { data, error } = await auth.supabaseAdmin
      .from('families')
      .select('id, family_name, parent_phone, parent_name')
      .eq('center_id', auth.centerId)
      .order('family_name');

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ families: data ?? [] });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/** POST: Create new family */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireCenterAuth(request);
    if (!auth.ok) return auth.response;

    const body = (await parseBodyWithLimit(request, 65536).catch(() => ({}))) as Record<string, unknown>;
    const familyName = typeof body.family_name === 'string' ? body.family_name.trim() : '';
    const parentPhone = typeof body.parent_phone === 'string' ? body.parent_phone.trim() : null;
    const parentName = typeof body.parent_name === 'string' ? body.parent_name.trim() : null;

    const { data, error } = await auth.supabaseAdmin
      .from('families')
      .insert({
        center_id: auth.centerId,
        family_name: familyName || null,
        parent_phone: parentPhone,
        parent_name: parentName,
      })
      .select('id, family_name, parent_phone, parent_name')
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ family: data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
