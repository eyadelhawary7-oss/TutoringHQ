import { requireSuperAdminApi } from '@/lib/admin-auth';
import { NextRequest, NextResponse } from 'next/server';
import { parseBodyWithLimit } from '@/lib/validate';
import { validateCSRFRequest } from '@/lib/csrf';

const ALLOWED_CONFIG_KEYS = [
  'maintenance_mode',
  'wa_sending_enabled',
  'read_only_mode',
  'announcement_banner',
  'cron_paused',
] as const;

export async function PATCH(request: NextRequest) {
  const auth = await requireSuperAdminApi(request);
  if (!auth.ok) return auth.response;
  if (!validateCSRFRequest(request, auth.userId)) {
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
  }

  const supabaseAdmin = auth.supabaseAdmin;

  try {
    const body = (await parseBodyWithLimit(request, 65536)) as { key: string; value: unknown };
    if (!(ALLOWED_CONFIG_KEYS as readonly string[]).includes(body.key)) {
      return NextResponse.json({ error: 'Invalid config key' }, { status: 400 });
    }
    const { data, error } = await supabaseAdmin
      .from('platform_config')
      .update({ value: body.value, updated_at: new Date().toISOString() })
      .eq('key', body.key)
      .select('key, value, updated_at')
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch (e) {
    console.error('[PATCH /api/ceo/platform-config]', e);
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
