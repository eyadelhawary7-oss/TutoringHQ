/**
 * Hourly mirror of Meta's template approval state into wa_meta_templates.
 *
 * Every template-gated WhatsApp send checks this table via isTemplateApproved
 * and silently skips when the row is missing or not APPROVED. Before this cron
 * the only mirror was the manual super-admin sync button, so a template
 * approved in Meta kept skipping until someone remembered to click it. This
 * keeps the mirror fresh automatically.
 */

import { NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/cron/requireCronSecret';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { syncWaMetaTemplates, waBusinessAccountId, waToken } from '@/lib/waTemplateSync';
import { insertCronLogFailure, insertCronLogSuccess } from '@/lib/cron/cronLog';

const CRON_NAME = 'sync-wa-templates';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const admin = supabaseAdmin;
  const cronStart = Date.now();

  // Not configured yet (WABA id / token unset): succeed as a documented no-op
  // instead of paging failure alerts every hour until WhatsApp goes live.
  if (!waBusinessAccountId() || !waToken()) {
    await insertCronLogSuccess(admin, CRON_NAME, {
      duration_ms: Date.now() - cronStart,
      metadata: { skipped: 'whatsapp_not_configured' },
    });
    return NextResponse.json({ skipped: 'whatsapp_not_configured' });
  }

  const result = await syncWaMetaTemplates(admin);

  if (!result.ok) {
    await insertCronLogFailure(admin, CRON_NAME, new Error(result.error), {
      duration_ms: Date.now() - cronStart,
    });
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  try {
    await admin.from('cron_health_log').upsert(
      {
        cron_name: CRON_NAME,
        last_success_at: new Date().toISOString(),
        failure_count: 0,
      },
      { onConflict: 'cron_name' },
    );
  } catch (e) {
    console.error(`[${CRON_NAME}] cron_health_log:`, e);
  }

  await insertCronLogSuccess(admin, CRON_NAME, {
    duration_ms: Date.now() - cronStart,
    records_processed: result.upserted,
    metadata: {
      fetched: result.fetched,
      upserted: result.upserted,
      errors: result.errors ?? null,
    },
  });

  return NextResponse.json({
    ok: true,
    fetched: result.fetched,
    upserted: result.upserted,
    errors: result.errors,
  });
}
