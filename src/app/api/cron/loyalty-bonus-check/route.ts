import { NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/cron/requireCronSecret';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  computeActiveDaysFromFirstPayment,
  parseClockPauseLog,
} from '@/lib/commissionActiveDays';
import { tCronBackup } from '@/lib/cronBackupI18n';
import { insertCronLogFailure, insertCronLogSuccess } from '@/lib/cron/cronLog';

const CRON_NAME = 'loyalty-bonus-check';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase =
  supabaseUrl && serviceKey
    ? createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

/** Runs at 9am UTC daily. Loyalty unlocks after 365 actual active days (paused intervals excluded). */
export async function GET(request: Request) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  if (!supabase) {
    return NextResponse.json({ error: tCronBackup('errorServerMisconfigured') }, { status: 500 });
  }

  const cronStart = Date.now();

  try {
  const today = new Date().toISOString().split('T')[0];
  let eligible = 0;
  let forfeited = 0;

  const { data: candidates, error: candidatesError } = await supabase
    .from('commissions')
    .select(
      `
      id, staff_id, loyalty_bonus_amount,
      center_first_payment_date, clock_pause_log,
      centers!inner(billing_status, next_payment_due)
    `,
    )
    .eq('loyalty_bonus_status', 'locked')
    .not('center_first_payment_date', 'is', null)
    .not('staff_id', 'is', null);
  if (candidatesError) {
    console.error('[loyalty-bonus-check]', candidatesError.message);
  }

  type CandidateRow = {
    id: string;
    staff_id: string;
    center_first_payment_date: string;
    clock_pause_log: unknown;
    centers:
      | { billing_status: string; next_payment_due: string | null }
      | { billing_status: string; next_payment_due: string | null }[];
  };

  const eligibleForDays: { id: string; staff_id: string; activeDays: number }[] = [];

  for (const commission of candidates ?? []) {
    const c = commission as CandidateRow;
    const center = Array.isArray(c.centers) ? c.centers[0] : c.centers;
    if (!center) continue;

    if (!['active', 'paid'].includes(center.billing_status)) continue;
    const npd = center.next_payment_due;
    if (!npd) continue;
    const nextDue = new Date(npd);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 14);
    if (nextDue < cutoff) continue;

    const activeDays = computeActiveDaysFromFirstPayment(
      c.center_first_payment_date,
      parseClockPauseLog(c.clock_pause_log),
    );
    if (activeDays < 365) continue;

    eligibleForDays.push({ id: c.id, staff_id: c.staff_id, activeDays });
  }

  const staffIds = [...new Set(eligibleForDays.map((e) => e.staff_id))];
  const { data: staffRows, error: staffBulkErr } = await supabase
    .from('staff')
    .select('id, status, termination_type')
    .in('id', staffIds);
  if (staffBulkErr) {
    console.error('[loyalty-bonus-check] staff bulk', staffBulkErr.message);
  }

  const staffMap = new Map(
    (staffRows ?? []).map((s) => [s.id as string, s as { status?: string; termination_type?: string | null }]),
  );

  const forfeitIds: string[] = [];
  const unlockPayload: { id: string; activeDays: number }[] = [];

  for (const row of eligibleForDays) {
    const staffMember = staffMap.get(row.staff_id);
    if (staffMember?.status === 'terminated' && staffMember.termination_type !== 'completed') {
      forfeitIds.push(row.id);
    } else {
      unlockPayload.push({ id: row.id, activeDays: row.activeDays });
    }
  }

  if (forfeitIds.length > 0) {
    await supabase.from('commissions').update({ loyalty_bonus_status: 'forfeited' }).in('id', forfeitIds);
    forfeited = forfeitIds.length;
  }

  if (unlockPayload.length > 0) {
    await supabase
      .from('commissions')
      .update({ loyalty_bonus_status: 'eligible', loyalty_bonus_eligible_at: today })
      .in(
        'id',
        unlockPayload.map((x) => x.id),
      );
    await supabase.from('commission_audit_log').insert(
      unlockPayload.map((x) => ({
        commission_id: x.id,
        action: 'loyalty_eligible_set',
        triggered_by: 'cron',
        new_value: { loyalty_bonus_status: 'eligible', active_days: x.activeDays, eligible_at: today },
      })),
    );
    eligible = unlockPayload.length;
  }

  try {
    if (supabaseAdmin) {
      await supabaseAdmin.from('cron_health_log').upsert(
        {
          cron_name: CRON_NAME,
          last_success_at: new Date().toISOString(),
          failure_count: 0,
        },
        { onConflict: 'cron_name' },
      );
    }
  } catch (healthLogErr) {
    console.error('[loyalty-bonus-check] cron_health_log:', healthLogErr);
  }

  await insertCronLogSuccess(supabase, CRON_NAME, {
    duration_ms: Date.now() - cronStart,
    records_processed: eligible + forfeited,
  });

  return NextResponse.json({
    success: true,
    date: today,
    loyalty_eligible: eligible,
    forfeited,
  });
  } catch (e) {
    console.error('[loyalty-bonus-check]', e);
    await insertCronLogFailure(supabase, CRON_NAME, e, { duration_ms: Date.now() - cronStart });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'internal' },
      { status: 500 },
    );
  }
}
