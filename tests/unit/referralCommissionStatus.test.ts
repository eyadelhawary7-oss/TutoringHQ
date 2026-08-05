/**
 * D22 — the referral canonical-source regression suite.
 *
 * Two things are locked here:
 *
 *  (a) A 'withdrawable' row produces a NON-ZERO available balance.
 *      This is the bug. The withdrawal check used to sum
 *      `referral_reward_records` rows with status 'available', a bucket whose
 *      only writer (POST /api/referrals/calculate-rewards) had no cron
 *      registration in vercel.json and no caller in src/, and which was deleted
 *      on 5 August 2026. The sum was therefore
 *      always 0 and every centre withdrawal was refused forever. If someone
 *      repoints the balance at a source nothing writes again, this fails.
 *
 *  (b) Every status maps to the intended centre-facing label, including
 *      forfeited → "expired", greyed, amount still shown.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EARNED_STATUSES,
  OUTSTANDING_STATUSES,
  REFERRAL_COMMISSION_STATUSES,
  WITHDRAWABLE_STATUS,
  centerStatusPresentation,
  earnedBalance,
  forfeitedBalance,
  heldBalance,
  paidBalance,
  withdrawableBalance,
} from '@/lib/referralCommissionStatus';

const row = (status: string, commission_amount: number) => ({ status, commission_amount });

type Messages = { referrals: Record<string, string> };
const loadMessages = (locale: string): Messages =>
  JSON.parse(readFileSync(join(process.cwd(), 'messages', `${locale}.json`), 'utf8')) as Messages;
const enMessages = loadMessages('en');
const arMessages = loadMessages('ar');

describe('(a) a withdrawable row produces a non-zero available balance', () => {
  it('THE REGRESSION: one withdrawable row is a withdrawable balance, not 0', () => {
    const balance = withdrawableBalance([row('withdrawable', 1500)]);
    expect(balance).toBe(1500);
    expect(balance).not.toBe(0);
  });

  it('sums every withdrawable row and ignores the rest', () => {
    const rows = [
      row('withdrawable', 1000),
      row('withdrawable', 250.5),
      row('hold', 9999),
      row('paid', 9999),
      row('forfeited', 9999),
    ];
    expect(withdrawableBalance(rows)).toBe(1250.5);
  });

  it('clears the 1,000 EGP withdrawal minimum from withdrawable rows alone', () => {
    // The floor is unreachable if only 'hold' counted — the shape of the old bug.
    expect(withdrawableBalance([row('withdrawable', 600), row('withdrawable', 400)])).toBe(1000);
    expect(withdrawableBalance([row('hold', 600), row('hold', 400)])).toBe(0);
  });

  it("'available' is NOT a status of the canonical table and contributes nothing", () => {
    // The retired vocabulary must not silently keep working.
    expect(REFERRAL_COMMISSION_STATUSES).not.toContain('available');
    expect(withdrawableBalance([row('available', 5000)])).toBe(0);
  });

  it("retired 'pending' and 'held' are gone; both meant not-yet-payable and are now 'hold'", () => {
    expect(REFERRAL_COMMISSION_STATUSES).not.toContain('pending');
    expect(REFERRAL_COMMISSION_STATUSES).not.toContain('held');
    expect(heldBalance([row('pending', 100), row('held', 100)])).toBe(0);
    expect(heldBalance([row('hold', 100)])).toBe(100);
  });

  it('splits a mixed ledger into the four buckets without double counting', () => {
    const rows = [
      row('hold', 100),
      row('withdrawable', 200),
      row('paid', 300),
      row('forfeited', 400),
    ];
    expect(heldBalance(rows)).toBe(100);
    expect(withdrawableBalance(rows)).toBe(200);
    expect(paidBalance(rows)).toBe(300);
    expect(forfeitedBalance(rows)).toBe(400);
    // Earned excludes forfeited — lost commission is not earnings.
    expect(earnedBalance(rows)).toBe(600);
  });

  it('tolerates numeric strings and nulls from the driver without NaN', () => {
    const rows = [
      { status: 'withdrawable', commission_amount: '750.25' },
      { status: 'withdrawable', commission_amount: null },
      { status: null, commission_amount: 100 },
    ];
    expect(withdrawableBalance(rows)).toBe(750.25);
    expect(Number.isNaN(withdrawableBalance(rows))).toBe(false);
  });

  it('an empty ledger is 0 — a real zero, not a broken read', () => {
    expect(withdrawableBalance([])).toBe(0);
  });
});

describe('status sets match the live CHECK constraint and payout rules', () => {
  it('mirrors referral_commissions_status_check exactly', () => {
    expect([...REFERRAL_COMMISSION_STATUSES].sort()).toEqual(
      ['forfeited', 'hold', 'paid', 'withdrawable'].sort(),
    );
  });

  it('withdrawable is the single status a centre may withdraw against', () => {
    expect(WITHDRAWABLE_STATUS).toBe('withdrawable');
  });

  it('outstanding = hold + withdrawable; forfeited can never be marked paid', () => {
    expect([...OUTSTANDING_STATUSES].sort()).toEqual(['hold', 'withdrawable']);
    expect(OUTSTANDING_STATUSES).not.toContain('forfeited');
    expect(OUTSTANDING_STATUSES).not.toContain('paid');
  });

  it('earned = hold + withdrawable + paid, never forfeited', () => {
    expect([...EARNED_STATUSES].sort()).toEqual(['hold', 'paid', 'withdrawable']);
    expect(EARNED_STATUSES).not.toContain('forfeited');
  });
});

describe('(b) each status maps to its intended centre-facing label', () => {
  it('hold → held badge, gold, not greyed', () => {
    expect(centerStatusPresentation('hold')).toEqual({
      labelKey: 'rewardStatusHeldShort',
      tone: 'gold',
      greyed: false,
    });
  });

  it('withdrawable → available badge, success, not greyed', () => {
    expect(centerStatusPresentation('withdrawable')).toEqual({
      labelKey: 'rewardStatusAvailable',
      tone: 'success',
      greyed: false,
    });
  });

  it('paid → paid badge, success, not greyed', () => {
    expect(centerStatusPresentation('paid')).toEqual({
      labelKey: 'rewardStatusPaid',
      tone: 'success',
      greyed: false,
    });
  });

  it("forfeited → \"expired\", GREYED — the centre must see what it lost", () => {
    const p = centerStatusPresentation('forfeited');
    expect(p).toEqual({ labelKey: 'rewardStatusExpired', tone: 'neutral', greyed: true });
    // "expired" is the centre-facing wording; the row is de-emphasised, not hidden.
    expect(p.labelKey).toBe('rewardStatusExpired');
    expect(p.greyed).toBe(true);
  });

  it('forfeited is the ONLY greyed status', () => {
    const greyed = REFERRAL_COMMISSION_STATUSES.filter((s) => centerStatusPresentation(s).greyed);
    expect(greyed).toEqual(['forfeited']);
  });

  it('every live status has a real label — none falls through to the raw value', () => {
    for (const s of REFERRAL_COMMISSION_STATUSES) {
      expect(centerStatusPresentation(s).labelKey).not.toBe('');
    }
  });

  it('an unknown status yields an empty labelKey so the caller renders it verbatim', () => {
    for (const s of ['available', 'pending', 'held', '', null, undefined]) {
      expect(centerStatusPresentation(s).labelKey).toBe('');
    }
  });

  // The centre page resolves these keys DYNAMICALLY (t(presentation.labelKey)),
  // so scripts/check-i18n.ts cannot see them statically. This closes that gap:
  // a renamed or typo'd labelKey fails here instead of rendering a raw key to a
  // centre owner.
  it('every labelKey exists under `referrals` in BOTH ar and en', () => {
    for (const [locale, messages] of [
      ['en', enMessages],
      ['ar', arMessages],
    ] as const) {
      for (const status of REFERRAL_COMMISSION_STATUSES) {
        const { labelKey } = centerStatusPresentation(status);
        expect(
          messages.referrals[labelKey],
          `messages/${locale}.json is missing referrals.${labelKey} (status "${status}")`,
        ).toBeTruthy();
      }
      // The days-remaining variant the page substitutes for an open hold window.
      expect(messages.referrals.rewardStatusHeld).toBeTruthy();
    }
  });
});
