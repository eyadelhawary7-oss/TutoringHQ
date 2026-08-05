/**
 * `Merged-Admin-Platform` §03, vendors frame — read-only integration health.
 *
 * Reads `status_checks` (written by `/api/cron/status-ping`) and folds it into
 * one row per pinged service. Read-only: no PATCH, no POST, nothing to toggle.
 * See `src/lib/adminIntegrationHealth.ts` for what the design draws that this
 * deliberately does not.
 *
 * Gated the same way `/api/admin/platform-config` GET is — this sits on the
 * same screen and exposes operational internals.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdminApi } from '@/lib/admin-auth';
import { requireSuperAdminRow } from '@/lib/admin-access';
import {
  buildIntegrationHealth,
  type StatusCheckRow,
} from '@/lib/adminIntegrationHealth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireSuperAdminApi(request);
  if (!auth.ok) return auth.response;

  const row403 = await requireSuperAdminRow(auth.supabaseAdmin, auth.userId);
  if (row403) return row403;

  // 24h at one ping per service every 5 minutes is 288 rows per service, 864
  // in total. The cap is generous enough to absorb a faster schedule without
  // silently truncating the window the success rate is computed over.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await auth.supabaseAdmin
    .from('status_checks')
    .select('service, status, response_time_ms, checked_at')
    .gte('checked_at', since)
    .order('checked_at', { ascending: false })
    .limit(2000);

  if (error) {
    console.error('[GET /api/admin/integration-health]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    integrations: buildIntegrationHealth((data ?? []) as StatusCheckRow[]),
  });
}
