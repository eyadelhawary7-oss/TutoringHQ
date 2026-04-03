import { requireSuperAdminApi } from '@/lib/admin-auth';
import { NextRequest, NextResponse } from 'next/server';

const MANAGED_KEYS = new Set([
  'auto_approve_signups',
  'pause_new_signups',
  'auto_approve_pack',
  'wa_sending_enabled',
  'payment_failed_enabled',
  'pack_invoice_enabled',
  'cron_paused',
  'maintenance_mode',
  'read_only_mode',
  'bosta_auto_reship_on_lost',
  'breakeven_target',
]);

function toJsonbValue(v: unknown): boolean | number | string | null {
  if (typeof v === 'boolean' || typeof v === 'number' || typeof v === 'string') return v;
  return null;
}

/** GET — all platform_config rows (super_admin). */
export async function GET(request: NextRequest) {
  const auth = await requireSuperAdminApi(request);
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.supabaseAdmin
    .from('platform_config')
    .select('key, value, updated_at')
    .order('key', { ascending: true });

  if (error) {
    console.error('[GET /api/admin/platform-config]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ config: data ?? [] });
}

/** PATCH — { key, value } where value is boolean | number | string (super_admin). */
export async function PATCH(request: NextRequest) {
  const auth = await requireSuperAdminApi(request);
  if (!auth.ok) return auth.response;

  try {
    const body = (await request.json()) as { key?: string; value?: unknown };
    const key = typeof body.key === 'string' ? body.key : '';
    if (!key || !MANAGED_KEYS.has(key)) {
      return NextResponse.json({ error: 'Invalid or unsupported config key' }, { status: 400 });
    }

    const jsonVal = toJsonbValue(body.value);
    if (jsonVal === null) {
      return NextResponse.json({ error: 'value must be boolean, number, or string' }, { status: 400 });
    }

    if (key === 'breakeven_target') {
      const n = typeof jsonVal === 'number' ? jsonVal : Number(jsonVal);
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json({ error: 'breakeven_target must be a non-negative number' }, { status: 400 });
      }
    }

    const { data, error } = await auth.supabaseAdmin
      .from('platform_config')
      .update({ value: jsonVal, updated_at: new Date().toISOString() })
      .eq('key', key)
      .select('key, value, updated_at')
      .single();

    if (error) {
      console.error('[PATCH /api/admin/platform-config]', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (e) {
    console.error('[PATCH /api/admin/platform-config]', e);
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
