import { describe, it, expect } from 'vitest';
import {
  evaluateDueNudges,
  evaluateCardExpiry,
  selectBannerNudge,
  cairoYmdDiff,
  lastDayOfMonthYmd,
  cycleKeyFromBillingDay,
} from '@/lib/nudges/evaluate';
import type { OwnerNudgeState, OwnerType, SavedCardInfo } from '@/lib/nudges/types';

const TODAY = '2026-07-01';

function makeState(over: Partial<OwnerNudgeState> = {}): OwnerNudgeState {
  return {
    owner: { ownerType: 'center', ownerId: 'c1' },
    displayName: 'Test',
    billingDayCairo: '2026-07-04',
    cycleKey: '2026-07',
    paid: false,
    hasOpenInvoice: true,
    invoiceId: 'inv1',
    amountDue: 500,
    manualPayExpected: true,
    savedCard: null,
    ...over,
  };
}

function card(over: Partial<SavedCardInfo> = {}): SavedCardInfo {
  return { last4: '4242', expMonth: 12, expYear: 2027, status: 'active', ...over };
}

describe('cairoYmdDiff', () => {
  it('counts calendar days across month boundaries', () => {
    expect(cairoYmdDiff('2026-07-01', '2026-07-04')).toBe(3);
    expect(cairoYmdDiff('2026-07-01', '2026-06-29')).toBe(-2);
    expect(cairoYmdDiff('2026-07-31', '2026-08-01')).toBe(1);
  });
});

describe('lastDayOfMonthYmd', () => {
  it('returns the last calendar day', () => {
    expect(lastDayOfMonthYmd(2026, 7)).toBe('2026-07-31');
    expect(lastDayOfMonthYmd(2026, 2)).toBe('2026-02-28');
    expect(lastDayOfMonthYmd(2028, 2)).toBe('2028-02-29');
  });
});

describe('pre-billing reminders (manual-pay only)', () => {
  it('fires T-3 for a manual-pay owner with an open invoice', () => {
    const s = makeState({ billingDayCairo: '2026-07-04' });
    expect(evaluateDueNudges(s, TODAY)).toEqual(['prebill_t3']);
  });

  it('fires T-1 for a manual-pay owner', () => {
    const s = makeState({ billingDayCairo: '2026-07-02' });
    expect(evaluateDueNudges(s, TODAY)).toEqual(['prebill_t1']);
  });

  it('fires due_today on the billing day', () => {
    const s = makeState({ billingDayCairo: '2026-07-01' });
    expect(evaluateDueNudges(s, TODAY)).toEqual(['due_today']);
  });

  it('does NOT pre-nudge a healthy auto-charge owner (card will be charged)', () => {
    const s = makeState({ billingDayCairo: '2026-07-04', manualPayExpected: false });
    expect(evaluateDueNudges(s, TODAY)).toEqual([]);
  });

  it('does NOT pre-nudge T-2 (only exact T-3 / T-1 steps)', () => {
    const s = makeState({ billingDayCairo: '2026-07-03' });
    expect(evaluateDueNudges(s, TODAY)).toEqual([]);
  });

  it('does NOT pre-nudge when there is no open invoice yet', () => {
    const s = makeState({ billingDayCairo: '2026-07-04', hasOpenInvoice: false });
    expect(evaluateDueNudges(s, TODAY)).toEqual([]);
  });
});

describe('due_today applies to a failed auto-charge too', () => {
  it('fires for a card owner whose charge failed on the billing day', () => {
    // manualPayExpected false (had a card), but the charge failed → still owed today.
    const s = makeState({
      billingDayCairo: '2026-07-01',
      manualPayExpected: false,
      hasOpenInvoice: true,
    });
    expect(evaluateDueNudges(s, TODAY)).toEqual(['due_today']);
  });
});

describe('post-lock chase', () => {
  it('fires locked after the billing day while unpaid', () => {
    const s = makeState({ billingDayCairo: '2026-06-29' });
    expect(evaluateDueNudges(s, TODAY)).toEqual(['locked']);
  });

  it('fires locked for a teacher too', () => {
    const s = makeState({
      owner: { ownerType: 'teacher', ownerId: 't1' },
      billingDayCairo: '2026-06-29',
    });
    expect(evaluateDueNudges(s, TODAY)).toEqual(['locked']);
  });
});

describe('the sequence STOPS the instant the invoice is satisfied', () => {
  it('emits nothing once paid, at every phase', () => {
    for (const billingDay of ['2026-07-04', '2026-07-01', '2026-06-28']) {
      const s = makeState({ billingDayCairo: billingDay, paid: true });
      expect(evaluateDueNudges(s, TODAY)).toEqual([]);
    }
  });
});

describe('card-expiry warnings', () => {
  it('fires T-30 when the card expires before the next billing, ~30 days out', () => {
    // Card expires 2026-07-31 (30 days from TODAY); next billing later in August.
    const s = makeState({
      paid: true, // independent of pay cycle
      billingDayCairo: '2026-08-15',
      savedCard: card({ expMonth: 7, expYear: 2026 }),
    });
    expect(evaluateCardExpiry(s, TODAY)).toEqual(['card_expiry_t30']);
  });

  it('fires T-7 close to expiry', () => {
    const today = '2026-07-25';
    const s = makeState({
      paid: true,
      billingDayCairo: '2026-08-15',
      savedCard: card({ expMonth: 7, expYear: 2026 }), // expires 2026-07-31 → 6 days
    });
    expect(evaluateCardExpiry(s, today)).toEqual(['card_expiry_t7']);
  });

  it('does NOT warn when the card outlives the next billing date', () => {
    const s = makeState({
      billingDayCairo: '2026-07-10',
      savedCard: card({ expMonth: 12, expYear: 2026 }), // expires after next billing
    });
    expect(evaluateCardExpiry(s, TODAY)).toEqual([]);
  });

  it('does NOT warn for an inactive card', () => {
    const s = makeState({
      billingDayCairo: '2026-08-15',
      savedCard: card({ expMonth: 7, expYear: 2026, status: 'revoked' }),
    });
    expect(evaluateCardExpiry(s, TODAY)).toEqual([]);
  });
});

describe('selectBannerNudge (live, ledger-independent)', () => {
  it('prioritises locked over everything', () => {
    const s = makeState({ billingDayCairo: '2026-06-28' });
    expect(selectBannerNudge(s, TODAY, 'ar')?.kind).toBe('locked');
  });

  it('returns due_today on the billing day with the pay path', () => {
    const s = makeState({ billingDayCairo: '2026-07-01' });
    const b = selectBannerNudge(s, TODAY, 'ar');
    expect(b?.kind).toBe('due_today');
    expect(b?.ctaHref).toBe('/ar/pay');
  });

  it('shows the pre-bill banner across the whole T-3..T-1 window', () => {
    for (const billingDay of ['2026-07-04', '2026-07-03', '2026-07-02']) {
      const s = makeState({ billingDayCairo: billingDay });
      expect(selectBannerNudge(s, TODAY, 'ar')?.kind).toBe('prebill');
    }
  });

  it('points teachers at the teacher pay surface', () => {
    const s = makeState({
      owner: { ownerType: 'teacher', ownerId: 't1' },
      billingDayCairo: '2026-07-01',
    });
    expect(selectBannerNudge(s, TODAY, 'en')?.ctaHref).toBe('/en/teacher/pay');
  });

  it('returns null when nothing is active (paid, no card issue)', () => {
    const s = makeState({ billingDayCairo: '2026-07-20', paid: true });
    expect(selectBannerNudge(s, TODAY, 'ar')).toBeNull();
  });

  it('surfaces a card-expiry banner with formatted MM/YY', () => {
    const s = makeState({
      paid: true,
      billingDayCairo: '2026-08-15',
      savedCard: card({ expMonth: 7, expYear: 2026, last4: '1234' }),
    });
    const b = selectBannerNudge(s, TODAY, 'ar');
    expect(b?.kind).toBe('card_expiry');
    expect(b?.cardExpiry).toBe('07/26');
    expect(b?.cardLast4).toBe('1234');
  });
});

describe('cycleKeyFromBillingDay', () => {
  it('derives the YYYY-MM period key', () => {
    expect(cycleKeyFromBillingDay('2026-07-04')).toBe('2026-07');
    expect(cycleKeyFromBillingDay(null)).toBeNull();
  });
});

const ownerTypes: OwnerType[] = ['center', 'teacher'];
describe.each(ownerTypes)('parity for %s owners', (ownerType) => {
  it('runs the same T-3 → due → locked sequence', () => {
    const owner = { ownerType, ownerId: 'x' };
    expect(evaluateDueNudges(makeState({ owner, billingDayCairo: '2026-07-04' }), TODAY)).toEqual([
      'prebill_t3',
    ]);
    expect(evaluateDueNudges(makeState({ owner, billingDayCairo: '2026-07-01' }), TODAY)).toEqual([
      'due_today',
    ]);
    expect(evaluateDueNudges(makeState({ owner, billingDayCairo: '2026-06-29' }), TODAY)).toEqual([
      'locked',
    ]);
  });
});
