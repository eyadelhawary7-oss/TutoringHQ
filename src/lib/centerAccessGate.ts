// src/lib/centerAccessGate.ts
//
// The single suspension / blacklist / single-day-lock decision for centre-side
// API routes. `requireCenterAuth` uses it, and the hand-rolled routes that the
// Job 3 brief marks "block" or "close as leak" call it directly after their own
// auth has resolved a centreId, so they inherit the exact same gate without an
// auth rewrite.
//
// The lock half is gated by the lockout policy (auto-charge interlock,
// first_charge_release HELD, kill switch): while the policy is inactive, only the
// pre-existing suspension / blacklist checks apply and NO centre is locked.

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getLockoutPolicyState, isCenterLockedForEnforcement } from '@/lib/billingLockoutPolicy';

export type CenterGateBlock = 'blacklisted' | 'suspended' | 'locked';

export interface CenterGateRow {
  status?: string | null;
  is_blacklisted?: boolean | null;
  billing_status?: string | null;
  next_payment_due?: string | null;
  auto_suspend_at?: string | null;
}

/** Pure decision. `policyActive` folds in the lockout interlock/HELD/kill switch. */
export function evaluateCenterGate(
  row: CenterGateRow | null,
  policyActive: boolean,
  now: Date = new Date(),
): CenterGateBlock | null {
  if (!row) return null;
  if (row.is_blacklisted === true) return 'blacklisted';
  if (String(row.status ?? '').toLowerCase() === 'suspended') return 'suspended';
  if (isCenterLockedForEnforcement(row, policyActive, now)) return 'locked';
  return null;
}

/** Map a gate block to the standard 403 response (same shapes as centerAuth). */
export function centerGateResponseFor(block: CenterGateBlock): NextResponse {
  if (block === 'blacklisted') {
    return NextResponse.json({ error: 'Center access blocked', code: 'CENTER_BLACKLISTED' }, { status: 403 });
  }
  if (block === 'suspended') {
    return NextResponse.json({ error: 'Center access blocked', code: 'CENTER_SUSPENDED' }, { status: 403 });
  }
  return NextResponse.json({ error: 'Center payment overdue', code: 'CENTER_LOCKED' }, { status: 403 });
}

/**
 * Read the centre row, evaluate the gate, and return a 403 response when the
 * centre is blacklisted / suspended / locked, or null when it may proceed. Returns
 * null when the centre row is missing so the caller's own not-found logic runs.
 */
export async function centerAccessGateResponse(
  admin: Pick<SupabaseClient, 'from'>,
  centerId: string,
  now: Date = new Date(),
): Promise<NextResponse | null> {
  const { data } = await admin
    .from('centers')
    .select('status, is_blacklisted, billing_status, next_payment_due, auto_suspend_at')
    .eq('id', centerId)
    .maybeSingle();
  const row = data as CenterGateRow | null;
  if (!row) return null;
  const policy = await getLockoutPolicyState();
  const block = evaluateCenterGate(row, policy.active, now);
  return block ? centerGateResponseFor(block) : null;
}
