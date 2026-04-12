/**
 * Onboarding stall detection: nudge owners stuck 48h+ on a step (cron every 6h)
 */

import { NextResponse } from 'next/server';
import { sendOnboardingNudge } from '@/lib/centerNotify';
import { getOnboardingStep } from '@/lib/onboardingStatus';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const STALL_MS = 48 * 60 * 60 * 1000;
const CRON_NAME = 'onboarding-stall';

type CenterStallRow = {
  id: string;
  owner_name: string | null;
  owner_phone: string | null;
  phone: string | null;
  name: string | null;
  onboarding_step: number | null;
  onboarding_nudge_sent_at: string | null;
  onboarding_step_updated_at: string | null;
};

function isStalled(row: CenterStallRow, now: number): boolean {
  const stepAt = row.onboarding_step_updated_at
    ? new Date(row.onboarding_step_updated_at).getTime()
    : null;
  const staleStep = stepAt === null || now - stepAt > STALL_MS;

  const nudgeAt = row.onboarding_nudge_sent_at
    ? new Date(row.onboarding_nudge_sent_at).getTime()
    : null;
  const staleNudge = nudgeAt === null || now - nudgeAt > STALL_MS;

  return staleStep && staleNudge;
}

export async function POST(request: Request) {
  const auth = request.headers.get('Authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const admin = supabaseAdmin;
  const now = Date.now();
  const nowIso = new Date().toISOString();

  const { data: candidates, error: qErr } = await admin
    .from('centers')
    .select(
      'id, owner_name, owner_phone, phone, name, onboarding_step, onboarding_nudge_sent_at, onboarding_step_updated_at',
    )
    .eq('status', 'active')
    .eq('onboarding_completed', false)
    .is('onboarding_completed_at', null);

  if (qErr) {
    console.error(`[${CRON_NAME}] query:`, qErr.message);
    return NextResponse.json({ error: qErr.message }, { status: 500 });
  }

  const stalled = ((candidates ?? []) as CenterStallRow[]).filter((r) => isStalled(r, now));

  let nudgesSent = 0;
  let completed = 0;

  for (const row of stalled) {
    let step: number;
    try {
      step = await getOnboardingStep(row.id, admin);
    } catch (e) {
      console.error(`[${CRON_NAME}] getOnboardingStep`, row.id, e);
      continue;
    }

    if (step === 5) {
      const { error: upErr } = await admin
        .from('centers')
        .update({
          onboarding_completed_at: nowIso,
          onboarding_completed: true,
          onboarding_step: 5,
          onboarding_step_updated_at: nowIso,
        })
        .eq('id', row.id);
      if (upErr) {
        console.error(`[${CRON_NAME}] complete update`, row.id, upErr);
      } else {
        completed += 1;
      }
      continue;
    }

    if (step < 1 || step > 4) continue;

    let sendRes: { success?: boolean; skipped?: boolean; error?: boolean };
    try {
      sendRes = await sendOnboardingNudge(
        admin,
        row.id,
        step as 1 | 2 | 3 | 4,
        row.owner_phone ?? row.phone,
        row.name ?? '',
      );
    } catch (e) {
      console.error(`[${CRON_NAME}] sendOnboardingNudge`, row.id, e);
      continue;
    }

    if (!sendRes.success) continue;

    const { error: upErr } = await admin
      .from('centers')
      .update({
        onboarding_nudge_sent_at: nowIso,
        onboarding_step: step,
        onboarding_step_updated_at: nowIso,
      })
      .eq('id', row.id);
    if (upErr) {
      console.error(`[${CRON_NAME}] nudge update`, row.id, upErr);
    } else {
      nudgesSent += 1;
    }
  }

  try {
    await admin.from('cron_health_log').upsert(
      {
        cron_name: CRON_NAME,
        last_success_at: nowIso,
        failure_count: 0,
      },
      { onConflict: 'cron_name' },
    );
  } catch (healthLogErr) {
    console.error(`[${CRON_NAME}] cron_health_log:`, healthLogErr);
  }

  return NextResponse.json({
    processed: stalled.length,
    nudgesSent,
    completed,
  });
}

export async function GET(request: Request) {
  return POST(request);
}
