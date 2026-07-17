import { describe, it, expect, vi, beforeEach } from 'vitest';

// The double-send fix: a one-shot WhatsApp nudge must only go out when THIS tick
// created the ledger row. If the unique-index insert conflicts (a concurrent tick or
// the repeated fall-back Cairo hour already recorded it), recordEvent returns false
// and no second message is sent.
const sendTemplateMessage = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
vi.mock('@/lib/whatsapp/client', () => ({
  sendTemplateMessage: (...args: unknown[]) => sendTemplateMessage(...args),
}));
vi.mock('@/lib/savedCard/store', () => ({ createSupabaseSavedCardStore: () => ({}) }));
vi.mock('@/lib/savedCard/paymobRecurring', () => ({ paymobRecurringClient: {} }));
vi.mock('@/lib/savedCard/autoCharge', () => ({
  chargeSavedCard: async () => ({ ok: false, status: 'skipped' }),
}));
vi.mock('@/lib/supabase-admin', () => ({ getSupabaseAdmin: () => ({}) }));

import { createSupabaseLockoutAdapter } from '@/lib/billingLockoutAdapter';

function fakeAdmin(insertError: unknown) {
  return {
    from: (table: string) => {
      if (table === 'billing_lockout_events') {
        return { insert: async () => ({ error: insertError }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

const center = {
  centerId: 'c1',
  billingDayCairo: '2026-08-30',
  state: {
    unpaid: true,
    attemptsMade: 0,
    hadSuccessfulRetry: false,
    done: { invoiceNudge: false, reminder2: false, lock: false },
  },
  ownerPhone: '+201000000000',
  periodKey: '2026-08',
};

describe('lockout adapter: WhatsApp send is gated on a newly recorded ledger row', () => {
  beforeEach(() => sendTemplateMessage.mockClear());

  it('sends the nudge when the ledger row is newly created', async () => {
    const adapter = createSupabaseLockoutAdapter(fakeAdmin(null) as never);
    await adapter.applyInvoiceNudge(center as never);
    expect(sendTemplateMessage).toHaveBeenCalledTimes(1);
  });

  it('does NOT send when the insert conflicts (23505: another tick already recorded it)', async () => {
    const adapter = createSupabaseLockoutAdapter(fakeAdmin({ code: '23505' }) as never);
    await adapter.applyInvoiceNudge(center as never);
    expect(sendTemplateMessage).not.toHaveBeenCalled();
  });

  it('does NOT send the lock nudge on any other insert error (no double-send on a transient failure)', async () => {
    const adapter = createSupabaseLockoutAdapter(fakeAdmin({ code: '08006', message: 'conn reset' }) as never);
    await adapter.applyLock(center as never);
    expect(sendTemplateMessage).not.toHaveBeenCalled();
  });
});
