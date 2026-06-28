// src/lib/summer/referral.ts
//
// Summer referral rule (pure): no referral reward is granted or counted during
// the free period. Each referral accumulates as PENDING and converts to GRANTED
// only when the referred customer pays their FIRST invoice (Aug 30 onward). This
// mirrors — and tightens — the existing referral engines, which already key
// rewards off real payment signals (referred_first_paid_at / first cleared
// charge); during the summer free weeks nobody has paid, so nothing converts.
// "No payment, no reward" also prevents gaming during the free period.

export type SummerReferralStatus = 'pending' | 'granted';

export interface SummerReferralInput {
  /** Current persisted status of the referral reward. */
  current: SummerReferralStatus;
  /** Has the REFERRED customer paid their first invoice? */
  referredFirstInvoicePaid: boolean;
  /** Self-referral (referrer === referred) — never rewarded. */
  selfReferral?: boolean;
}

/**
 * Resolve the next referral-reward status. Idempotent and monotonic: once
 * 'granted' it stays granted; it only flips pending→granted on the first paid
 * invoice; a self-referral never grants.
 */
export function resolveSummerReferralStatus(input: SummerReferralInput): SummerReferralStatus {
  if (input.selfReferral) return 'pending';
  if (input.current === 'granted') return 'granted';
  return input.referredFirstInvoicePaid ? 'granted' : 'pending';
}

/** True iff a reward may be granted right now (first invoice paid, not self, not already granted). */
export function summerReferralRewardAllowed(input: SummerReferralInput): boolean {
  if (input.selfReferral) return false;
  if (input.current === 'granted') return false;
  return input.referredFirstInvoicePaid === true;
}
