/**
 * POST - sync WhatsApp message template names/status from Meta Graph API into wa_meta_templates.
 * super_admin only (Bearer session JWT). Shares its sync logic with the hourly
 * /api/cron/sync-wa-templates cron (src/lib/waTemplateSync.ts).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdminApi } from '@/lib/admin-auth';
import { requireSuperAdmin } from '@/lib/admin-access';
import { syncWaMetaTemplates } from '@/lib/waTemplateSync';

export async function POST(request: NextRequest) {
  const auth = await requireSuperAdminApi(request);
  if (!auth.ok) return auth.response;

  const denied = await requireSuperAdmin(auth.supabaseAdmin, auth.userId);
  if (denied) return denied;

  const result = await syncWaMetaTemplates(auth.supabaseAdmin);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    upserted: result.upserted,
    fetched: result.fetched,
    errors: result.errors,
  });
}
