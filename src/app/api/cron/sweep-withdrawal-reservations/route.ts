/**
 * PAYOUT-SYSTEM-SPEC.md §2.5 — sweeper for credit reservations fenced behind
 * abandoned withdrawal requests.
 *
 * The age rule, its derivation from the quarterly window, and the re-run safety
 * argument all live in `src/lib/withdrawalReservationSweep.ts`. This route is
 * the Vercel-cron shell: auth, the `cron_paused` kill switch, health/log rows,
 * and the notification + CEO-queue side effects the library takes as hooks.
 */

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/cron/requireCronSecret';
import { insertCronLogSuccess, insertCronLogFailure } from '@/lib/cron/cronLog';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { createAction } from '@/lib/ceo';
import { sendWithdrawalProcessed } from '@/lib/centerNotify';
import { ownerContactByCenterId, resolveOwnerWaPhone } from '@/lib/ownerPhone';
import { formatNumber } from '@/lib/formatNumber';
import {
  RESERVATION_GRACE_DAYS,
  sweepStaleWithdrawalReservations,
  type StaleWithdrawal,
} from '@/lib/withdrawalReservationSweep';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CRON_NAME = 'sweep-withdrawal-reservations';
/** Daily. Must match the vercel.json schedule so the watchdog can judge it. */
const EXPECTED_INTERVAL_MINUTES = 1440;

const WA_AR = 'ar';

export async function POST(request: Request) {
  const cronStart = Date.now();

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
    const notifyOwner = async (row: StaleWithdrawal) => {
      const { data: center } = await supabase
        .from('centers')
        .select('phone, owner_name, name')
        .eq('id', row.center_id)
        .maybeSingle();
      const c = center as
        | { phone?: string | null; owner_name?: string | null; name?: string | null }
        | null;
      const ownerMap = await ownerContactByCenterId(supabase, [row.center_id]);
      const oc = ownerMap.get(row.center_id);
      const ownerPhone = await resolveOwnerWaPhone(
        supabase,
        oc?.authId ?? null,
        oc?.userPhone,
        c?.phone,
      );
      if (!ownerPhone) return;
      const ownerName = (c?.owner_name ?? '').trim() || (c?.name ?? '').trim() || ',';
      // Same template the manual reject path uses: the money reality is
      // identical — the request did not go out and the credits are back.
      const note = `${formatNumber(row.credits, WA_AR)} نقطة أُعيدت للرصيد بعد انتهاء نافذة السحب`;
      await sendWithdrawalProcessed(ownerPhone, ownerName, 'رفض', row.credits, note);
    };

    const raise = async (
      row: StaleWithdrawal,
      priority: 'red' | 'amber',
      title: string,
      subtitle: string,
    ) => {
      await createAction(supabase, {
        type: 'ops',
        priority,
        center_id: row.center_id,
        title,
        subtitle,
        revenue_at_risk: Number(row.cash_amount ?? 0),
        auto_generated: true,
      });
    };

    const result = await sweepStaleWithdrawalReservations(supabase, {
      hooks: {
        onReleased: async (row) => {
          // Visible, not silent (§7.5): the CEO queue has a UI, unlike
          // billing_reconciliation_reports (A11).
          await raise(
            row,
            'amber',
            `Withdrawal reservation auto-released, ${row.id}`,
            `${row.credits} credits unfenced · requested ${row.requestedYmd} · window closed ${row.windowEndYmd} · +${RESERVATION_GRACE_DAYS}d grace`,
          );
          await notifyOwner(row);
        },
        onReleaseFailed: async (row, message) => {
          // Status flipped but the RPC did not release: still fenced, and no
          // later run will retry because the row is no longer pending.
          await raise(
            row,
            'red',
            `Withdrawal reservation still fenced after sweep, ${row.id}`,
            `cancel_reservation_atomic failed: ${message.slice(0, 200)}`,
          );
        },
      },
    });

    await insertCronLogSuccess(supabase, CRON_NAME, {
      duration_ms: Date.now() - cronStart,
      records_processed: result.released,
      metadata: { ...result },
    });

    try {
      if (supabaseAdmin) {
        // expected_interval_minutes is NOT NULL with no default, so a new
        // cron_name must supply it or the very first upsert fails and the
        // watchdog never learns this job exists (A12).
        const { error: healthErr } = await supabaseAdmin.from('cron_health_log').upsert(
          {
            cron_name: CRON_NAME,
            last_success_at: new Date().toISOString(),
            failure_count: 0,
            expected_interval_minutes: EXPECTED_INTERVAL_MINUTES,
          },
          { onConflict: 'cron_name' },
        );
        if (healthErr) {
          console.error(`[${CRON_NAME}] cron_health_log:`, healthErr.message);
        }
      }
    } catch (healthLogErr) {
      console.error(`[${CRON_NAME}] cron_health_log:`, healthLogErr);
    }

    return NextResponse.json({ success: true, ...result });
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
