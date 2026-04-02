/**
 * Churn detection API — invoked by detect-churn Edge Function
 * Executes WhatsApp sends and admin_alerts inserts via churnDetection flows
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  sendDay3InactivityAlert,
  sendDay7SalesManagerAlert,
  flagDay14InAdminPanel,
} from '@/lib/whatsapp/flows/churnDetection';
import { createClient } from '@supabase/supabase-js';
import { runChqInactivityAlertTemplates } from '@/lib/centerNotify';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

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

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const actions = body.actions ?? (body.action ? [body] : []);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let inactivityTemplateSent = 0;
  if (supabaseUrl && supabaseServiceKey) {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    try {
      inactivityTemplateSent = await runChqInactivityAlertTemplates(supabase);
    } catch (err) {
      console.error('[detect-churn] runChqInactivityAlertTemplates:', err);
    }
  }

  if (actions.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, inactivityTemplateSent });
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
  return NextResponse.json({ ok: true, processed, results, inactivityTemplateSent });
}
