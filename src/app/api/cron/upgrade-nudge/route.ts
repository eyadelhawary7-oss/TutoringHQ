/**
 * Upgrade nudge when active students reach 80% of plan cap (daily cron)
 */

import { NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/cron/requireCronSecret';
import { sendUpgradeNudge } from '@/lib/centerNotify';
import { ownerContactByCenterId, resolveOwnerWaPhoneCached } from '@/lib/ownerPhone';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { formatCurrency, formatNumber } from '@/lib/formatNumber';
import { PLANS, type PlanKey } from '@/lib/pricing';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CRON_NAME = 'upgrade-nudge';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const CAPS: Record<string, number> = {
  solo: PLANS.solo.weeklyStudentLimit ?? 50,
  nano: PLANS.nano.weeklyStudentLimit ?? 75,
  starter: PLANS.starter.weeklyStudentLimit ?? 150,
  pro: PLANS.pro.weeklyStudentLimit ?? 500,
  business: PLANS.business.weeklyStudentLimit ?? 1000,
  enterprise: PLANS.enterprise.weeklyStudentLimit ?? 2000,
};

const NEXT_PLAN: Record<string, string> = {
  solo: 'nano',
  nano: 'starter',
  starter: 'pro',
  pro: 'business',
  business: 'enterprise',
};

const NEXT_PLAN_AR: Record<string, string> = {
  solo: 'فردي',
  nano: 'سنتر نانو',
  starter: 'أساسي',
  pro: 'محترف',
  business: 'أعمال',
  enterprise: 'مؤسسات',
};

type CenterRow = {
  id: string;
  name: string | null;
  plan: string | null;
  owner_name: string | null;
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
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const admin = supabaseAdmin;
  const now = Date.now();
  const nowIso = new Date().toISOString();

  const { data: centerRows, error: cErr } = await admin
    .from('centers')
    .select('id, name, plan, owner_name, phone, upgrade_nudge_sent_at')
    .eq('status', 'active');

  if (cErr) {
    console.error(`[${CRON_NAME}] centers:`, cErr.message);
    return NextResponse.json({ error: cErr.message }, { status: 500 });
  }

  const centers = (centerRows ?? []) as CenterRow[];
  const eligible = centers.filter((c) => !isExcludedPlan(normalizePlanKey(c.plan)));

  const ownerByCenter = await ownerContactByCenterId(
    admin,
    eligible.map((c) => c.id),
  );
  const ownerPhoneCache = new Map<string, string | null>();

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
    const nextPlanPrice = formatCurrency(PLANS[nextKey as PlanKey].quarterlyAllIn, 'ar');
    if (!nextPlanAr || !nextPlanPrice) continue;

    const activeStudentCount = countByCenter.get(c.id) ?? 0;
    const threshold = cap * 0.8;
    if (activeStudentCount < threshold) continue;

    const last = c.upgrade_nudge_sent_at ? new Date(c.upgrade_nudge_sent_at).getTime() : null;
    if (last != null && now - last < THIRTY_DAYS_MS) continue;

    const oc = ownerByCenter.get(c.id);
    const ownerPhone = await resolveOwnerWaPhoneCached(
      admin,
      oc?.authId ?? null,
      oc?.userPhone,
      c.phone,
      ownerPhoneCache,
    );
    let sendRes: { success?: boolean; skipped?: boolean; error?: boolean };
    try {
      sendRes = await sendUpgradeNudge(
        admin,
        c.id,
        ownerPhone,
        c.owner_name ?? '',
        c.name ?? '',
        planKey,
        formatNumber(activeStudentCount, 'ar'),
        formatNumber(cap, 'ar'),
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
