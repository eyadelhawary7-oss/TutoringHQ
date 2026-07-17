import { describe, it, expect } from 'vitest';
import {
  recurringAutochargeConfigured,
  evaluateLockoutPolicy,
  parseKillSwitchEnabled,
  parseHhMm,
  parseRetryTimes,
  parseLockoutConfigRows,
  isCenterLockedForEnforcement,
  LOCKOUT_ENABLED_KEY,
  LOCKOUT_RETRY_TIMES_KEY,
  LOCKOUT_REMINDER_TIME_KEY,
  DUNNING_MAX_ATTEMPTS_KEY,
  LOCKOUT_DEFAULTS,
  type LockoutPolicyInput,
} from '@/lib/billingLockoutPolicy';

const base: LockoutPolicyInput = {
  firstChargeRelease: 'RELEASED',
  killSwitchEnabled: true,
  autochargeConfigured: true,
  retryTimesCairo: ['09:00'],
  reminderTimeCairo: '17:00',
  maxAttempts: 3,
};

describe('recurringAutochargeConfigured — the interlock', () => {
  it('is OFF for unset / empty / whitespace', () => {
    expect(recurringAutochargeConfigured(undefined)).toBe(false);
    expect(recurringAutochargeConfigured('')).toBe(false);
    expect(recurringAutochargeConfigured('   ')).toBe(false);
  });

  it('is OFF for the literal placeholder (the live production value), any case', () => {
    expect(recurringAutochargeConfigured('placeholder')).toBe(false);
    expect(recurringAutochargeConfigured('PLACEHOLDER')).toBe(false);
    expect(recurringAutochargeConfigured('  Placeholder ')).toBe(false);
  });

  it('is ON only for a real credential', () => {
    expect(recurringAutochargeConfigured('4012345')).toBe(true);
    expect(recurringAutochargeConfigured('rec_live_abc')).toBe(true);
  });
});

describe('evaluateLockoutPolicy — three guards, all must hold', () => {
  it('is active only when released, kill switch on, and autocharge configured', () => {
    expect(evaluateLockoutPolicy(base).active).toBe(true);
    expect(evaluateLockoutPolicy(base).reason).toBeNull();
  });

  it('HELD blocks and is NOT Sentry-worthy', () => {
    const s = evaluateLockoutPolicy({ ...base, firstChargeRelease: 'HELD' });
    expect(s.active).toBe(false);
    expect(s.reason).toBe('first_charge_held');
  });

  it('kill switch off blocks and is NOT Sentry-worthy', () => {
    const s = evaluateLockoutPolicy({ ...base, killSwitchEnabled: false });
    expect(s.active).toBe(false);
    expect(s.reason).toBe('kill_switch_off');
  });

  it('interlock is the ONLY Sentry-worthy reason, and only when it is the sole blocker', () => {
    const s = evaluateLockoutPolicy({ ...base, autochargeConfigured: false });
    expect(s.active).toBe(false);
    expect(s.reason).toBe('autocharge_not_configured');
  });

  it('HELD takes precedence over the interlock so a held+placeholder state is quiet', () => {
    const s = evaluateLockoutPolicy({
      ...base,
      firstChargeRelease: 'HELD',
      autochargeConfigured: false,
    });
    expect(s.reason).toBe('first_charge_held');
  });
});

describe('config parsing', () => {
  it('kill switch only false / "false" disables', () => {
    expect(parseKillSwitchEnabled(undefined)).toBe(true);
    expect(parseKillSwitchEnabled(true)).toBe(true);
    expect(parseKillSwitchEnabled('true')).toBe(true);
    expect(parseKillSwitchEnabled(false)).toBe(false);
    expect(parseKillSwitchEnabled('false')).toBe(false);
    expect(parseKillSwitchEnabled('FALSE')).toBe(false);
  });

  it('parseHhMm accepts valid 24h times and rejects junk', () => {
    expect(parseHhMm('09:05')).toEqual({ hour: 9, minute: 5 });
    expect(parseHhMm('23:59')).toEqual({ hour: 23, minute: 59 });
    expect(parseHhMm('24:00')).toBeNull();
    expect(parseHhMm('9:5')).toBeNull();
    expect(parseHhMm('nope')).toBeNull();
  });

  it('parseRetryTimes handles arrays, comma strings, JSON strings, sorts and de-dups', () => {
    expect(parseRetryTimes(['19:00', '09:00', '09:00'], ['00:00'])).toEqual(['09:00', '19:00']);
    expect(parseRetryTimes('14:00, 08:00', ['00:00'])).toEqual(['08:00', '14:00']);
    expect(parseRetryTimes('["20:00","10:00"]', ['00:00'])).toEqual(['10:00', '20:00']);
    expect(parseRetryTimes('garbage', ['09:00'])).toEqual(['09:00']);
    expect(parseRetryTimes(undefined, ['09:00'])).toEqual(['09:00']);
  });

  it('parseLockoutConfigRows applies per-key defaults and caps attempts', () => {
    const parsed = parseLockoutConfigRows({
      [LOCKOUT_ENABLED_KEY]: false,
      [LOCKOUT_RETRY_TIMES_KEY]: ['08:00', '20:00'],
      [LOCKOUT_REMINDER_TIME_KEY]: '18:30',
      [DUNNING_MAX_ATTEMPTS_KEY]: 3,
    });
    expect(parsed.killSwitchEnabled).toBe(false);
    expect(parsed.retryTimesCairo).toEqual(['08:00', '20:00']);
    expect(parsed.reminderTimeCairo).toBe('18:30');
    expect(parsed.maxAttempts).toBe(3);

    const defaults = parseLockoutConfigRows({});
    expect(defaults.killSwitchEnabled).toBe(LOCKOUT_DEFAULTS.killSwitchEnabled);
    expect(defaults.retryTimesCairo).toEqual([...LOCKOUT_DEFAULTS.retryTimesCairo]);
    expect(defaults.reminderTimeCairo).toBe(LOCKOUT_DEFAULTS.reminderTimeCairo);
    expect(defaults.maxAttempts).toBe(LOCKOUT_DEFAULTS.maxAttempts);
  });
});

describe('isCenterLockedForEnforcement — policy gates the single-day rule', () => {
  // A center that the single-day rule WOULD lock: unpaid, billing day in the past.
  const lockedRow = { billing_status: 'unpaid', next_payment_due: '2026-06-15' };
  const now = new Date('2026-06-20T10:00:00Z'); // Cairo 2026-06-20, well past the billing day

  it('never locks when the policy is inactive (interlock/HELD/kill switch)', () => {
    expect(isCenterLockedForEnforcement(lockedRow, false, now)).toBe(false);
  });

  it('delegates to the single-day rule when the policy is active', () => {
    expect(isCenterLockedForEnforcement(lockedRow, true, now)).toBe(true);
  });

  it('a paid center is open even when the policy is active', () => {
    expect(
      isCenterLockedForEnforcement({ billing_status: 'paid', next_payment_due: '2026-06-15' }, true, now),
    ).toBe(false);
  });
});
