import { NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/cron/requireCronSecret';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { LOYALTY_ACTIVE_DAYS } from '@/lib/commission/rates';
import { loadTierCandidates, recomputeLoyaltyAmount } from '@/lib/commission/tierUnlock';
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

  // Owner-polymorphic (centers + teachers), gated on live billing + 365 active days.
  const eligibleForDays = await loadTierCandidates(supabase, 'loyalty_bonus_status', LOYALTY_ACTIVE_DAYS);

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
  const unlockable: typeof eligibleForDays = [];

  for (const row of eligibleForDays) {
    const staffMember = staffMap.get(row.staff_id);
    if (staffMember?.status === 'terminated' && staffMember.termination_type !== 'completed') {
      forfeitIds.push(row.id);
    } else {
      unlockable.push(row);
    }
  }

  if (forfeitIds.length > 0) {
    await supabase.from('commissions').update({ loyalty_bonus_status: 'forfeited' }).in('id', forfeitIds);
    forfeited = forfeitIds.length;
  }

  // Unlock per-row: loyalty is 1% of the owner's REAL first-12-months revenue (an
  // override row gets 20% of the rep's), so the amount is computed at unlock, not signing.
  for (const c of unlockable) {
    const loyaltyAmount = await recomputeLoyaltyAmount(supabase, c);
    await supabase
      .from('commissions')
      .update({ loyalty_bonus_status: 'eligible', loyalty_bonus_eligible_at: today, loyalty_bonus_amount: loyaltyAmount })
      .eq('id', c.id);
    await supabase.from('commission_audit_log').insert({
      commission_id: c.id,
      action: 'loyalty_eligible_set',
      triggered_by: 'cron',
      new_value: {
        loyalty_bonus_status: 'eligible',
        active_days: c.activeDays,
        eligible_at: today,
        loyalty_bonus_amount: loyaltyAmount,
      },
    });
    eligible += 1;
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
