import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/cron/requireCronSecret';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { tryFinalizeCombinedPaymentSession } from '@/lib/combinedPaymentFinalize';
import { inquirePaymobCardOrder } from '@/lib/paymobOrderInquiry';
import { createAction } from '@/lib/ceo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const HANDLED_COMBINED_TYPES = new Set(['upgrade', 'reactivation_tier1', 'reactivation_tier2']);

export async function POST(request: Request) {
  const cronStart = Date.now();
  const CRON_NAME = 'check-stuck-payments';

  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ success: false }, { status: 200 });
  }

  const supabase = createClient(url, key, {
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
    const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    const { data: stuckSessions, error: fetchErr } = await supabase
      .from('combined_payment_sessions')
      .select(
        'id, paymob_order_id, center_id, total_amount, session_type, created_at, credit_amount',
      )
      .eq('status', 'pending')
      .lt('created_at', cutoff)
      .gt('expires_at', now)
      .is('finalized_at', null);

    if (fetchErr) {
      throw new Error(fetchErr.message);
    }

    let resolved = 0;
    let flagged = 0;
    const sessions = stuckSessions ?? [];

    for (const session of sessions) {
      try {
        const orderId = String((session as { paymob_order_id?: string | null }).paymob_order_id ?? '').trim();
        if (!orderId) continue;

        const inquiry = await inquirePaymobCardOrder(orderId);

        if (inquiry.state === 'paid') {
          const txId = inquiry.transactionId ?? '';
          const primaryOk = await tryFinalizeCombinedPaymentSession(
            (session as { id: string }).id,
            supabase,
            'cron',
            txId,
          );
          if (primaryOk) {
            resolved++;
          } else if (
            !HANDLED_COMBINED_TYPES.has(String((session as { session_type?: string }).session_type ?? ''))
          ) {
            const { finalizeCardOrderPaymentSuccess } = await import('@/lib/cardOrderPayment');
            const card = await finalizeCardOrderPaymentSuccess(supabase, orderId, txId);
            if (!card) {
              const { finalizeInvoicePaymentSuccess } = await import('@/lib/invoicePaymobPayment');
              await finalizeInvoicePaymentSuccess(supabase, orderId, txId);
            }
            const { processSignupAutoApprovalAfterPaymobSuccess } = await import('@/lib/signupPaymobAutoApprove');
            await processSignupAutoApprovalAfterPaymobSuccess(supabase, orderId, txId);
            resolved++;
          }
        } else if (inquiry.state === 'failed') {
          await supabase
            .from('combined_payment_sessions')
            .update({ status: 'failed' })
            .eq('id', (session as { id: string }).id);

          const st = String((session as { session_type?: string }).session_type ?? '');
          const creditAmt = Number((session as { credit_amount?: number | string | null }).credit_amount ?? 0);
          if (st !== 'signup' && creditAmt > 0) {
            await supabase.rpc('cancel_reservation_atomic', {
              p_center_id: (session as { center_id: string }).center_id,
              p_amount: creditAmt,
            });
          }
        } else {
          const createdRaw = (session as { created_at?: string }).created_at;
          const createdAt = createdRaw ? new Date(createdRaw) : new Date();
          const ageHours = (Date.now() - createdAt.getTime()) / 3600000;
          if (ageHours > 2) {
            try {
              await createAction(supabase, {
                type: 'ops',
                priority: 'red',
                center_id: (session as { center_id: string }).center_id,
                title: `Stuck payment session — ${(session as { center_id: string }).center_id}`,
                subtitle: `Order ${orderId} · ${ageHours.toFixed(1)}h · ${String((session as { session_type?: string }).session_type ?? '')}`,
                revenue_at_risk: Number((session as { total_amount?: number | string }).total_amount) || 0,
                auto_generated: true,
              });
            } catch (ceoErr) {
              console.error('[check-stuck-payments] ceo_action_queue', ceoErr);
            }
            flagged++;
          }
        }
      } catch (sessionError) {
        console.error(`[check-stuck-payments] session ${(session as { id?: string }).id}:`, sessionError);
      }
    }

    const recordsProcessed = sessions.length;
    await supabase.from('cron_log').insert({
      cron_name: CRON_NAME,
      status: 'success',
      duration_ms: Date.now() - cronStart,
      records_processed: recordsProcessed,
      metadata: { resolved, flagged },
    });

    try {
      if (supabaseAdmin) {
        await supabaseAdmin.from('cron_health_log').upsert(
          {
            cron_name: 'check-stuck-payments',
            last_success_at: new Date().toISOString(),
            failure_count: 0,
          },
          { onConflict: 'cron_name' },
        );
      }
    } catch (healthLogErr) {
      console.error('[check-stuck-payments] cron_health_log:', healthLogErr);
    }

    return NextResponse.json({
      success: true,
      found: sessions.length,
      resolved,
      flagged,
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
