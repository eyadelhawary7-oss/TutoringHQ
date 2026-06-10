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

const CRON_NAME = 'commission-t2-check';

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

/** Runs at 9am UTC daily - after process-renewals so billing reflects payment state before T2 unlock. */
export async function GET(request: Request) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  if (!supabase) {
    return NextResponse.json({ error: tCronBackup('errorServerMisconfigured') }, { status: 500 });
  }

  const cronStart = Date.now();

  try {
  const today = new Date().toISOString().split('T')[0];
  let unlocked = 0;
  let forfeited = 0;
  let skipped = 0;

  const { data: candidates, error: candidatesError } = await supabase
    .from('commissions')
    .select(
      `
      id, staff_id, center_id, t2_amount,
      center_first_payment_date, clock_pause_log,
      centers!inner(billing_status, next_payment_due)
    `,
    )
    .eq('t2_status', 'locked')
    .not('center_first_payment_date', 'is', null)
    .not('staff_id', 'is', null);
  if (candidatesError) {
    console.error('[commission-t2-check]', candidatesError.message);
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
    if (!center) {
      skipped++;
      continue;
    }

    if (!['active', 'paid'].includes(center.billing_status)) {
      skipped++;
      continue;
    }
    const npd = center.next_payment_due;
    if (!npd) {
      skipped++;
      continue;
    }
    const nextDue = new Date(npd);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 14);
    if (nextDue < cutoff) {
      skipped++;
      continue;
    }

    const activeDays = computeActiveDaysFromFirstPayment(
      c.center_first_payment_date,
      parseClockPauseLog(c.clock_pause_log),
    );
    if (activeDays < 180) {
      skipped++;
      continue;
    }

    eligibleForDays.push({ id: c.id, staff_id: c.staff_id, activeDays });
  }

  const staffIds = [...new Set(eligibleForDays.map((e) => e.staff_id))];
  const { data: staffRows, error: staffBulkErr } = await supabase
    .from('staff')
    .select('id, status, termination_type')
    .in('id', staffIds);
  if (staffBulkErr) {
    console.error('[commission-t2-check] staff bulk', staffBulkErr.message);
  }

  const staffMap = new Map(
    (staffRows ?? []).map((s) => [s.id as string, s as { status?: string; termination_type?: string | null }]),
  );

  const forfeitPayload: { id: string; activeDays: number; termination_type: string }[] = [];
  const unlockPayload: { id: string; activeDays: number }[] = [];

  for (const row of eligibleForDays) {
    const staffMember = staffMap.get(row.staff_id);
    if (staffMember?.status === 'terminated' && staffMember.termination_type !== 'completed') {
      forfeitPayload.push({
        id: row.id,
        activeDays: row.activeDays,
        termination_type: String(staffMember.termination_type ?? ''),
      });
    } else {
      unlockPayload.push({ id: row.id, activeDays: row.activeDays });
    }
  }

  if (forfeitPayload.length > 0) {
    await supabase
      .from('commissions')
      .update({ t2_status: 'forfeited' })
      .in(
        'id',
        forfeitPayload.map((x) => x.id),
      );
    await supabase.from('commission_audit_log').insert(
      forfeitPayload.map((x) => ({
        commission_id: x.id,
        action: 't2_forfeited',
        triggered_by: 'cron',
        reason: `Staff ${x.termination_type} before T2 unlocked`,
        new_value: { t2_status: 'forfeited', active_days: x.activeDays },
      })),
    );
    forfeited = forfeitPayload.length;
  }

  if (unlockPayload.length > 0) {
    await supabase
      .from('commissions')
      .update({ t2_status: 'eligible', t2_eligible_at: today })
      .in(
        'id',
        unlockPayload.map((x) => x.id),
      );
    await supabase.from('commission_audit_log').insert(
      unlockPayload.map((x) => ({
        commission_id: x.id,
        action: 't2_auto_unlock',
        triggered_by: 'cron',
        new_value: { t2_status: 'eligible', active_days: x.activeDays, eligible_at: today },
      })),
    );
    unlocked = unlockPayload.length;
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
    console.error('[commission-t2-check] cron_health_log:', healthLogErr);
  }

  await insertCronLogSuccess(supabase, CRON_NAME, {
    duration_ms: Date.now() - cronStart,
    records_processed: unlocked + forfeited,
  });

  return NextResponse.json({
    success: true,
    date: today,
    t2_unlocked: unlocked,
    t2_forfeited: forfeited,
    skipped,
  });
  } catch (e) {
    console.error('[commission-t2-check]', e);
    await insertCronLogFailure(supabase, CRON_NAME, e, { duration_ms: Date.now() - cronStart });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'internal' },
      { status: 500 },
    );
  }
}
