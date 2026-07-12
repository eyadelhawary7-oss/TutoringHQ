import { NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/cron/requireCronSecret';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { T2_ACTIVE_DAYS } from '@/lib/commission/rates';
import { loadTierCandidates, recomputeT2Amount } from '@/lib/commission/tierUnlock';
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
  const skipped = 0;

  // Owner-polymorphic (centers + teachers), gated on live billing + 180 active days.
  const eligibleForDays = await loadTierCandidates(supabase, 't2_status', T2_ACTIVE_DAYS);

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
  const unlockable: typeof eligibleForDays = [];

  for (const row of eligibleForDays) {
    const staffMember = staffMap.get(row.staff_id);
    if (staffMember?.status === 'terminated' && staffMember.termination_type !== 'completed') {
      forfeitPayload.push({
        id: row.id,
        activeDays: row.activeDays,
        termination_type: String(staffMember.termination_type ?? ''),
      });
    } else {
      unlockable.push(row);
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

  // Unlock per-row: the T2 half is RECOMPUTED at the owner's CURRENT plan price
  // (up/downgrades since signing move the second half), so each row needs its own amount.
  for (const c of unlockable) {
    const t2Amount = await recomputeT2Amount(supabase, c);
    await supabase
      .from('commissions')
      .update({ t2_status: 'eligible', t2_eligible_at: today, t2_amount: t2Amount })
      .eq('id', c.id);
    await supabase.from('commission_audit_log').insert({
      commission_id: c.id,
      action: 't2_auto_unlock',
      triggered_by: 'cron',
      new_value: { t2_status: 'eligible', active_days: c.activeDays, eligible_at: today, t2_amount: t2Amount },
    });
    unlocked += 1;
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
