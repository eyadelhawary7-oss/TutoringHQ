import { describe, it, expect } from 'vitest';
import {
  decideLockoutActions,
  buildLockoutTickConfig,
  hhmmToMinutes,
  type LockoutCenterState,
  type LockoutTickConfig,
} from '@/lib/billingLockout';

const cfg: LockoutTickConfig = {
  retryTimesMins: [9 * 60, 14 * 60, 19 * 60], // 09:00, 14:00, 19:00
  reminderMins: 17 * 60, // 17:00
  lockMins: 23 * 60 + 59, // 23:59
  maxAttempts: 3,
};

function state(over: Partial<LockoutCenterState> = {}): LockoutCenterState {
  return {
    unpaid: true,
    attemptsMade: 0,
    hadSuccessfulRetry: false,
    ...over,
    done: { invoiceNudge: false, reminder2: false, lock: false, ...(over.done ?? {}) },
  };
}

const kinds = (as: { kind: string }[]) => as.map((a) => a.kind);

describe('decideLockoutActions — phase ordering across a Cairo day', () => {
  it('at 00:00 fires only the invoice + first nudge', () => {
    const a = decideLockoutActions({ nowMins: 0, config: cfg, state: state() });
    expect(kinds(a)).toEqual(['invoice_nudge']);
  });

  it('after the invoice+nudge has fired, 09:00 fires the first retry', () => {
    const a = decideLockoutActions({
      nowMins: 9 * 60,
      config: cfg,
      state: state({ done: { invoiceNudge: true, reminder2: false, lock: false } }),
    });
    expect(a).toEqual([{ kind: 'retry', attemptIndex: 0 }]);
  });

  it('fires at most ONE retry per tick, in order', () => {
    // 20:00, none fired yet, all three retry times are past — only the next (index 0) fires.
    const a = decideLockoutActions({
      nowMins: 20 * 60,
      config: cfg,
      state: state({ attemptsMade: 0, done: { invoiceNudge: true, reminder2: true, lock: false } }),
    });
    expect(a).toEqual([{ kind: 'retry', attemptIndex: 0 }]);
  });

  it('respects the attempt cap (no 4th retry): at 23:59 only the lock fires', () => {
    const a = decideLockoutActions({
      nowMins: 23 * 60 + 59,
      config: cfg,
      state: state({ attemptsMade: 3, done: { invoiceNudge: true, reminder2: true, lock: false } }),
    });
    expect(kinds(a)).toEqual(['lock']); // no retry #4, only the lock
  });
});

describe('second reminder gating', () => {
  it('fires at 17:00 when still unpaid and no retry succeeded', () => {
    const a = decideLockoutActions({
      nowMins: 17 * 60,
      config: cfg,
      state: state({ attemptsMade: 2, done: { invoiceNudge: true, reminder2: false, lock: false } }),
    });
    expect(kinds(a)).toContain('reminder2');
  });

  it('does NOT fire if a retry already succeeded', () => {
    const a = decideLockoutActions({
      nowMins: 17 * 60,
      config: cfg,
      state: state({ hadSuccessfulRetry: true, unpaid: false, done: { invoiceNudge: true, reminder2: false, lock: false } }),
    });
    expect(kinds(a)).not.toContain('reminder2');
  });

  it('does NOT fire twice (ledger guard)', () => {
    const a = decideLockoutActions({
      nowMins: 18 * 60,
      config: cfg,
      state: state({ attemptsMade: 3, done: { invoiceNudge: true, reminder2: true, lock: false } }),
    });
    expect(kinds(a)).not.toContain('reminder2');
  });
});

describe('paid centre stops everything after the invoice', () => {
  it('a paid centre gets no retries, reminder, or lock', () => {
    const a = decideLockoutActions({
      nowMins: 23 * 60 + 59,
      config: cfg,
      state: state({ unpaid: false, done: { invoiceNudge: true, reminder2: false, lock: false } }),
    });
    expect(a).toEqual([]);
  });
});

describe('lock at 23:59', () => {
  it('fires the lock once, only while unpaid', () => {
    const a = decideLockoutActions({
      nowMins: 23 * 60 + 59,
      config: cfg,
      state: state({ attemptsMade: 3, done: { invoiceNudge: true, reminder2: true, lock: false } }),
    });
    expect(kinds(a)).toEqual(['lock']);
  });

  it('does not fire the lock again once applied', () => {
    const a = decideLockoutActions({
      nowMins: 23 * 60 + 59,
      config: cfg,
      state: state({ attemptsMade: 3, done: { invoiceNudge: true, reminder2: true, lock: true } }),
    });
    expect(a).toEqual([]);
  });
});

describe('DST edges are ledger-driven, not clock-driven', () => {
  it('spring-forward: 00:00 never occurs, first real tick (01:00) still fires the invoice+nudge once', () => {
    const first = decideLockoutActions({
      nowMins: 60,
      config: cfg,
      state: state({ done: { invoiceNudge: false, reminder2: false, lock: false } }),
    });
    expect(kinds(first)).toContain('invoice_nudge');
    const second = decideLockoutActions({
      nowMins: 120,
      config: cfg,
      state: state({ done: { invoiceNudge: true, reminder2: false, lock: false } }),
    });
    expect(kinds(second)).not.toContain('invoice_nudge');
  });

  it('fall-back: the 23:xx hour repeats but the lock fires exactly once', () => {
    const firstPass = decideLockoutActions({
      nowMins: 23 * 60 + 59,
      config: cfg,
      state: state({ attemptsMade: 3, done: { invoiceNudge: true, reminder2: true, lock: false } }),
    });
    expect(kinds(firstPass)).toEqual(['lock']);
    const repeatHour = decideLockoutActions({
      nowMins: 23 * 60 + 59,
      config: cfg,
      state: state({ attemptsMade: 3, done: { invoiceNudge: true, reminder2: true, lock: true } }),
    });
    expect(repeatHour).toEqual([]);
  });
});

describe('buildLockoutTickConfig', () => {
  it('parses, filters, and sorts times; floors attempts', () => {
    const built = buildLockoutTickConfig({
      retryTimesCairo: ['19:00', '09:00', 'garbage', '14:00'],
      reminderTimeCairo: '17:30',
      maxAttempts: 3,
    });
    expect(built.retryTimesMins).toEqual([9 * 60, 14 * 60, 19 * 60]);
    expect(built.reminderMins).toBe(17 * 60 + 30);
    expect(built.lockMins).toBe(23 * 60 + 59); // default
    expect(built.maxAttempts).toBe(3);
  });

  it('hhmmToMinutes falls back on junk', () => {
    expect(hhmmToMinutes('08:15', -1)).toBe(8 * 60 + 15);
    expect(hhmmToMinutes('nope', 999)).toBe(999);
  });
});
