import { describe, it, expect, vi } from 'vitest';

// The Supabase adapter pulls in server-only Paymob helpers at import time.
vi.mock('server-only', () => ({}));
vi.mock('@/lib/centerNotify', () => ({
  sendChqPaymentConfirmedTemplate: vi.fn(async () => {}),
  sendChqPaymentFailedTemplate: vi.fn(async () => {}),
  sendPaymentConfirmed: vi.fn(async () => {}),
}));

import { makeFakeSupabase, type Row } from './billingFakeSupabase';
import { runMidnightBilling, type DueChargeable, type MidnightBillingAdapter } from '@/lib/midnightBilling';
import { createSupabaseMidnightBillingAdapter } from '@/lib/midnightBillingAdapter';
import type { ChargeSavedCardResult } from '@/lib/savedCard/autoCharge';

function dueItem(over: Partial<DueChargeable> = {}): DueChargeable {
  return {
    key: 'inv-1',
    customerType: 'center',
    owner: { ownerType: 'center', ownerId: 'c-1' },
    amount: 1000,
    invoiceId: 'inv-1',
    periodKey: '2026-06',
    billingDayCairo: '2026-06-24',
    hasSavedCard: true,
    attemptIndex: 0,
    ...over,
  };
}

const declined: ChargeSavedCardResult = {
  ok: false,
  status: 'declined',
  intentId: 'intent-1',
  errorMessage: 'insufficient funds',
  declineCode: '51', // soft_retryable
};

describe('midnight billing — decline recording wiring', () => {
  it('orchestrator calls recordDecline for a declined charge before routing the outcome', async () => {
    const recorded: Array<{ item: DueChargeable; result: ChargeSavedCardResult }> = [];
    const noop = async () => {};
    const adapter: MidnightBillingAdapter = {
      todayCairo: () => '2026-06-24',
      listDue: async () => [dueItem()],
      applyCharged: noop,
      applyAlreadyCharged: noop,
      applyManualUnpaid: noop,
      applyRetryScheduled: noop,
      applyFinalFailed: noop,
      applyReconcile: noop,
      recordDecline: async (item, result) => {
        recorded.push({ item, result });
      },
    };

    await runMidnightBilling(adapter, { charge: async () => declined, addDays: (d) => d });

    expect(recorded).toHaveLength(1);
    expect(recorded[0].result).toMatchObject({ status: 'declined', declineCode: '51' });
  });

  it('does NOT record a decline for a successful charge', async () => {
    let calls = 0;
    const noop = async () => {};
    const adapter: MidnightBillingAdapter = {
      todayCairo: () => '2026-06-24',
      listDue: async () => [dueItem()],
      applyCharged: noop,
      applyAlreadyCharged: noop,
      applyManualUnpaid: noop,
      applyRetryScheduled: noop,
      applyFinalFailed: noop,
      applyReconcile: noop,
      recordDecline: async () => {
        calls += 1;
      },
    };
    const ok: ChargeSavedCardResult = { ok: true, status: 'charged', intentId: 'i', transactionId: 't', paymobOrderId: 'o' };
    await runMidnightBilling(adapter, { charge: async () => ok, addDays: (d) => d });
    expect(calls).toBe(0);
  });
});

describe('Supabase adapter recordDecline — append-only decline/issuer row', () => {
  it('writes a recurring_charge_declines row with classification + card metadata', async () => {
    const tables: Record<string, Row[]> = {
      saved_cards: [{ owner_type: 'center', owner_id: 'c-1', status: 'active', card_brand: 'Visa', card_last4: '4242' }],
      recurring_charge_declines: [],
    };
    const db = makeFakeSupabase(tables);
    const adapter = createSupabaseMidnightBillingAdapter(db, new Date('2026-06-24T00:00:00Z'));

    await adapter.recordDecline!(dueItem({ attemptIndex: 1 }), declined);

    expect(tables.recurring_charge_declines).toHaveLength(1);
    const row = tables.recurring_charge_declines[0];
    expect(row).toMatchObject({
      owner_type: 'center',
      owner_id: 'c-1',
      invoice_id: 'inv-1',
      billing_period: '2026-06',
      attempt_index: 1,
      decline_code: '51',
      decline_classification: 'soft_retryable',
      error_message: 'insufficient funds',
      card_brand: 'Visa',
      card_last4: '4242',
      issuer_bank: null,
    });
  });

  it('records a teacher decline too (owner-agnostic)', async () => {
    const tables: Record<string, Row[]> = {
      saved_cards: [],
      recurring_charge_declines: [],
    };
    const db = makeFakeSupabase(tables);
    const adapter = createSupabaseMidnightBillingAdapter(db, new Date('2026-06-24T00:00:00Z'));

    const teacherItem = dueItem({
      customerType: 'teacher',
      owner: { ownerType: 'teacher', ownerId: 't-9' },
      invoiceId: 'tinv-9',
    });
    await adapter.recordDecline!(teacherItem, { ...declined, declineCode: '54' /* hard_final */ });

    expect(tables.recurring_charge_declines[0]).toMatchObject({
      owner_type: 'teacher',
      owner_id: 't-9',
      decline_code: '54',
      decline_classification: 'hard_final',
    });
  });
});
