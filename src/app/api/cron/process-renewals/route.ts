/**
 * Process renewals API — invoked by process-renewals Edge Function
 * Sends WhatsApp reminders, updates status, alerts Sales Manager
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  sendRenewalReminder,
  sendRenewalSalesManagerAlert,
  type CenterForRenewal,
  type RenewalStage,
} from '@/lib/whatsapp/flows/renewalReminders';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: {
    actions?: Array<{
      centerId: string;
      center: CenterForRenewal;
      stage: RenewalStage;
      updateStatus?: boolean;
      alertSales?: boolean;
    }>;
    sentMonth?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const actions = body.actions ?? [];
  const sentMonth = body.sentMonth ?? new Date().toISOString().slice(0, 7) + '-01';

  if (actions.length === 0) {
    return NextResponse.json({ ok: true, processed: 0 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: 'Missing Supabase config' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  let processed = 0;

  for (const a of actions) {
    try {
      const r = await sendRenewalReminder({ center: a.center, stage: a.stage });
      if (!r.success) {
        console.error(`[process-renewals] sendRenewalReminder failed: ${a.centerId} ${a.stage}: ${r.error}`);
        continue;
      }

      await supabase.from('renewal_reminders_sent').insert({
        center_id: a.centerId,
        stage: a.stage,
        sent_at: new Date().toISOString(),
        sent_month: sentMonth,
      });

      if (a.updateStatus) {
        await supabase
          .from('centers')
          .update({ subscription_status: 'overdue' })
          .eq('id', a.centerId);
      }

      if (a.alertSales) {
        const renewalDate = a.center.subscription_renewal_date;
        const renewal = renewalDate ? new Date(renewalDate + 'T12:00:00') : null;
        const today = new Date();
        const daysOverdue = renewal ? Math.round((today.getTime() - renewal.getTime()) / (24 * 60 * 60 * 1000)) : 9;
        await sendRenewalSalesManagerAlert({
          centerId: a.centerId,
          centerName: a.center.name,
          renewalDate: a.center.subscription_renewal_date,
          monthlyFee: a.center.subscription_monthly_fee,
          daysOverdue,
        });
      }

      processed++;
    } catch (err) {
      console.error(`[process-renewals] Error for ${a.centerId}:`, err);
    }
  }

  return NextResponse.json({ ok: true, processed });
}
