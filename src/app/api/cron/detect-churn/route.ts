/**
 * Churn detection API — invoked by detect-churn Edge Function
 * Executes WhatsApp sends and admin_alerts inserts via churnDetection flows
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/cron/requireCronSecret';
import {
  sendDay3InactivityAlert,
  sendDay7SalesManagerAlert,
  flagDay14InAdminPanel,
} from '@/lib/whatsapp/flows/churnDetection';
import { runChqInactivityAlertTemplates, sendInactivityAlert } from '@/lib/centerNotify';
import { tCronBackup } from '@/lib/cronBackupI18n';
import { phoneFromCenterhqAuthEmail } from '@/lib/ownerPhone';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { parseBodyWithLimit } from '@/lib/validate';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MS_PER_DAY = 86_400_000;

/**
 * Owner has not logged in for 14+ days: chq_inactivity_alert, log, optional health_status red.
 */
async function runNoLoginReengagement14d(admin: SupabaseClient): Promise<number> {
  const cutoff = Date.now() - 14 * MS_PER_DAY;
  const fourteenDaysAgoIso = new Date(cutoff).toISOString();
  let sent = 0;

  const { data: centers, error: cErr } = await admin
    .from('centers')
    .select('id, name, owner_name, phone')
    .eq('status', 'active');

  if (cErr) {
    console.error('[detect-churn] reengage centers:', cErr.message);
    return 0;
  }

  const { data: owners, error: oErr } = await admin
    .from('users')
    .select('id, center_id, phone')
    .eq('role', 'owner')
    .not('center_id', 'is', null);

  if (oErr) {
    console.error('[detect-churn] reengage owners:', oErr.message);
    return 0;
  }

  const ownerByCenter = new Map<string, { id: string; phone: string | null }>();
  for (const r of owners ?? []) {
    const row = r as { id: string; center_id: string; phone: string | null };
    if (!ownerByCenter.has(row.center_id)) {
      ownerByCenter.set(row.center_id, { id: row.id, phone: row.phone ?? null });
    }
  }

  for (const raw of centers ?? []) {
    const c = raw as {
      id: string;
      name: string | null;
      owner_name: string | null;
      phone: string | null;
    };

    const ow = ownerByCenter.get(c.id);
    if (!ow) continue;

    const { data: authData, error: authErr } = await admin.auth.admin.getUserById(ow.id);
    if (authErr || !authData?.user) continue;

    const lastSignIn = authData.user.last_sign_in_at;
    if (lastSignIn) {
      const t = new Date(lastSignIn).getTime();
      if (t >= cutoff) continue;
    }

    const { data: recentLog, error: logQErr } = await admin
      .from('center_reengagement_log')
      .select('sent_at')
      .eq('center_id', c.id)
      .gte('sent_at', fourteenDaysAgoIso)
      .limit(1)
      .maybeSingle();

    if (logQErr) {
      console.error('[detect-churn] center_reengagement_log read:', c.id, logQErr.message);
      continue;
    }
    if (recentLog) continue;

    const daysInactive = lastSignIn
      ? Math.floor((Date.now() - new Date(lastSignIn).getTime()) / MS_PER_DAY)
      : 999;

    const ownerPhone =
      phoneFromCenterhqAuthEmail(authData.user.email) ?? ow.phone ?? c.phone;

    const sendRes = await sendInactivityAlert(
      admin,
      c.id,
      ownerPhone,
      c.owner_name ?? '',
      c.name ?? '',
      daysInactive,
    );
    if (!sendRes.success) continue;

    const { error: insErr } = await admin.from('center_reengagement_log').insert({
      center_id: c.id,
      trigger_type: 'no_login_14d',
    });
    if (insErr) {
      console.error('[detect-churn] center_reengagement_log:', c.id, insErr.message);
      continue;
    }

    const { data: cur } = await admin.from('centers').select('health_status').eq('id', c.id).maybeSingle();
    const hs = (cur as { health_status?: string | null } | null)?.health_status;
    if (hs !== 'red') {
      const { error: upErr } = await admin.from('centers').update({ health_status: 'red' }).eq('id', c.id);
      if (upErr) {
        console.error('[detect-churn] health_status update:', c.id, upErr.message);
      }
    }

    sent += 1;
  }

  return sent;
}

export async function POST(request: Request) {
  const cronStart = Date.now();
  const CRON_NAME = 'detect-churn';

  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const admin = supabaseAdmin;

  const { data: pausedRow } = await admin
    .from('platform_config')
    .select('value')
    .eq('key', 'cron_paused')
    .maybeSingle();
  if (pausedRow?.value === true) {
    return NextResponse.json({ skipped: 'cron_paused' }, { status: 200 });
  }

  try {
    let body: {
      action?: 'day3' | 'day7' | 'day14';
      centerId?: string;
      centerName?: string;
      phone?: string;
      lastScanAt?: string | null;
      monthlyFee?: number;
      daysInactive?: number;
      actions?: Array<{
        action: 'day3' | 'day7' | 'day14';
        centerId: string;
        centerName: string;
        phone: string;
        lastScanAt: string | null;
        monthlyFee: number;
        daysInactive: number;
      }>;
    };

    if (request.method === 'GET') {
      body = {};
    } else {
      try {
        body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>;
      } catch {
        throw new Error(tCronBackup('errorInvalidJson'));
      }
    }

    const actions = body.actions ?? (body.action ? [body] : []);

    let inactivityTemplateSent = 0;
    try {
      inactivityTemplateSent = await runChqInactivityAlertTemplates(admin);
    } catch (err) {
      console.error('[detect-churn] runChqInactivityAlertTemplates:', err);
    }

    let reengagementSent = 0;
    try {
      reengagementSent = await runNoLoginReengagement14d(admin);
    } catch (err) {
      console.error('[detect-churn] runNoLoginReengagement14d:', err);
    }

    if (actions.length === 0) {
      await admin.from('cron_log').insert({
        cron_name: CRON_NAME,
        status: 'success',
        duration_ms: Date.now() - cronStart,
        records_processed: 0,
        metadata: { inactivityTemplateSent, reengagementSent },
      });
      try {
        await admin.from('cron_health_log').upsert(
          {
            cron_name: 'detect-churn',
            last_success_at: new Date().toISOString(),
            failure_count: 0,
          },
          { onConflict: 'cron_name' },
        );
      } catch (healthLogErr) {
        console.error('[detect-churn] cron_health_log:', healthLogErr);
      }
      return NextResponse.json({
        success: true,
        processed: 0,
        inactivityTemplateSent,
        reengagementSent,
      });
    }

    const results: { centerId: string; action: string; success: boolean; error?: string }[] = [];

    const waPromises: Promise<void>[] = [];

    for (const a of actions) {
      const centerId = a.centerId ?? '';
      const centerName = a.centerName ?? '';
      const phone = a.phone ?? '';
      const lastScanAt = a.lastScanAt ?? null;
      const monthlyFee = Number(a.monthlyFee) ?? 0;
      const daysInactive = Number(a.daysInactive) ?? 0;
      const action = (a.action ?? 'day3') as 'day3' | 'day7' | 'day14';

      try {
        if (action === 'day3') {
          waPromises.push(
            sendDay3InactivityAlert({
              centerId,
              centerName,
              toPhone: phone,
              daysInactive,
            })
              .then((r) => {
                results.push({ centerId, action: 'day3', success: r.success, error: r.error });
              })
              .catch((waErr) => {
                console.error('[detect-churn] WA send error:', waErr);
                results.push({ centerId, action: 'day3', success: false, error: 'exception' });
              }),
          );
        } else if (action === 'day7') {
          waPromises.push(
            sendDay7SalesManagerAlert({
              centerId,
              centerName,
              lastScanAt,
              monthlyFee,
              daysInactive,
              alertType: 'day7',
            })
              .then((r) => {
                results.push({ centerId, action: 'day7', success: r.success, error: r.error });
              })
              .catch((waErr) => {
                console.error('[detect-churn] WA send error:', waErr);
                results.push({ centerId, action: 'day7', success: false, error: 'exception' });
              }),
          );
        } else if (action === 'day14') {
          const r = await flagDay14InAdminPanel({
            centerId,
            centerName,
            lastScanAt,
            daysInactive,
          });
          results.push({ centerId, action: 'flag14', success: r.success, error: r.error });

          waPromises.push(
            sendDay7SalesManagerAlert({
              centerId,
              centerName,
              lastScanAt,
              monthlyFee,
              daysInactive,
              alertType: 'day14',
            })
              .then((r2) => {
                results.push({ centerId, action: 'day14', success: r2.success, error: r2.error });
              })
              .catch((waErr) => {
                console.error('[detect-churn] WA send error:', waErr);
                results.push({ centerId, action: 'day14', success: false, error: 'exception' });
              }),
          );
        }
      } catch (err) {
        results.push({
          centerId,
          action,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (waPromises.length > 0) {
      await Promise.allSettled(waPromises);
    }

    const processed = results.filter((r) => r.success).length;

    await admin.from('cron_log').insert({
      cron_name: CRON_NAME,
      status: 'success',
      duration_ms: Date.now() - cronStart,
      records_processed: processed,
      metadata: { actionCount: actions.length, inactivityTemplateSent, reengagementSent },
    });

    try {
      await admin.from('cron_health_log').upsert(
        {
          cron_name: 'detect-churn',
          last_success_at: new Date().toISOString(),
          failure_count: 0,
        },
        { onConflict: 'cron_name' },
      );
    } catch (healthLogErr) {
      console.error('[detect-churn] cron_health_log:', healthLogErr);
    }

    return NextResponse.json({
      success: true,
      processed,
      results,
      inactivityTemplateSent,
      reengagementSent,
    });
  } catch (error) {
    console.error(`[${CRON_NAME}] Error:`, error);
    try {
      await admin.from('cron_log').insert({
        cron_name: CRON_NAME,
        status: 'failure',
        duration_ms: Date.now() - cronStart,
        error_message: error instanceof Error ? error.message.slice(0, 2000) : 'Unknown',
      });
    } catch (logErr) {
      console.error(`[${CRON_NAME}] cron_log:`, logErr);
    }
    return NextResponse.json({ success: false }, { status: 200 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
