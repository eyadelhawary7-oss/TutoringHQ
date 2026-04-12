/**
 * Upgrade nudge when active students reach 80% of plan cap (daily cron)
 */

import { NextResponse } from 'next/server';
import { sendUpgradeNudge } from '@/lib/centerNotify';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CRON_NAME = 'upgrade-nudge';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const CAPS: Record<string, number> = {
  nano: 100,
  starter: 250,
  pro: 500,
  business: 1000,
  enterprise: 2000,
};

const NEXT_PLAN: Record<string, string> = {
  nano: 'starter',
  starter: 'pro',
  pro: 'business',
  business: 'enterprise',
};

const NEXT_PLAN_AR: Record<string, string> = {
  starter: 'أساسي',
  pro: 'محترف',
  business: 'أعمال',
  enterprise: 'مؤسسات',
};

const NEXT_PLAN_PRICE: Record<string, string> = {
  starter: '4,499',
  pro: '7,999',
  business: '12,999',
  enterprise: '18,499',
};

type CenterRow = {
  id: string;
  name: string | null;
  plan: string | null;
  owner_name: string | null;
  owner_phone: string | null;
  phone: string | null;
  upgrade_nudge_sent_at: string | null;
};

function normalizePlanKey(plan: string | null | undefined): string | null {
  const p = (plan ?? '').toLowerCase().trim();
  return p || null;
}

function isExcludedPlan(planKey: string | null): boolean {
  if (!planKey) return true;
  return planKey === 'enterprise' || planKey === 'top_centers';
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

  const { data: centerRows, error: cErr } = await admin
    .from('centers')
    .select('id, name, plan, owner_name, owner_phone, phone, upgrade_nudge_sent_at')
    .eq('status', 'active');

  if (cErr) {
    console.error(`[${CRON_NAME}] centers:`, cErr.message);
    return NextResponse.json({ error: cErr.message }, { status: 500 });
  }

  const centers = (centerRows ?? []) as CenterRow[];
  const eligible = centers.filter((c) => !isExcludedPlan(normalizePlanKey(c.plan)));

  const { data: studentRows, error: sErr } = await admin
    .from('students')
    .select('center_id')
    .eq('is_active', true);

  if (sErr) {
    console.error(`[${CRON_NAME}] students:`, sErr.message);
    return NextResponse.json({ error: sErr.message }, { status: 500 });
  }

  const countByCenter = new Map<string, number>();
  for (const r of studentRows ?? []) {
    const cid = (r as { center_id: string }).center_id;
    if (!cid) continue;
    countByCenter.set(cid, (countByCenter.get(cid) ?? 0) + 1);
  }

  let nudgesSent = 0;

  for (const c of eligible) {
    const planKey = normalizePlanKey(c.plan);
    if (!planKey || isExcludedPlan(planKey)) continue;

    const cap = CAPS[planKey];
    if (cap == null) continue;

    const nextKey = NEXT_PLAN[planKey];
    if (!nextKey) continue;

    const nextPlanAr = NEXT_PLAN_AR[nextKey];
    const nextPlanPrice = NEXT_PLAN_PRICE[nextKey];
    if (!nextPlanAr || !nextPlanPrice) continue;

    const activeStudentCount = countByCenter.get(c.id) ?? 0;
    const threshold = cap * 0.8;
    if (activeStudentCount < threshold) continue;

    const last = c.upgrade_nudge_sent_at ? new Date(c.upgrade_nudge_sent_at).getTime() : null;
    if (last != null && now - last < THIRTY_DAYS_MS) continue;

    const ownerPhone = c.owner_phone ?? c.phone;
    let sendRes: { success?: boolean; skipped?: boolean; error?: boolean };
    try {
      sendRes = await sendUpgradeNudge(
        admin,
        c.id,
        ownerPhone,
        c.owner_name ?? '',
        c.name ?? '',
        planKey,
        activeStudentCount.toLocaleString('en-US'),
        cap.toLocaleString('en-US'),
        nextPlanAr,
        nextPlanPrice,
      );
    } catch (e) {
      console.error(`[${CRON_NAME}] sendUpgradeNudge`, c.id, e);
      continue;
    }

    if (!sendRes.success) continue;

    const { error: upErr } = await admin
      .from('centers')
      .update({ upgrade_nudge_sent_at: nowIso })
      .eq('id', c.id);
    if (upErr) {
      console.error(`[${CRON_NAME}] update`, c.id, upErr);
    } else {
      nudgesSent += 1;
    }
  }

  const processed = eligible.length;
  const skipped = processed - nudgesSent;

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

  return NextResponse.json({ processed, nudgesSent, skipped });
}

export async function GET(request: Request) {
  return POST(request);
}
