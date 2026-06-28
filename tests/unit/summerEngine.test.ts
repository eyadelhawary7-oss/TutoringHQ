import { describe, it, expect } from 'vitest';
import { decideSummerAction, type SummerCustomerState } from '@/lib/summer/engine';
import type { SummerScheduleConfig } from '@/lib/summer/dates';

const cfg: SummerScheduleConfig = {
  freeUntil: '2026-08-16',
  firstChargeFloor: '2026-08-30',
  trialDays: 14,
  payWindowDays: 2,
};

const ctx = (todayCairo: string, firstChargeReleased: boolean) => ({
  cfg,
  todayCairo,
  firstChargeReleased,
});

describe('decideSummerAction — enrollment (money-free, automatic)', () => {
  const fresh: SummerCustomerState = { summerStatus: 'none', signupDateCairo: '2026-07-10' };

  it('does nothing before SUMMER_FREE_UNTIL', () => {
    expect(decideSummerAction(fresh, ctx('2026-08-10', false)).kind).toBe('none');
  });

  it('enrolls on/after SUMMER_FREE_UNTIL regardless of the release flag', () => {
    const a = decideSummerAction(fresh, ctx('2026-08-16', false));
    expect(a.kind).toBe('enroll');
    if (a.kind === 'enroll') {
      expect(a.schedule.firstInvoiceAt).toBe('2026-08-30');
      expect(a.schedule.lockDay).toBe('2026-09-01');
    }
  });

  it('a late joiner after Aug 16 gets a trial from their own signup day', () => {
    const late: SummerCustomerState = { summerStatus: 'none', signupDateCairo: '2026-08-20' };
    const a = decideSummerAction(late, ctx('2026-08-20', true));
    expect(a.kind).toBe('enroll');
    if (a.kind === 'enroll') expect(a.schedule.firstInvoiceAt).toBe('2026-09-03');
  });
});

describe('decideSummerAction — first invoice (held vs released)', () => {
  const enrolled: SummerCustomerState = {
    summerStatus: 'enrolled',
    signupDateCairo: '2026-07-10',
    firstInvoiceAt: '2026-08-30',
    lockDay: '2026-09-01',
  };

  it('HELD → never issues, customer stays free even past the invoice date', () => {
    expect(decideSummerAction(enrolled, ctx('2026-08-30', false)).kind).toBe('none');
    expect(decideSummerAction(enrolled, ctx('2026-09-15', false)).kind).toBe('none');
  });

  it('RELEASED but before the invoice date → none', () => {
    expect(decideSummerAction(enrolled, ctx('2026-08-29', true)).kind).toBe('none');
  });

  it('RELEASED on/after the invoice date → issue_invoice', () => {
    expect(decideSummerAction(enrolled, ctx('2026-08-30', true)).kind).toBe('issue_invoice');
    expect(decideSummerAction(enrolled, ctx('2026-09-05', true)).kind).toBe('issue_invoice');
  });
});

describe('decideSummerAction — lock & roll-to-paid', () => {
  const invoiced: SummerCustomerState = {
    summerStatus: 'invoiced',
    signupDateCairo: '2026-07-10',
    firstInvoiceAt: '2026-08-30',
    lockDay: '2026-09-01',
    firstInvoicePaid: false,
  };

  it('within the pay window → none (full access)', () => {
    expect(decideSummerAction(invoiced, ctx('2026-08-30', true)).kind).toBe('none');
    expect(decideSummerAction(invoiced, ctx('2026-08-31', true)).kind).toBe('none');
  });

  it('on/after the lock day and still unpaid → lock', () => {
    expect(decideSummerAction(invoiced, ctx('2026-09-01', true)).kind).toBe('lock');
  });

  it('paid first invoice → mark_paid (rolls to normal subscription)', () => {
    const paid = { ...invoiced, firstInvoicePaid: true };
    expect(decideSummerAction(paid, ctx('2026-09-05', true)).kind).toBe('mark_paid');
    // mark_paid wins even after the lock day.
    expect(decideSummerAction(paid, ctx('2026-09-10', true)).kind).toBe('mark_paid');
  });

  it('HELD never locks anyone', () => {
    expect(decideSummerAction(invoiced, ctx('2026-09-10', false)).kind).toBe('none');
  });

  it('already paid status → none', () => {
    expect(decideSummerAction({ ...invoiced, summerStatus: 'paid' }, ctx('2026-09-10', true)).kind).toBe('none');
  });
});
