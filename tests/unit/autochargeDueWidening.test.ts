import { describe, it, expect } from 'vitest';
import { createSupabaseMidnightBillingAdapter } from '@/lib/midnightBillingAdapter';
import { cairoDateKey, cairoYmdPlusDays } from '@/lib/cairo/day';
import { makeFakeSupabase, type Row } from './billingFakeSupabase';

/**
 * W3 / Gap 3 — the center "initial subscription charges due" query is `.lte`
 * (not `.eq`) on due_date, so a straggler invoice issued by summer-billing on a
 * prior Cairo day (due_date=D) is still collected on the next autocharge run
 * (D+1). The widening must NOT resurrect a paid invoice (status filter), and the
 * downstream charge path stays idempotent (applyCharged guards `.neq('paid')`
 * and finalize no-ops if already paid) so a paid invoice is never double-charged.
 */
const NOW = new Date('2026-07-12T12:00:00Z');
const TODAY = cairoDateKey(NOW);
const YESTERDAY = cairoYmdPlusDays(TODAY, -1);
const TOMORROW = cairoYmdPlusDays(TODAY, 1);

function centerSubInvoice(over: Partial<Row>): Row {
  return {
    owner_type: 'center',
    invoice_type: 'subscription',
    total_amount: 100,
    billing_period_start: YESTERDAY,
    retry_count: 0,
    ...over,
  };
}

describe('listDue — widened center due filter picks up stragglers (Gap 3)', () => {
  it('returns a pending subscription invoice with due_date < today, and excludes paid + future', async () => {
    const tables: Record<string, Row[]> = {
      invoices: [
        centerSubInvoice({ id: 'inv-straggler', center_id: 'c1', status: 'pending', due_date: YESTERDAY }),
        centerSubInvoice({ id: 'inv-paid', center_id: 'c2', status: 'paid', due_date: YESTERDAY }),
        centerSubInvoice({ id: 'inv-future', center_id: 'c3', status: 'pending', due_date: TOMORROW }),
        centerSubInvoice({ id: 'inv-today', center_id: 'c4', status: 'overdue', due_date: TODAY }),
      ],
      teacher_subscriptions: [],
      saved_cards: [],
    };
    const adapter = createSupabaseMidnightBillingAdapter(makeFakeSupabase(tables), NOW);
    const due = await adapter.listDue(TODAY);
    const ids = due.map((d) => d.invoiceId);

    // The straggler (due_date < today) and today's invoice are both collected.
    expect(ids).toContain('inv-straggler');
    expect(ids).toContain('inv-today');
    // A paid invoice is never returned (status filter) → can't be double-charged.
    expect(ids).not.toContain('inv-paid');
    // A future-dated invoice is not pulled forward (`.lte`, not `>=`).
    expect(ids).not.toContain('inv-future');
  });
});

describe('applyCharged — idempotency guard holds for an already-paid invoice (Gap 3)', () => {
  it('does not overwrite a paid invoice and applies no renewal side-effects', async () => {
    const tables: Record<string, Row[]> = {
      invoices: [
        {
          id: 'inv-paid',
          owner_type: 'center',
          invoice_type: 'subscription',
          center_id: 'c9',
          status: 'paid',
          total_amount: 100,
          paymob_order_id: 'ord_paid',
          paymob_transaction_id: 'txn_orig',
        },
      ],
      centers: [{ id: 'c9', billing_status: 'paid' }],
    };
    const adapter = createSupabaseMidnightBillingAdapter(makeFakeSupabase(tables), NOW);

    await adapter.applyCharged(
      {
        key: 'inv-paid',
        customerType: 'center',
        owner: { ownerType: 'center', ownerId: 'c9' },
        amount: 100,
        invoiceId: 'inv-paid',
        periodKey: TODAY.slice(0, 7),
        billingDayCairo: TODAY,
        hasSavedCard: true,
        attemptIndex: 0,
      },
      { ok: true, status: 'charged', intentId: 'i1', transactionId: 'txn_new', paymobOrderId: 'ord_paid' },
    );

    const inv = tables.invoices[0];
    // The `.neq('status','paid')` guard blocks the update; finalize no-ops on a
    // paid invoice — the original transaction id survives and no renewal is added.
    expect(inv.status).toBe('paid');
    expect(inv.paymob_transaction_id).toBe('txn_orig');
    expect(tables.renewal_history ?? []).toHaveLength(0);
  });
});
