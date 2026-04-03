import { requireSuperAdminApi } from '@/lib/admin-auth';
import { requireSuperAdminRow } from '@/lib/admin-access';
import { validateCSRFRequest } from '@/lib/csrf';
import { NextRequest, NextResponse } from 'next/server';

const KEY = 'pack_price_per_parent';
const DEFAULT_PACK_PRICE = 12;

function parsePackPrice(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = parseFloat(value);
    if (Number.isFinite(n)) return n;
  }
  return DEFAULT_PACK_PRICE;
}

/** Ensure default exists; return current pack price per parent (EGP). */
export async function GET(request: Request) {
  const auth = await requireSuperAdminApi(request);
  if (!auth.ok) return auth.response;
  const row403 = await requireSuperAdminRow(auth.supabaseAdmin, auth.userId);
  if (row403) return row403;
  // super_admin only; can_approve_signups does not apply.

  const { data: existingKey } = await auth.supabaseAdmin.from('platform_config').select('key').eq('key', KEY).maybeSingle();

  if (!existingKey) {
    const { error: seedErr } = await auth.supabaseAdmin.from('platform_config').insert({
      key: KEY,
      value: DEFAULT_PACK_PRICE,
      updated_at: new Date().toISOString(),
    });
    if (seedErr && !String(seedErr.message).toLowerCase().includes('duplicate')) {
      console.error('[GET /api/admin/pricing/pack] seed', seedErr);
      return NextResponse.json({ error: seedErr.message }, { status: 500 });
    }
  }

  const { data, error } = await auth.supabaseAdmin.from('platform_config').select('value').eq('key', KEY).maybeSingle();

  if (error) {
    console.error('[GET /api/admin/pricing/pack]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const pack_price_per_parent = parsePackPrice(data?.value);

  return NextResponse.json({ pack_price_per_parent });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireSuperAdminApi(request);
  if (!auth.ok) return auth.response;
  const row403 = await requireSuperAdminRow(auth.supabaseAdmin, auth.userId);
  if (row403) return row403;
  // super_admin only; can_approve_signups does not apply.

  if (!validateCSRFRequest(request, auth.userId)) {
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
  }

  let body: { pack_price_per_parent?: number };
  try {
    body = (await request.json()) as { pack_price_per_parent?: number };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const n = Number(body.pack_price_per_parent);
  if (!Number.isFinite(n) || n <= 0) {
    return NextResponse.json({ error: 'pack_price_per_parent must be a positive number' }, { status: 400 });
  }

  const { error: upCfgErr } = await auth.supabaseAdmin
    .from('platform_config')
    .upsert(
      {
        key: KEY,
        value: n,
        updated_at: new Date().toISOString(),
        updated_by: auth.userId,
      },
      { onConflict: 'key' },
    );

  if (upCfgErr) {
    console.error('[PATCH /api/admin/pricing/pack] platform_config', upCfgErr);
    return NextResponse.json({ error: upCfgErr.message }, { status: 500 });
  }

  const { data: updatedRows, error: centersErr } = await auth.supabaseAdmin
    .from('centers')
    .update({ pack_price_per_parent: n })
    .neq('id', '00000000-0000-0000-0000-000000000000')
    .select('id');

  if (centersErr) {
    console.error('[PATCH /api/admin/pricing/pack] centers', centersErr);
    return NextResponse.json({ error: centersErr.message }, { status: 500 });
  }

  const updated_centers = updatedRows?.length ?? 0;

  return NextResponse.json({ success: true, updated_centers });
}
