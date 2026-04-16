/**
 * Onboarding stall detection: nudge owners stuck 48h+ on a step (cron every 6h)
 */

import { NextResponse } from 'next/server';
import {
  sendOnboardingStep1Template,
  sendOnboardingStep2,
  sendOnboardingStep3,
  sendOnboardingStep4,
} from '@/lib/centerNotify';
import { getOnboardingStep } from '@/lib/onboardingStatus';
import { ownerContactByCenterId, resolveOwnerWaPhone } from '@/lib/ownerPhone';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const STALL_MS = 48 * 60 * 60 * 1000;
const CRON_NAME = 'onboarding-stall';

type CenterStallRow = {
  id: string;
  owner_name: string | null;
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
      'id, owner_name, phone, name, onboarding_step, onboarding_nudge_sent_at, onboarding_step_updated_at',
    )
    .eq('status', 'active')
    .eq('onboarding_completed', false)
    .is('onboarding_completed_at', null);

  if (qErr) {
    console.error(`[${CRON_NAME}] query:`, qErr.message);
    return NextResponse.json({ error: qErr.message }, { status: 500 });
  }

  const stalled = ((candidates ?? []) as CenterStallRow[]).filter((r) => isStalled(r, now));

  const ownerByCenter = await ownerContactByCenterId(
    admin,
    stalled.map((r) => r.id),
  );

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

    const dbStep = row.onboarding_step ?? 0;
    if (dbStep >= 4) continue;

    const oc = ownerByCenter.get(row.id);
    const ownerPhone = await resolveOwnerWaPhone(
      admin,
      oc?.authId ?? null,
      oc?.userPhone,
      row.phone,
    );
    if (!ownerPhone) continue;

    const ownerName = (row.owner_name ?? '').trim() || (row.name ?? '').trim() || '—';
    const centerName = (row.name ?? '').trim() || '—';

    let sent = false;
    try {
      if (dbStep === 0) {
        const r = await sendOnboardingStep1Template(admin, {
          id: row.id,
          name: centerName,
          phone: ownerPhone,
        });
        sent = !!r.success;
      } else if (dbStep === 1) {
        sent = await sendOnboardingStep2(ownerPhone, ownerName, centerName);
      } else if (dbStep === 2) {
        sent = await sendOnboardingStep3(ownerPhone, ownerName, centerName);
      } else if (dbStep === 3) {
        sent = await sendOnboardingStep4(ownerPhone, ownerName, centerName);
      }
    } catch (e) {
      console.error(`[${CRON_NAME}] onboarding template`, row.id, e);
      continue;
    }

    if (!sent) continue;

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
