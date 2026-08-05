/**
 * The referral commission status vocabulary — one place, one meaning each.
 *
 * ## Why this file exists (D22)
 *
 * Referral balances used to be read from TWO tables with TWO status
 * vocabularies that overlapped only on 'paid':
 *
 *   retired  `referral_reward_records`: pending | held | available | paid
 *   canonical `referral_commissions`:   hold | withdrawable | paid | forfeited
 *
 * `referral_reward_records` is written only by POST /api/referrals/calculate-rewards,
 * which has no cron registration in vercel.json and no caller in src/. Its
 * 'available' bucket was therefore structurally empty, and every centre
 * withdrawal was refused because the balance check could never see a non-zero
 * figure. `referral_commissions` is written monthly by
 * /api/cron/referral-automation — the only referral cron — which sets
 * `holdUntil ? 'hold' : 'withdrawable'`.
 *
 * The old vocabulary carried the defect in its own shape: 'pending' and 'held'
 * were two names for "not yet payable". Both collapse to 'hold' here.
 *
 * ## This module does NOT price a payout
 *
 * It decides which rows count toward a balance. How that balance is priced when
 * withdrawn — the 1,000 EGP gross minimum, the flat 20 EGP fee, then 5% on the
 * remainder — is `computeReferralPayout` in `src/lib/referralPayout.ts` and is
 * deliberately untouched by this module.
 */

export type ReferralCommissionStatus = 'hold' | 'withdrawable' | 'paid' | 'forfeited';

/** Mirrors the live CHECK constraint `referral_commissions_status_check`. */
export const REFERRAL_COMMISSION_STATUSES: readonly ReferralCommissionStatus[] = [
  'hold',
  'withdrawable',
  'paid',
  'forfeited',
] as const;

/**
 * Commission the centre actually earned — held, payable, or already paid.
 * 'forfeited' is excluded: it is commission LOST when the referred centre failed
 * to pay in full, written by /api/referrals/process-commission with
 * commission_amount 0. It is reported on its own line, never folded into earnings.
 */
export const EARNED_STATUSES: readonly ReferralCommissionStatus[] = [
  'hold',
  'withdrawable',
  'paid',
] as const;

/**
 * Earned but not yet paid out — what the platform still owes the referrer.
 * This is the only set an admin may mark paid.
 */
export const OUTSTANDING_STATUSES: readonly ReferralCommissionStatus[] = [
  'hold',
  'withdrawable',
] as const;

/** The single status a centre may withdraw against. */
export const WITHDRAWABLE_STATUS: ReferralCommissionStatus = 'withdrawable';

export interface CommissionAmountRow {
  status: string | null;
  commission_amount: number | string | null;
}

function sumWhere(rows: readonly CommissionAmountRow[], match: (s: string) => boolean): number {
  return (rows ?? []).reduce(
    (sum, r) => (match(String(r?.status ?? '')) ? sum + (Number(r?.commission_amount) || 0) : sum),
    0,
  );
}

/**
 * The balance a centre may request a withdrawal against.
 *
 * This is the D22 regression surface: before the fix this summed
 * `referral_reward_records` rows with status 'available', a bucket nothing
 * writes, so it returned 0 for every centre forever and every withdrawal was
 * refused. A 'withdrawable' row MUST produce a non-zero result here.
 */
export function withdrawableBalance(rows: readonly CommissionAmountRow[]): number {
  return sumWhere(rows, (s) => s === WITHDRAWABLE_STATUS);
}

/** Held commission — earned, not payable yet. */
export function heldBalance(rows: readonly CommissionAmountRow[]): number {
  return sumWhere(rows, (s) => s === 'hold');
}

/** Commission already paid out. */
export function paidBalance(rows: readonly CommissionAmountRow[]): number {
  return sumWhere(rows, (s) => s === 'paid');
}

/** Commission lost because the referred centre did not pay in full. */
export function forfeitedBalance(rows: readonly CommissionAmountRow[]): number {
  return sumWhere(rows, (s) => s === 'forfeited');
}

/** Held + withdrawable + paid. Excludes forfeited. */
export function earnedBalance(rows: readonly CommissionAmountRow[]): number {
  return sumWhere(rows, (s) => (EARNED_STATUSES as readonly string[]).includes(s));
}

export interface CenterStatusPresentation {
  /** Key under the `referrals` i18n namespace. */
  labelKey: string;
  /** Badge tone. 'neutral' is the greyed treatment. */
  tone: 'gold' | 'success' | 'neutral';
  /**
   * Render the row de-emphasised. True only for 'forfeited': the amount stays
   * visible — a centre must see what it lost, not have the row disappear.
   */
  greyed: boolean;
}

/**
 * How one commission row is presented to the CENTRE (not to admin).
 *
 * 'forfeited' is deliberately shown as "expired" rather than "forfeited": the
 * centre-facing wording describes the outcome (the commission window closed
 * without a full payment), and the row is greyed with its amount intact.
 */
export function centerStatusPresentation(status: string | null | undefined): CenterStatusPresentation {
  switch (String(status ?? '')) {
    case 'hold':
      return { labelKey: 'rewardStatusHeldShort', tone: 'gold', greyed: false };
    case 'withdrawable':
      return { labelKey: 'rewardStatusAvailable', tone: 'success', greyed: false };
    case 'paid':
      return { labelKey: 'rewardStatusPaid', tone: 'success', greyed: false };
    case 'forfeited':
      return { labelKey: 'rewardStatusExpired', tone: 'neutral', greyed: true };
    default:
      // An unrecognised status is rendered verbatim by the caller rather than
      // guessed at. An empty labelKey is the signal to do so.
      return { labelKey: '', tone: 'neutral', greyed: false };
  }
}
