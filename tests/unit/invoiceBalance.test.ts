import { describe, it, expect } from 'vitest';
import {
  remainingBalance,
  isInvoiceSettled,
  applyPaymentToInvoice,
  readAppliedTxns,
  round2,
} from '@/lib/invoiceBalance';

describe('remainingBalance', () => {
  it('is total minus received', () => {
    expect(remainingBalance(999, 0)).toBe(999);
    expect(remainingBalance(999, 900)).toBe(99);
    expect(remainingBalance(1019, 1019)).toBe(0);
  });
  it('never goes negative (overpay clamps to 0)', () => {
    expect(remainingBalance(100, 150)).toBe(0);
  });
  it('rounds to two decimals', () => {
    expect(remainingBalance(100.5, 0.25)).toBe(100.25);
  });
});

describe('isInvoiceSettled', () => {
  it('false until received reaches total', () => {
    expect(isInvoiceSettled(999, 0)).toBe(false);
    expect(isInvoiceSettled(999, 900)).toBe(false);
    expect(isInvoiceSettled(999, 998.999)).toBe(true); // within epsilon
    expect(isInvoiceSettled(999, 999)).toBe(true);
    expect(isInvoiceSettled(999, 1000)).toBe(true);
  });
  it('a zero/invalid total is never settled by payment', () => {
    expect(isInvoiceSettled(0, 0)).toBe(false);
  });
});

describe('applyPaymentToInvoice — underpayment then top-up', () => {
  it('a partial payment leaves the invoice unsettled with the correct remaining', () => {
    const r = applyPaymentToInvoice({ total: 999, received: 0, amountPaid: 900, txnId: 't1' });
    expect(r.alreadyApplied).toBe(false);
    expect(r.newReceived).toBe(900);
    expect(r.remaining).toBe(99);
    expect(r.settled).toBe(false);
    expect(r.appliedTxns).toEqual(['t1']);
  });

  it('paying the remaining difference settles the invoice (one fee total, never lost)', () => {
    // Held credit of 900, now pay the 99 remainder.
    const r = applyPaymentToInvoice({
      total: 999,
      received: 900,
      appliedTxns: ['t1'],
      amountPaid: 99,
      txnId: 't2',
    });
    expect(r.newReceived).toBe(999);
    expect(r.remaining).toBe(0);
    expect(r.settled).toBe(true);
    expect(r.appliedTxns).toEqual(['t1', 't2']);
  });

  it('held credit is never lost across multiple partials', () => {
    let received = 0;
    const txns: string[] = [];
    for (const [amt, id] of [
      [300, 'a'],
      [300, 'b'],
      [419, 'c'],
    ] as Array<[number, string]>) {
      const r = applyPaymentToInvoice({ total: 1019, received, appliedTxns: txns, amountPaid: amt, txnId: id });
      received = r.newReceived;
      txns.splice(0, txns.length, ...r.appliedTxns);
    }
    expect(received).toBe(1019);
    expect(remainingBalance(1019, received)).toBe(0);
    expect(isInvoiceSettled(1019, received)).toBe(true);
  });

  it('is idempotent: a duplicate transaction id is never counted twice', () => {
    const first = applyPaymentToInvoice({ total: 999, received: 0, amountPaid: 900, txnId: 'dup' });
    expect(first.newReceived).toBe(900);
    const replay = applyPaymentToInvoice({
      total: 999,
      received: 900,
      appliedTxns: ['dup'],
      amountPaid: 900,
      txnId: 'dup',
    });
    expect(replay.alreadyApplied).toBe(true);
    expect(replay.newReceived).toBe(900); // unchanged — not 1800
    expect(replay.remaining).toBe(99);
    expect(replay.settled).toBe(false);
  });

  it('a single full payment settles immediately', () => {
    const r = applyPaymentToInvoice({ total: 1019, received: 0, amountPaid: 1019, txnId: 'full' });
    expect(r.settled).toBe(true);
    expect(r.remaining).toBe(0);
  });
});

describe('readAppliedTxns', () => {
  it('reads the array from metadata, tolerating junk', () => {
    expect(readAppliedTxns({ applied_txns: ['a', 'b'] })).toEqual(['a', 'b']);
    expect(readAppliedTxns({ applied_txns: 'x' })).toEqual([]);
    expect(readAppliedTxns(null)).toEqual([]);
    expect(readAppliedTxns({})).toEqual([]);
  });
});

describe('round2', () => {
  it('rounds and guards non-finite', () => {
    expect(round2(1.236)).toBe(1.24);
    expect(round2(1.234)).toBe(1.23);
    expect(round2(NaN)).toBe(0);
  });
});
