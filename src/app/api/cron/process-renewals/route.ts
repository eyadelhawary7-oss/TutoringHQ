/**
 * Process renewals API — invoked by process-renewals Edge Function
 * Sends WhatsApp reminders, updates status, alerts Sales Manager
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { dateInNDays, todayISO } from '@/lib/parentPack';
import {
  sendRenewalReminder,
  sendRenewalSalesManagerAlert,
  type CenterForRenewal,
  type RenewalStage,
} from '@/lib/whatsapp/flows/renewalReminders';
import { runProcessRenewalWhatsappTemplates } from '@/lib/centerNotify';

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

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: 'Missing Supabase config' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  let waTemplates: Awaited<ReturnType<typeof runProcessRenewalWhatsappTemplates>> | null = null;
  try {
    waTemplates = await runProcessRenewalWhatsappTemplates(supabase);
  } catch (err) {
    console.error('[process-renewals] runProcessRenewalWhatsappTemplates:', err);
  }

  if (actions.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, waTemplates });
  }

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

      const { data: centerRow } = await supabase
        .from('centers')
        .select('id, announcement_balance, current_period_start, current_period_end')
        .eq('id', a.centerId)
        .maybeSingle();

      if (centerRow) {
        const announcementBalance = Number(centerRow.announcement_balance ?? 0);
        if (announcementBalance > 0) {
          const todayStr = todayISO();
          await supabase.from('invoices').insert({
            center_id: centerRow.id,
            invoice_number: `ANNC-${Date.now()}`,
            invoice_type: 'announcement_settlement',
            base_amount: announcementBalance,
            total_amount: announcementBalance,
            billing_period_start: centerRow.current_period_start ?? todayStr,
            billing_period_end: centerRow.current_period_end ?? todayStr,
            due_date: dateInNDays(7),
            status: 'pending',
          });
          await supabase
            .from('announcement_blasts')
            .update({ billing_status: 'included_in_renewal', charged_at: new Date().toISOString() })
            .eq('center_id', centerRow.id)
            .eq('billing_status', 'pending');
          await supabase
            .from('centers')
            .update({
              announcement_balance: 0,
              announcement_balance_updated_at: new Date().toISOString(),
            })
            .eq('id', centerRow.id);
        }

        const { data: packBilling } = await supabase
          .from('parent_pack_billing')
          .select('id, total_amount')
          .eq('center_id', centerRow.id)
          .eq('status', 'pending');

        const packTotal =
          packBilling?.reduce((sum, r) => sum + Number(r.total_amount ?? 0), 0) ?? 0;

        if (packTotal > 0) {
          const { data: renewalInvoice } = await supabase
            .from('invoices')
            .select('id, total_amount')
            .eq('center_id', centerRow.id)
            .eq('status', 'pending')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (renewalInvoice) {
            await supabase
              .from('invoices')
              .update({
                whatsapp_parent_checkup: packTotal,
                total_amount: Number(renewalInvoice.total_amount) + packTotal,
                updated_at: new Date().toISOString(),
              })
              .eq('id', renewalInvoice.id);
          }

          await supabase
            .from('parent_pack_billing')
            .update({ status: 'charged', charged_at: new Date().toISOString() })
            .eq('center_id', centerRow.id)
            .eq('status', 'pending');
        }
      }

      processed++;
    } catch (err) {
      console.error(`[process-renewals] Error for ${a.centerId}:`, err);
    }
  }

  return NextResponse.json({ ok: true, processed, waTemplates });
}
