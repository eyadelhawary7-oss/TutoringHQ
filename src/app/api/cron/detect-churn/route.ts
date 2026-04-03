/**
 * Churn detection API — invoked by detect-churn Edge Function
 * Executes WhatsApp sends and admin_alerts inserts via churnDetection flows
 */

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import {
  sendDay3InactivityAlert,
  sendDay7SalesManagerAlert,
  flagDay14InAdminPanel,
} from '@/lib/whatsapp/flows/churnDetection';
import { runChqInactivityAlertTemplates } from '@/lib/centerNotify';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
  const cronStart = Date.now();
  const CRON_NAME = 'detect-churn';

  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ success: false }, { status: 200 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: pausedRow } = await supabase
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
        body = await request.json();
      } catch {
        throw new Error('Invalid JSON');
      }
    }

    const actions = body.actions ?? (body.action ? [body] : []);

    let inactivityTemplateSent = 0;
    try {
      inactivityTemplateSent = await runChqInactivityAlertTemplates(supabase);
    } catch (err) {
      console.error('[detect-churn] runChqInactivityAlertTemplates:', err);
    }

    if (actions.length === 0) {
      await supabase.from('cron_log').insert({
        cron_name: CRON_NAME,
        status: 'success',
        duration_ms: Date.now() - cronStart,
        records_processed: 0,
        metadata: { inactivityTemplateSent },
      });
      return NextResponse.json({ success: true, processed: 0, inactivityTemplateSent });
    }

    const results: { centerId: string; action: string; success: boolean; error?: string }[] = [];

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
          const r = await sendDay3InactivityAlert({
            centerId,
            centerName,
            toPhone: phone,
            daysInactive,
          });
          results.push({ centerId, action: 'day3', success: r.success, error: r.error });
        } else if (action === 'day7') {
          const r = await sendDay7SalesManagerAlert({
            centerId,
            centerName,
            lastScanAt,
            monthlyFee,
            daysInactive,
            alertType: 'day7',
          });
          results.push({ centerId, action: 'day7', success: r.success, error: r.error });
        } else if (action === 'day14') {
          const r = await flagDay14InAdminPanel({
            centerId,
            centerName,
            lastScanAt,
            daysInactive,
          });
          results.push({ centerId, action: 'flag14', success: r.success, error: r.error });

          const r2 = await sendDay7SalesManagerAlert({
            centerId,
            centerName,
            lastScanAt,
            monthlyFee,
            daysInactive,
            alertType: 'day14',
          });
          results.push({ centerId, action: 'day14', success: r2.success, error: r2.error });
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

    const processed = results.filter((r) => r.success).length;

    await supabase.from('cron_log').insert({
      cron_name: CRON_NAME,
      status: 'success',
      duration_ms: Date.now() - cronStart,
      records_processed: processed,
      metadata: { actionCount: actions.length, inactivityTemplateSent },
    });

    return NextResponse.json({ success: true, processed, results, inactivityTemplateSent });
  } catch (error) {
    console.error(`[${CRON_NAME}] Error:`, error);
    try {
      await supabase.from('cron_log').insert({
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
