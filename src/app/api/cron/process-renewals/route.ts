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
import { requireCronSecret } from '@/lib/cron/requireCronSecret';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { dateInNDays, todayISO } from '@/lib/parentPack';
import {
  sendRenewalReminder,
  sendRenewalSalesManagerAlert,
  type CenterForRenewal,
  type RenewalStage,
} from '@/lib/whatsapp/flows/renewalReminders';
import { runProcessRenewalWhatsappTemplates } from '@/lib/centerNotify';
import { runSubscriptionBillingCron } from '@/lib/subscriptionBillingCron';
import { tCronBackup } from '@/lib/cronBackupI18n';
import {
  incrementActiveMonthsOnFirstOfMonth,
  runLateFeeAndDormancyScan,
  type LateFeeDormancyRunResult,
} from '@/lib/renewalLateFeeDormancy';
import { parseBodyWithLimit } from '@/lib/validate';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: Request) {
  const cronStart = Date.now();
  const CRON_NAME = 'process-renewals';

  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

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
        body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>;
      } catch {
        throw new Error(tCronBackup('errorInvalidJson'));
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

    const todayStr = todayISO();
    let activeMonthsIncremented = 0;
    try {
      activeMonthsIncremented = await incrementActiveMonthsOnFirstOfMonth(supabase, todayStr);
    } catch (err) {
      console.error('[process-renewals] incrementActiveMonthsOnFirstOfMonth:', err);
    }

    let lateFeeDormancy: LateFeeDormancyRunResult | null = null;
    try {
      lateFeeDormancy = await runLateFeeAndDormancyScan(supabase, todayStr);
    } catch (err) {
      console.error('[process-renewals] runLateFeeAndDormancyScan:', err);
    }

    if (actions.length === 0) {
      await supabase.from('cron_log').insert({
        cron_name: CRON_NAME,
        status: 'success',
        duration_ms: Date.now() - cronStart,
        records_processed: 0,
        metadata: {
          waTemplates: !!waTemplates,
          billingCron: !!billingCron,
          activeMonthsIncremented,
          lateFeeDormancy,
        },
      });
      try {
        if (supabaseAdmin) {
          await supabaseAdmin.from('cron_health_log').upsert(
            {
              cron_name: 'process-renewals',
              last_success_at: new Date().toISOString(),
              failure_count: 0,
            },
            { onConflict: 'cron_name' },
          );
        }
      } catch (healthLogErr) {
        console.error('[process-renewals] cron_health_log:', healthLogErr);
      }
      return NextResponse.json({
        success: true,
        processed: 0,
        waTemplates,
        billingCron,
        activeMonthsIncremented,
        lateFeeDormancy,
      });
    }

    const uniqueIds = [...new Set(actions.map((x) => x.centerId))];

    const { data: centerRows } = await supabase
      .from('centers')
      .select('id, announcement_balance, current_period_start, current_period_end')
      .in('id', uniqueIds);
    const centerMap = new Map(
      (centerRows ?? []).map((r) => [r.id, r] as const),
    );

    const { data: allPendingInvoices } = await supabase
      .from('invoices')
      .select('id, center_id, total_amount, created_at')
      .in('center_id', uniqueIds)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    const latestPendingByCenter = new Map<
      string,
      { id: string; center_id: string; total_amount: number | string | null }
    >();
    for (const inv of allPendingInvoices ?? []) {
      if (!latestPendingByCenter.has(inv.center_id)) {
        latestPendingByCenter.set(inv.center_id, inv);
      }
    }

    const { data: allPackBilling } = await supabase
      .from('parent_pack_billing')
      .select('id, total_amount, center_id')
      .in('center_id', uniqueIds)
      .eq('status', 'pending');

    const packBillingByCenter = new Map<
      string,
      { id: string; total_amount: number | string | null; center_id: string }[]
    >();
    for (const row of allPackBilling ?? []) {
      const list = packBillingByCenter.get(row.center_id) ?? [];
      list.push(row);
      packBillingByCenter.set(row.center_id, list);
    }

    const overdueCenterIds: string[] = [];

    const processAction = async (a: (typeof actions)[number]): Promise<boolean> => {
      try {
        let r: { success: boolean; error?: string };
        try {
          r = await sendRenewalReminder({ center: a.center, stage: a.stage });
        } catch (waErr) {
          console.error('[process-renewals] WA send error:', waErr);
          r = { success: false, error: 'exception' };
        }
        if (!r.success) {
          console.error(`[process-renewals] sendRenewalReminder failed: ${a.centerId} ${a.stage}: ${r.error}`);
          return false;
        }

        await supabase.from('renewal_reminders_sent').insert({
          center_id: a.centerId,
          stage: a.stage,
          sent_at: new Date().toISOString(),
          sent_month: sentMonth,
        });

        if (a.updateStatus) {
          overdueCenterIds.push(a.centerId);
        }

        if (a.alertSales) {
          const renewalDate = a.center.subscription_renewal_date;
          const renewal = renewalDate ? new Date(renewalDate + 'T12:00:00') : null;
          const today = new Date();
          const daysOverdue = renewal
            ? Math.round((today.getTime() - renewal.getTime()) / (24 * 60 * 60 * 1000))
            : 9;
          void sendRenewalSalesManagerAlert({
            centerId: a.centerId,
            centerName: a.center.name,
            renewalDate: a.center.subscription_renewal_date,
            monthlyFee: a.center.subscription_monthly_fee,
            daysOverdue,
          }).catch((waErr) => console.error('[process-renewals] WA sales alert error:', waErr));
        }

        const centerRow = centerMap.get(a.centerId);
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

          const packBilling = packBillingByCenter.get(centerRow.id) ?? [];
          const packTotal = packBilling.reduce((sum, row) => sum + Number(row.total_amount ?? 0), 0);

          if (packTotal > 0) {
            const renewalInvoice = latestPendingByCenter.get(centerRow.id);

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

        return true;
      } catch (err) {
        console.error(`[process-renewals] Error for ${a.centerId}:`, err);
        return false;
      }
    };

    const settled = await Promise.allSettled(actions.map((a) => processAction(a)));
    const processed = settled.filter((s) => s.status === 'fulfilled' && s.value === true).length;

    const uniqueOverdue = [...new Set(overdueCenterIds)];
    if (uniqueOverdue.length > 0) {
      await supabase.from('centers').update({ subscription_status: 'overdue' }).in('id', uniqueOverdue);
    }

    await supabase.from('cron_log').insert({
      cron_name: CRON_NAME,
      status: 'success',
      duration_ms: Date.now() - cronStart,
      records_processed: processed,
      metadata: {
        actionCount: actions.length,
        activeMonthsIncremented,
        lateFeeDormancy,
      },
    });

    try {
      if (supabaseAdmin) {
        await supabaseAdmin.from('cron_health_log').upsert(
          {
            cron_name: 'process-renewals',
            last_success_at: new Date().toISOString(),
            failure_count: 0,
          },
          { onConflict: 'cron_name' },
        );
      }
    } catch (healthLogErr) {
      console.error('[process-renewals] cron_health_log:', healthLogErr);
    }

    return NextResponse.json({
      success: true,
      processed,
      waTemplates,
      billingCron,
      activeMonthsIncremented,
      lateFeeDormancy,
    });
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
