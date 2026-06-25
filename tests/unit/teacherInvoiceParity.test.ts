import { describe, it, expect, vi, beforeEach } from 'vitest';

// Isolate from WhatsApp + network side effects.
vi.mock('@/lib/centerNotify', () => ({
  sendChqPaymentConfirmedTemplate: vi.fn(async () => {}),
  sendChqPaymentFailedTemplate: vi.fn(async () => {}),
  sendPaymentConfirmed: vi.fn(async () => {}),
}));
vi.mock('@/lib/pricingConfig', () => ({
  getProcessingFeeConfig: vi.fn(async () => ({ enabled: true, amount: 20 })),
}));
const createPaymobCheckoutEgp = vi.fn(async () => ({
  paymobOrderId: 'po-teacher-1',
  iframeUrl: 'https://accept.paymob.com/iframe?token=x',
}));
vi.mock('@/lib/paymobCenterCheckout', () => ({
  createPaymobCheckoutEgp: (...args: unknown[]) => createPaymobCheckoutEgp(...(args as [])),
}));

import { ensureTeacherSubscriptionInvoice, advanceTeacherSubscriptionPaid } from '@/lib/teacherBilling';
import { finalizeInvoicePaymentSuccess } from '@/lib/invoicePaymobPayment';
import { createSupabaseMidnightBillingAdapter } from '@/lib/midnightBillingAdapter';
import {
  runMidnightBilling,
  type DueChargeable,
  type MidnightBillingAdapter,
} from '@/lib/midnightBilling';
import { cairoYmdPlusDays, startOfUtcInstantForCairoCalendarDay } from '@/lib/cairo/day';
import { applyFinalizeInvoiceRpc } from './billingFakeSupabase';
import type { ChargeSavedCardResult } from '@/lib/savedCard/autoCharge';

type Row = Record<string, unknown>;

/**
 * Richer in-memory Supabase fake supporting the chains the teacher billing code
 * uses: select/insert/update with eq/neq/in/is/gte/lt/order/limit and
 * maybeSingle/single (+ thenable for terminal writes/reads).
 */
function makeFakeSupabase(tables: Record<string, Row[]>) {
  let idc = 0;
  function builder(table: string) {
    const rows = () => (tables[table] ??= []);
    const filters: Array<(r: Row) => boolean> = [];
    let op: 'select' | 'insert' | 'update' = 'select';
    let payload: Row | null = null;
    let orderCol: string | null = null;
    let orderAsc = true;
    let limitN: number | null = null;

    const match = (r: Row) => filters.every((f) => f(r));
    function runSelect(): Row[] {
      let out = rows().filter(match);
      if (orderCol) {
        const col = orderCol;
        out = [...out].sort((a, b) => {
          const av = a[col] as never;
          const bv = b[col] as never;
          if (av === bv) return 0;
          return (av > bv ? 1 : -1) * (orderAsc ? 1 : -1);
        });
      }
      if (limitN != null) out = out.slice(0, limitN);
      return out;
    }
    function runWrite() {
      if (op === 'insert') {
        const row = { id: (payload as Row).id ?? `gen-${++idc}`, ...(payload as Row) };
        rows().push(row);
        return { data: row, error: null };
      }
      if (op === 'update') {
        for (const r of rows()) if (match(r)) Object.assign(r, payload);
        return { data: null, error: null };
      }
      return { data: runSelect(), error: null };
    }

    const api: Record<string, unknown> = {
      select() {
        if (op !== 'insert') op = 'select';
        return api;
      },
      insert(p: Row) {
        op = 'insert';
        payload = p;
        return api;
      },
      update(p: Row) {
        op = 'update';
        payload = p;
        return api;
      },
      eq(c: string, v: unknown) {
        filters.push((r) => r[c] === v);
        return api;
      },
      neq(c: string, v: unknown) {
        filters.push((r) => r[c] !== v);
        return api;
      },
      in(c: string, vs: unknown[]) {
        filters.push((r) => vs.includes(r[c]));
        return api;
      },
      is(c: string, v: unknown) {
        filters.push((r) => (r[c] ?? null) === v);
        return api;
      },
      gte(c: string, v: unknown) {
        filters.push((r) => (r[c] as never) >= (v as never));
        return api;
      },
      lt(c: string, v: unknown) {
        filters.push((r) => (r[c] as never) < (v as never));
        return api;
      },
      order(c: string, opts?: { ascending?: boolean }) {
        orderCol = c;
        orderAsc = opts?.ascending !== false;
        return api;
      },
      limit(n: number) {
        limitN = n;
        return api;
      },
      maybeSingle() {
        if (op === 'insert') return Promise.resolve(runWrite());
        const out = runSelect();
        return Promise.resolve({ data: out[0] ? { ...out[0] } : null, error: null });
      },
      single() {
        if (op === 'insert') return Promise.resolve(runWrite());
        const out = runSelect();
        return Promise.resolve({ data: out[0] ? { ...out[0] } : null, error: out[0] ? null : { message: 'no row' } });
      },
      then(resolve: (v: unknown) => unknown) {
        return Promise.resolve(runWrite()).then(resolve);
      },
    };
    return api;
  }
  return {
    from: (t: string) => builder(t),
    rpc: async (name: string, params: Record<string, unknown>) =>
      applyFinalizeInvoiceRpc(tables, name, params),
  } as never;
}

const TEACHER = 'teacher-1';
const TODAY = '2026-07-01';

function baseTables(): Record<string, Row[]> {
  return {
    invoices: [],
    teacher_subscriptions: [
      {
        id: 'ts-1',
        teacher_id: TEACHER,
        plan_key: 'teacher_standard',
        status: 'active',
        price_gross: 499,
        next_billing_at: startOfUtcInstantForCairoCalendarDay(TODAY).toISOString(),
        grace_until: null,
        dunning_attempts: 0,
      },
    ],
    saved_cards: [],
    users: [{ id: TEACHER, name: 'Ms Mona', phone: '201000000000' }],
    audit_log: [],
  };
}
const invoices = (t: Record<string, Row[]>) => t.invoices;
const sub = (t: Record<string, Row[]>) => t.teacher_subscriptions[0];

describe('ensureTeacherSubscriptionInvoice', () => {
  it('creates a teacher subscription invoice (price + flat fee, fee snapshotted)', async () => {
    const t = baseTables();
    const db = makeFakeSupabase(t);
    const res = await ensureTeacherSubscriptionInvoice(db, {
      teacherId: TEACHER,
      billingDayCairo: TODAY,
      priceGross: 499,
      fee: 20,
    });
    expect(res).not.toBeNull();
    expect(invoices(t)).toHaveLength(1);
    const inv = invoices(t)[0];
    expect(inv.owner_type).toBe('teacher');
    expect(inv.teacher_id).toBe(TEACHER);
    expect(inv.center_id).toBeNull();
    expect(inv.invoice_type).toBe('subscription');
    expect(inv.status).toBe('pending');
    expect(inv.total_amount).toBe(519); // 499 + 20
    expect(inv.base_amount).toBe(499);
    expect((inv.metadata as Row).processing_fee).toBe(20);
    expect(res!.total).toBe(519);
  });

  it('reuses the SAME open invoice on a dunning retry — one invoice, one fee', async () => {
    const t = baseTables();
    const db = makeFakeSupabase(t);
    const first = await ensureTeacherSubscriptionInvoice(db, { teacherId: TEACHER, billingDayCairo: TODAY, priceGross: 499, fee: 20 });
    // Retry on a later day: must NOT mint a second invoice.
    const retry = await ensureTeacherSubscriptionInvoice(db, {
      teacherId: TEACHER,
      billingDayCairo: cairoYmdPlusDays(TODAY, 3),
      priceGross: 499,
      fee: 20,
    });
    expect(invoices(t)).toHaveLength(1);
    expect(retry!.invoiceId).toBe(first!.invoiceId);
  });
});

describe('finalizeInvoicePaymentSuccess — teacher branch', () => {
  beforeEach(() => vi.clearAllMocks());

  function seedWithInvoice(over: Partial<Row> = {}) {
    const t = baseTables();
    t.invoices.push({
      id: 'tinv-1',
      owner_type: 'teacher',
      teacher_id: TEACHER,
      center_id: null,
      status: 'pending',
      invoice_type: 'subscription',
      total_amount: 519,
      amount_received: 0,
      metadata: { processing_fee: 20 },
      paymob_order_id: 'po-1',
      ...over,
    });
    // Simulate a lapsed/locked teacher about to pay.
    sub(t).status = 'past_due';
    sub(t).grace_until = '2026-07-02T22:00:00.000Z';
    return t;
  }

  it('a full payment marks the invoice paid AND restores the private engine (advance + grace cleared)', async () => {
    const t = seedWithInvoice();
    const db = makeFakeSupabase(t);
    const res = await finalizeInvoicePaymentSuccess(db, 'po-1', 'tx-1', { amountPaidEgp: 519 });
    expect(res).toEqual({ invoiceId: 'tinv-1', settled: true });
    expect(t.invoices[0].status).toBe('paid');
    // Subscription restored.
    expect(sub(t).status).toBe('active');
    expect(sub(t).grace_until).toBeNull();
    expect(sub(t).dunning_attempts).toBe(0);
    expect(String(sub(t).next_billing_at) > TODAY).toBe(true);
  });

  it('a partial payment holds credit, keeps the invoice unpaid, and leaves the teacher LOCKED', async () => {
    const t = seedWithInvoice();
    const db = makeFakeSupabase(t);
    const res = await finalizeInvoicePaymentSuccess(db, 'po-1', 'tx-1', { amountPaidEgp: 300 });
    expect(res).toEqual({ invoiceId: 'tinv-1', settled: false });
    expect(t.invoices[0].status).toBe('pending'); // still unpaid
    expect(t.invoices[0].amount_received).toBe(300); // held as credit
    // Still locked — grace_until untouched, status not restored.
    expect(sub(t).status).toBe('past_due');
    expect(sub(t).grace_until).toBe('2026-07-02T22:00:00.000Z');
  });

  it('paying the difference (no second fee) settles and unlocks', async () => {
    const t = seedWithInvoice({ amount_received: 300, metadata: { processing_fee: 20, applied_txns: ['tx-1'] } });
    const db = makeFakeSupabase(t);
    const res = await finalizeInvoicePaymentSuccess(db, 'po-1', 'tx-2', { amountPaidEgp: 219 });
    expect(res).toEqual({ invoiceId: 'tinv-1', settled: true });
    expect(t.invoices[0].status).toBe('paid');
    expect(t.invoices[0].amount_received).toBe(519); // exact total, fee never re-added
    expect(sub(t).status).toBe('active');
  });
});

describe('advanceTeacherSubscriptionPaid', () => {
  it('rolls the period +30 Cairo days and clears the lock', async () => {
    const t = baseTables();
    sub(t).status = 'past_due';
    sub(t).grace_until = 'x';
    sub(t).dunning_attempts = 2;
    const db = makeFakeSupabase(t);
    await advanceTeacherSubscriptionPaid(db, TEACHER, TODAY);
    expect(sub(t).status).toBe('active');
    expect(sub(t).grace_until).toBeNull();
    expect(sub(t).dunning_attempts).toBe(0);
    const expected = startOfUtcInstantForCairoCalendarDay(cairoYmdPlusDays(TODAY, 30)).toISOString();
    expect(sub(t).next_billing_at).toBe(expected);
  });
});

describe('midnight adapter — teacher invoice wiring', () => {
  beforeEach(() => vi.clearAllMocks());

  it('listDue CREATES the teacher invoice on the billing day and carries its id + total', async () => {
    const t = baseTables();
    const db = makeFakeSupabase(t);
    const adapter = createSupabaseMidnightBillingAdapter(db, new Date(`${TODAY}T10:00:00.000Z`));
    const due = await adapter.listDue(TODAY);
    const teacherItem = due.find((d) => d.customerType === 'teacher');
    expect(teacherItem).toBeTruthy();
    expect(teacherItem!.invoiceId).toBeTruthy();
    expect(teacherItem!.amount).toBe(519); // 499 + 20 fee
    expect(invoices(t)).toHaveLength(1);
    expect(invoices(t)[0].owner_type).toBe('teacher');
  });

  it('applyManualUnpaid (wallet/no-card teacher) → unpaid invoice + pay link + free-tier lock', async () => {
    const t = baseTables();
    const db = makeFakeSupabase(t);
    const adapter = createSupabaseMidnightBillingAdapter(db, new Date(`${TODAY}T10:00:00.000Z`));
    const due = await adapter.listDue(TODAY);
    const item = due.find((d) => d.customerType === 'teacher')!;
    await adapter.applyManualUnpaid(item, 'no_saved_card');
    // Pay link minted on the unpaid invoice.
    expect(createPaymobCheckoutEgp).toHaveBeenCalledTimes(1);
    expect(invoices(t)[0].paymob_order_id).toBe('po-teacher-1');
    expect(invoices(t)[0].status).toBe('pending'); // stays unpaid
    // Free-tier drop preserved: grace_until set (locks at next Cairo midnight).
    expect(sub(t).grace_until).toBeTruthy();
  });

  it('applyCharged (card teacher) finalizes the invoice and advances the subscription', async () => {
    const t = baseTables();
    const db = makeFakeSupabase(t);
    const adapter = createSupabaseMidnightBillingAdapter(db, new Date(`${TODAY}T10:00:00.000Z`));
    const due = await adapter.listDue(TODAY);
    const item = due.find((d) => d.customerType === 'teacher')!;
    await adapter.applyCharged(item, {
      ok: true,
      status: 'charged',
      intentId: 'i',
      transactionId: 'tx-99',
      paymobOrderId: 'po-mit-1',
    });
    expect(invoices(t)[0].status).toBe('paid');
    expect(sub(t).status).toBe('active');
    expect(sub(t).grace_until).toBeNull();
  });
});

// --- Engine-level routing parity (pure): teachers route exactly like centers ---

function teacherItem(over: Partial<DueChargeable> = {}): DueChargeable {
  return {
    key: 'teacher:ts-1',
    customerType: 'teacher',
    owner: { ownerType: 'teacher', ownerId: TEACHER },
    amount: 519,
    invoiceId: 'tinv-1',
    periodKey: '2026-07',
    billingDayCairo: TODAY,
    hasSavedCard: true,
    attemptIndex: 0,
    ...over,
  };
}

function makeRecordingAdapter(items: DueChargeable[]) {
  const rec = { charged: [] as string[], manualUnpaid: [] as Array<{ key: string; reason: string }>, retries: [] as string[], finalFailed: [] as string[] };
  const adapter: MidnightBillingAdapter = {
    todayCairo: () => TODAY,
    listDue: async () => items,
    applyCharged: async (i) => { rec.charged.push(i.key); },
    applyAlreadyCharged: async () => {},
    applyManualUnpaid: async (i, reason) => { rec.manualUnpaid.push({ key: i.key, reason }); },
    applyRetryScheduled: async (i) => { rec.retries.push(i.key); },
    applyFinalFailed: async (i) => { rec.finalFailed.push(i.key); },
    applyReconcile: async () => {},
  };
  return { adapter, rec };
}

const CHARGED: ChargeSavedCardResult = { ok: true, status: 'charged', intentId: 'i', transactionId: 't', paymobOrderId: 'o' };

describe('runMidnightBilling — teacher routing parity', () => {
  it('card teacher → charged; wallet teacher → manual_unpaid (unpaid + pay link)', async () => {
    const card = teacherItem({ key: 'card', hasSavedCard: true });
    const wallet = teacherItem({ key: 'wallet', hasSavedCard: false });
    const { adapter, rec } = makeRecordingAdapter([card, wallet]);
    await runMidnightBilling(adapter, { addDays: cairoYmdPlusDays, charge: async () => CHARGED });
    expect(rec.charged).toEqual(['card']);
    expect(rec.manualUnpaid).toEqual([{ key: 'wallet', reason: 'no_saved_card' }]);
  });

  it('bank-decline fallback applies to teachers: a hard MIT decline → manual_unpaid, NO retry', async () => {
    const card = teacherItem({ key: 'card' });
    const { adapter, rec } = makeRecordingAdapter([card]);
    await runMidnightBilling(adapter, {
      addDays: cairoYmdPlusDays,
      charge: async () => ({ ok: false, status: 'declined', intentId: 'i', errorMessage: 'Expired card', declineCode: '54' }),
    });
    expect(rec.manualUnpaid).toEqual([{ key: 'card', reason: 'hard_final' }]);
    expect(rec.retries).toEqual([]);
  });

  it('a soft decline schedules a retry for a teacher', async () => {
    const card = teacherItem({ key: 'card', attemptIndex: 0 });
    const { adapter, rec } = makeRecordingAdapter([card]);
    await runMidnightBilling(adapter, {
      addDays: cairoYmdPlusDays,
      charge: async () => ({ ok: false, status: 'declined', intentId: 'i', errorMessage: 'Insufficient funds', declineCode: '51' }),
    });
    expect(rec.retries).toEqual(['card']);
  });
});
