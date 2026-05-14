import { requireSuperAdminApi } from '@/lib/admin-auth';
import { requireSuperAdminRow } from '@/lib/admin-access';
import { validateCSRFRequest } from '@/lib/csrf';
import { NextRequest, NextResponse } from 'next/server';
import { parseBodyWithLimit } from '@/lib/validate';

const KEY = 'pack_price_per_parent';
const DEFAULT_PACK_PRICE = 12;

/**
 * `platform_config.value` is JSONB NOT NULL. PostgREST batched upserts set `?columns=…`
 * and map JSON `null` to SQL NULL for cells, which violates NOT NULL. Single-row
 * update/insert (or per-object upserts) avoids that path; explicit jsonb `null`
 * uses `serializePlatformConfigJsonbValue` parity with `/api/admin/pricing-config`.
 */
function serializePlatformConfigJsonbValue(v: unknown): unknown {
  if (v === null) {
    return JSON.parse('null') as null;
  }
  return v;
}

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
      value: serializePlatformConfigJsonbValue(DEFAULT_PACK_PRICE),
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
    body = (await parseBodyWithLimit(request, 65536)) as { pack_price_per_parent?: number };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const n = Number(body.pack_price_per_parent);
  if (!Number.isFinite(n) || n <= 0) {
    return NextResponse.json({ error: 'pack_price_per_parent must be a positive number' }, { status: 400 });
  }

  const nowIso = new Date().toISOString();
  const value = serializePlatformConfigJsonbValue(n);
  const rowPatch = {
    value,
    updated_at: nowIso,
    updated_by: auth.userId,
  };

  const { data: updatedKeys, error: updateErr } = await auth.supabaseAdmin
    .from('platform_config')
    .update(rowPatch)
    .eq('key', KEY)
    .select('key');

  if (updateErr) {
    console.error('[PATCH /api/admin/pricing/pack] platform_config update', updateErr);
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  if (!updatedKeys?.length) {
    const { error: insertErr } = await auth.supabaseAdmin.from('platform_config').insert({
      key: KEY,
      ...rowPatch,
    });
    if (insertErr && !String(insertErr.message).toLowerCase().includes('duplicate')) {
      console.error('[PATCH /api/admin/pricing/pack] platform_config insert', insertErr);
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }
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
