import { requireInternalAdminApi } from '@/lib/admin-auth';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const auth = await requireInternalAdminApi(request);
  if (!auth.ok) {
    return auth.response;
  }

  const { data: vendor, error } = await auth.supabaseAdmin
    .from('vendors')
    .select('id, name, whatsapp_number, pickup_address, city, is_active, created_at')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[GET /api/admin/vendors]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ vendor: vendor ?? null });
}

export async function POST(request: Request) {
  const auth = await requireInternalAdminApi(request);
  if (!auth.ok) {
    return auth.response;
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const whatsapp_number = typeof body.whatsapp_number === 'string' ? body.whatsapp_number.trim() : '';
  const pickup_address = typeof body.pickup_address === 'string' ? body.pickup_address.trim() : '';
  const city = typeof body.city === 'string' ? body.city.trim() : 'Cairo';
  const is_active = typeof body.is_active === 'boolean' ? body.is_active : true;

  if (!name || !whatsapp_number || !pickup_address) {
    return NextResponse.json({ error: 'name, whatsapp_number, pickup_address required' }, { status: 400 });
  }

  const { data: row, error } = await auth.supabaseAdmin
    .from('vendors')
    .insert({
      name,
      whatsapp_number,
      pickup_address,
      city: city || 'Cairo',
      is_active,
    })
    .select('id, name, whatsapp_number, pickup_address, city, is_active, created_at')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ vendor: row });
}

export async function PATCH(request: Request) {
  const auth = await requireInternalAdminApi(request);
  if (!auth.ok) {
    return auth.response;
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.name === 'string') patch.name = body.name.trim();
  if (typeof body.whatsapp_number === 'string') patch.whatsapp_number = body.whatsapp_number.trim();
  if (typeof body.pickup_address === 'string') patch.pickup_address = body.pickup_address.trim();
  if (typeof body.city === 'string') patch.city = body.city.trim();
  if (typeof body.is_active === 'boolean') patch.is_active = body.is_active;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  const { data: row, error } = await auth.supabaseAdmin
    .from('vendors')
    .update(patch)
    .eq('id', id)
    .select('id, name, whatsapp_number, pickup_address, city, is_active, created_at')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ vendor: row });
}
