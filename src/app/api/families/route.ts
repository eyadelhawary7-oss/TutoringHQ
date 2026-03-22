import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

async function getContext(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) return null;

  const authHeader = request.headers.get('Authorization');
  const accessToken = authHeader?.replace('Bearer ', '');
  if (!accessToken) return null;

  const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  const { data: { user }, error } = await supabaseAuth.auth.getUser();
  if (error || !user) return null;

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  const { data: userRecord } = await supabaseAdmin
    .from('users')
    .select('id, center_id')
    .eq('id', user.id)
    .single();

  const centerId = (userRecord as { center_id?: string } | null)?.center_id;
  if (!centerId) return null;

  return { centerId, supabaseAdmin };
}

/** GET: List families for center */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getContext(request);
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data, error } = await ctx.supabaseAdmin
      .from('families')
      .select('id, family_name, parent_phone, parent_name')
      .eq('center_id', ctx.centerId)
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
    const ctx = await getContext(request);
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const familyName = typeof body.family_name === 'string' ? body.family_name.trim() : '';
    const parentPhone = typeof body.parent_phone === 'string' ? body.parent_phone.trim() : null;
    const parentName = typeof body.parent_name === 'string' ? body.parent_name.trim() : null;

    const { data, error } = await ctx.supabaseAdmin
      .from('families')
      .insert({
        center_id: ctx.centerId,
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
