import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getImpliedMonthlyMrr,
  isCenterEligibleForSubscriptionMrr,
  planKeyOrStarter,
  type ImpliedMrrCenterFields,
  type PlanKey,
} from '@/lib/pricing';

/** Keys stored in mrr_snapshots.by_plan (top_centers stays distinct from scaling tier). */
export const MRR_SNAPSHOT_PLAN_KEYS = [
  'solo',
  'nano',
  'starter',
  'pro',
  'business',
  'enterprise',
  'top_centers',
] as const;

export type MrrSnapshotPlanKey = (typeof MRR_SNAPSHOT_PLAN_KEYS)[number];

export type MrrPlanBreakdownEntry = { count: number; mrr: number };

export type MrrSnapshotComputed = {
  total_mrr: number;
  active_centers: number;
  by_plan: Record<string, MrrPlanBreakdownEntry>;
};

function emptyBreakdown(): Record<string, MrrPlanBreakdownEntry> {
  const out: Record<string, MrrPlanBreakdownEntry> = {};
  for (const k of MRR_SNAPSHOT_PLAN_KEYS) {
    out[k] = { count: 0, mrr: 0 };
  }
  return out;
}

/** Bucket key for by_plan: real top_centers → top_centers; else planKeyOrStarter (unknown → starter). */
export function planKeyForMrrBreakdown(plan: string | null | undefined): MrrSnapshotPlanKey | PlanKey {
  const raw = String(plan || 'starter').toLowerCase();
  if (raw === 'top_centers') return 'top_centers';
  return planKeyOrStarter(plan);
}

export async function computeMrrSnapshot(supabase: SupabaseClient): Promise<MrrSnapshotComputed> {
  const { data, error } = await supabase.from('centers').select('*');
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as ImpliedMrrCenterFields[];
  const by_plan = emptyBreakdown();
  let total_mrr = 0;
  let active_centers = 0;

  for (const row of rows) {
    if (!isCenterEligibleForSubscriptionMrr(row)) continue;

    const mrr = getImpliedMonthlyMrr(row);
    total_mrr += mrr;

    if (mrr > 0) active_centers += 1;

    const bucket = String(planKeyForMrrBreakdown(row.plan));
    const b = by_plan[bucket] ?? { count: 0, mrr: 0 };
    b.count += 1;
    b.mrr += mrr;
    by_plan[bucket] = b;
  }

  const roundedTotal = Math.round(total_mrr * 100) / 100;
  for (const k of Object.keys(by_plan)) {
    const e = by_plan[k];
    e.mrr = Math.round(e.mrr * 100) / 100;
  }

  return {
    total_mrr: roundedTotal,
    active_centers,
    by_plan,
  };
}
