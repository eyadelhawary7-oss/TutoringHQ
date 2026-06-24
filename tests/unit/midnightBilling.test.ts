import { describe, it, expect } from 'vitest';
import {
  decideAfterCharge,
  runMidnightBilling,
  RETRY_GAP_DAYS,
  type DueChargeable,
  type MidnightBillingAdapter,
} from '@/lib/midnightBilling';
import { cairoYmdPlusDays } from '@/lib/cairo/day';
import type { ChargeSavedCardResult } from '@/lib/savedCard/autoCharge';

const TODAY = '2026-07-01';
const addDays = cairoYmdPlusDays;

function centerItem(over: Partial<DueChargeable> = {}): DueChargeable {
  return {
    key: 'inv-1',
    customerType: 'center',
    owner: { ownerType: 'center', ownerId: 'center-1' },
    amount: 300,
    invoiceId: 'inv-1',
    periodKey: '2026-07',
    billingDayCairo: TODAY,
    hasSavedCard: true,
    attemptIndex: 0,
    ...over,
  };
}

const CHARGED: ChargeSavedCardResult = { ok: true, status: 'charged', intentId: 'i', transactionId: 't', paymobOrderId: 'o' };
const ALREADY: ChargeSavedCardResult = { ok: true, status: 'already_charged', intentId: 'i', transactionId: 't', paymobOrderId: 'o' };
const softDecline = (): ChargeSavedCardResult => ({ ok: false, status: 'declined', intentId: 'i', errorMessage: 'Insufficient funds', declineCode: '51' });
const authDecline = (): ChargeSavedCardResult => ({ ok: false, status: 'declined', intentId: 'i', errorMessage: '3DS required', declineCode: '3DS' });
const hardDecline = (): ChargeSavedCardResult => ({ ok: false, status: 'declined', intentId: 'i', errorMessage: 'Expired card', declineCode: '54' });

describe('decideAfterCharge — routing', () => {
  const base = { billingDayCairo: TODAY, addDays };

  it('charged / already_charged', () => {
    expect(decideAfterCharge({ result: CHARGED, attemptIndex: 0, ...base }).kind).toBe('charged');
    expect(decideAfterCharge({ result: ALREADY, attemptIndex: 0, ...base }).kind).toBe('already_charged');
  });

  it('no saved card / recurring not configured → manual_unpaid (inert path included)', () => {
    expect(decideAfterCharge({ result: { ok: false, status: 'no_saved_card' }, attemptIndex: 0, ...base }))
      .toEqual({ kind: 'manual_unpaid', reason: 'no_saved_card' });
    expect(decideAfterCharge({ result: { ok: false, status: 'recurring_integration_not_configured', intentId: 'i' }, attemptIndex: 0, ...base }))
      .toEqual({ kind: 'manual_unpaid', reason: 'recurring_not_configured' });
  });

  it('HARD bank/MIT declines route to manual fallback and NEVER retry', () => {
    expect(decideAfterCharge({ result: authDecline(), attemptIndex: 0, ...base }))
      .toEqual({ kind: 'manual_unpaid', reason: 'auth_required' });
    expect(decideAfterCharge({ result: hardDecline(), attemptIndex: 0, ...base }))
      .toEqual({ kind: 'manual_unpaid', reason: 'hard_final' });
  });

  it('SOFT declines follow the retry schedule (day 0 → +3 → +7), then give up', () => {
    expect(decideAfterCharge({ result: softDecline(), attemptIndex: 0, ...base }))
      .toEqual({ kind: 'retry_scheduled', nextRetryYmd: addDays(TODAY, RETRY_GAP_DAYS[0]), attempt: 1 });
    expect(decideAfterCharge({ result: softDecline(), attemptIndex: 1, ...base }))
      .toEqual({ kind: 'retry_scheduled', nextRetryYmd: addDays(TODAY, RETRY_GAP_DAYS[1]), attempt: 2 });
    // 3rd attempt exhausts the schedule.
    expect(decideAfterCharge({ result: softDecline(), attemptIndex: 2, ...base }).kind).toBe('final_failed');
  });

  it('ambiguous outcomes reconcile rather than re-charge', () => {
    expect(decideAfterCharge({ result: { ok: false, status: 'needs_reconciliation', intentId: 'i' }, attemptIndex: 0, ...base }).kind).toBe('reconcile');
  });
});

// --- Cron-level orchestration with a recording in-memory adapter ---

interface Recorded {
  charged: string[];
  alreadyCharged: string[];
  manualUnpaid: Array<{ key: string; reason: string }>;
  retries: Array<{ key: string; nextRetryYmd: string; attempt: number }>;
  finalFailed: string[];
  reconcile: string[];
}

function makeAdapter(items: DueChargeable[]): { adapter: MidnightBillingAdapter; rec: Recorded } {
  const rec: Recorded = { charged: [], alreadyCharged: [], manualUnpaid: [], retries: [], finalFailed: [], reconcile: [] };
  const adapter: MidnightBillingAdapter = {
    todayCairo: () => TODAY,
    listDue: async () => items,
    applyCharged: async (i) => { rec.charged.push(i.key); },
    applyAlreadyCharged: async (i) => { rec.alreadyCharged.push(i.key); },
    applyManualUnpaid: async (i, reason) => { rec.manualUnpaid.push({ key: i.key, reason }); },
    applyRetryScheduled: async (i, nextRetryYmd, attempt) => { rec.retries.push({ key: i.key, nextRetryYmd, attempt }); },
    applyFinalFailed: async (i) => { rec.finalFailed.push(i.key); },
    applyReconcile: async (i) => { rec.reconcile.push(i.key); },
  };
  return { adapter, rec };
}

describe('runMidnightBilling — cron-level behavior', () => {
  it('charges a due card customer and creates an unpaid invoice for a due wallet customer', async () => {
    const card = centerItem({ key: 'card', invoiceId: 'card', hasSavedCard: true });
    const wallet = centerItem({ key: 'wallet', invoiceId: 'wallet', hasSavedCard: false });
    const { adapter, rec } = makeAdapter([card, wallet]);
    const chargeCalls: string[] = [];

    const summary = await runMidnightBilling(adapter, {
      addDays,
      charge: async (input) => { chargeCalls.push(String(input.invoiceId)); return CHARGED; },
    });

    expect(rec.charged).toEqual(['card']);
    expect(rec.manualUnpaid).toEqual([{ key: 'wallet', reason: 'no_saved_card' }]);
    expect(chargeCalls).toEqual(['card']); // wallet customer is never charged
    expect(summary).toMatchObject({ charged: 1, manualUnpaid: 1 });
  });

  it('re-running the cron does not double-charge (idempotent already_charged)', async () => {
    const card = centerItem({ key: 'card', invoiceId: 'card' });
    const { adapter, rec } = makeAdapter([card]);
    let calls = 0;
    await runMidnightBilling(adapter, {
      addDays,
      charge: async () => { calls += 1; return ALREADY; }, // Phase 1 replays the cached success
    });
    expect(calls).toBe(1);
    expect(rec.charged).toEqual([]);
    expect(rec.alreadyCharged).toEqual(['card']);
  });

  it('a HARD MIT decline routes to the unpaid/fallback surface and does NOT retry', async () => {
    const card = centerItem({ key: 'card', invoiceId: 'card' });
    const { adapter, rec } = makeAdapter([card]);
    await runMidnightBilling(adapter, { addDays, charge: async () => authDecline() });
    expect(rec.manualUnpaid).toEqual([{ key: 'card', reason: 'auth_required' }]);
    expect(rec.retries).toEqual([]);
  });

  it('a SOFT decline schedules a retry; the exhausted schedule locks (final_failed)', async () => {
    const first = centerItem({ key: 'first', invoiceId: 'first', attemptIndex: 0 });
    const last = centerItem({ key: 'last', invoiceId: 'last', attemptIndex: 2 });
    const { adapter, rec } = makeAdapter([first, last]);
    await runMidnightBilling(adapter, { addDays, charge: async () => softDecline() });
    expect(rec.retries).toEqual([{ key: 'first', nextRetryYmd: addDays(TODAY, RETRY_GAP_DAYS[0]), attempt: 1 }]);
    expect(rec.finalFailed).toEqual(['last']);
  });

  it('stays inert (manual surface) when the recurring integration id is not configured', async () => {
    const card = centerItem({ key: 'card', invoiceId: 'card' });
    const { adapter, rec } = makeAdapter([card]);
    await runMidnightBilling(adapter, {
      addDays,
      charge: async () => ({ ok: false, status: 'recurring_integration_not_configured', intentId: 'i' }),
    });
    expect(rec.manualUnpaid).toEqual([{ key: 'card', reason: 'recurring_not_configured' }]);
    expect(rec.charged).toEqual([]);
  });
});
