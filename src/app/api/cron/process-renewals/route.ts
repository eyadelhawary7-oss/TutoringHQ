/**
 * Process renewals API — invoked by process-renewals Edge Function
 * Sends WhatsApp reminders, updates status, alerts Sales Manager
 *
 * Note: `upgrade_count_this_period` resets when subscription payment is confirmed (see
 * `handleSubscriptionInvoicePaid` in invoicePaymobPayment.ts), not in this reminder cron.
 * No 8-day grace references here — auto-suspend uses a 6-day grace from `next_payment_due` in DB.
 */

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { dateInNDays, todayISO } from '@/lib/parentPack';
import {
  sendRenewalReminder,
  sendRenewalSalesManagerAlert,
  type CenterForRenewal,
  type RenewalStage,
} from '@/lib/whatsapp/flows/renewalReminders';
import { runProcessRenewalWhatsappTemplates } from '@/lib/centerNotify';
import { runSubscriptionBillingCron } from '@/lib/subscriptionBillingCron';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
  const cronStart = Date.now();
  const CRON_NAME = 'process-renewals';

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
      actions?: Array<{
        centerId: string;
        center: CenterForRenewal;
        stage: RenewalStage;
        updateStatus?: boolean;
        alertSales?: boolean;
      }>;
      sentMonth?: string;
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

    const actions = body.actions ?? [];
    const sentMonth = body.sentMonth ?? new Date().toISOString().slice(0, 7) + '-01';

    let billingCron: Awaited<ReturnType<typeof runSubscriptionBillingCron>> | null = null;
    try {
      billingCron = await runSubscriptionBillingCron(supabase);
    } catch (err) {
      console.error('[process-renewals] runSubscriptionBillingCron:', err);
    }

    let waTemplates: Awaited<ReturnType<typeof runProcessRenewalWhatsappTemplates>> | null = null;
    try {
      waTemplates = await runProcessRenewalWhatsappTemplates(supabase);
    } catch (err) {
      console.error('[process-renewals] runProcessRenewalWhatsappTemplates:', err);
    }

    if (actions.length === 0) {
      await supabase.from('cron_log').insert({
        cron_name: CRON_NAME,
        status: 'success',
        duration_ms: Date.now() - cronStart,
        records_processed: 0,
        metadata: { waTemplates: !!waTemplates, billingCron: !!billingCron },
      });
      return NextResponse.json({ success: true, processed: 0, waTemplates, billingCron });
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
          const daysOverdue = renewal
            ? Math.round((today.getTime() - renewal.getTime()) / (24 * 60 * 60 * 1000))
            : 9;
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

    await supabase.from('cron_log').insert({
      cron_name: CRON_NAME,
      status: 'success',
      duration_ms: Date.now() - cronStart,
      records_processed: processed,
      metadata: { actionCount: actions.length },
    });

    return NextResponse.json({ success: true, processed, waTemplates, billingCron });
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
