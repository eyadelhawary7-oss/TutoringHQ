import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/cron/requireCronSecret';
import { insertCronLogSuccess, insertCronLogFailure } from '@/lib/cron/cronLog';
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

    // Fix C: recover both 'pending' sessions AND 'failed' sessions whose card
    // actually went through but whose finalize hit a transient error. Because
    // finalized_at is now set ONLY on genuine completion (never on a failed
    // attempt), `finalized_at IS NULL` no longer hides a half-finalized session
    // — re-inquiring Paymob and re-running the idempotent finalize recovers it.
    const { data: stuckSessions, error: fetchErr } = await supabase
      .from('combined_payment_sessions')
      .select(
        'id, paymob_order_id, center_id, total_amount, session_type, created_at, credit_amount',
      )
      .in('status', ['pending', 'failed'])
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
                title: `Stuck payment session, ${(session as { center_id: string }).center_id}`,
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

    // Fix C — defensive recovery: detect any "half-finalized" session, i.e.
    // finalized_at set but the session never reached a terminal-good state. The
    // new finalize never produces this (finalized_at is set atomically with
    // status='paid'), but a legacy row could exist where credit was consumed and
    // the session then froze. Surface each for safe manual unwind rather than
    // auto-clearing finalized_at (which could double-spend if credit was already
    // consumed). The session is otherwise invisible to the recovery query above.
    let halfFinalized = 0;
    const { data: corruptSessions } = await supabase
      .from('combined_payment_sessions')
      .select('id, center_id, credit_amount, status, finalized_at, total_amount, session_type')
      .not('finalized_at', 'is', null)
      .not('status', 'in', '("paid","expired")');

    for (const cs of corruptSessions ?? []) {
      const c = cs as {
        id: string;
        center_id: string | null;
        status?: string;
        total_amount?: number | string;
        session_type?: string;
      };
      try {
        await createAction(supabase, {
          type: 'ops',
          priority: 'red',
          center_id: c.center_id ?? null,
          title: `Half-finalized payment session needs unwind, ${c.id}`,
          subtitle: `status=${c.status ?? '?'} finalized but not paid · ${c.session_type ?? ''}`,
          revenue_at_risk: Number(c.total_amount) || 0,
          auto_generated: true,
        });
      } catch (ceoErr) {
        console.error('[check-stuck-payments] half-finalized ceo_action_queue', ceoErr);
      }
      halfFinalized++;
    }

    const recordsProcessed = sessions.length;
    await insertCronLogSuccess(supabase, CRON_NAME, {
      duration_ms: Date.now() - cronStart,
      records_processed: recordsProcessed,
      metadata: { resolved, flagged, halfFinalized },
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
      halfFinalized,
    });
  } catch (error) {
    console.error(`[${CRON_NAME}] Error:`, error);
    await insertCronLogFailure(supabase, CRON_NAME, error, {
      duration_ms: Date.now() - cronStart,
    });
    return NextResponse.json({ success: false }, { status: 200 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
