import { describe, it, expect } from 'vitest';
import {
  parseSummerConfig,
  summerModeActive,
  firstChargeAllowed,
  SUMMER_CONFIG_DEFAULTS,
  SUMMER_ENABLED_KEY,
  SUMMER_FREE_UNTIL_KEY,
  SUMMER_FIRST_CHARGE_FLOOR_KEY,
  SUMMER_TRIAL_DAYS_KEY,
  SUMMER_PAY_WINDOW_DAYS_KEY,
  SUMMER_FIRST_CHARGE_RELEASE_KEY,
} from '@/lib/summer/config';
import { summerBannerPhase } from '@/lib/summer/phase';

describe('parseSummerConfig', () => {
  it('falls back to defaults on an empty map', () => {
    expect(parseSummerConfig({})).toEqual(SUMMER_CONFIG_DEFAULTS);
  });

  it('parses booleans, dates, ints, and the release flag (incl. string forms)', () => {
    const cfg = parseSummerConfig({
      [SUMMER_ENABLED_KEY]: true,
      [SUMMER_FREE_UNTIL_KEY]: '2026-08-16',
      [SUMMER_FIRST_CHARGE_FLOOR_KEY]: '2026-08-30',
      [SUMMER_TRIAL_DAYS_KEY]: '14',
      [SUMMER_PAY_WINDOW_DAYS_KEY]: 2,
      [SUMMER_FIRST_CHARGE_RELEASE_KEY]: 'released',
    });
    expect(cfg).toEqual({
      enabled: true,
      freeUntil: '2026-08-16',
      firstChargeFloor: '2026-08-30',
      trialDays: 14,
      payWindowDays: 2,
      firstChargeRelease: 'RELEASED',
    });
  });

  it('rejects malformed dates and clamps invalid numbers', () => {
    const cfg = parseSummerConfig({
      [SUMMER_FREE_UNTIL_KEY]: 'not-a-date',
      [SUMMER_PAY_WINDOW_DAYS_KEY]: 0, // min 1
      [SUMMER_TRIAL_DAYS_KEY]: -5, // min 0
      [SUMMER_FIRST_CHARGE_RELEASE_KEY]: 'bogus',
    });
    expect(cfg.freeUntil).toBe(SUMMER_CONFIG_DEFAULTS.freeUntil);
    expect(cfg.payWindowDays).toBe(1);
    expect(cfg.trialDays).toBe(0);
    expect(cfg.firstChargeRelease).toBe('HELD');
  });
});

describe('summer gate — master switch + HELD/RELEASED', () => {
  const base = { ...SUMMER_CONFIG_DEFAULTS };

  it('summerModeActive only when the master switch is on', () => {
    expect(summerModeActive({ ...base, enabled: false })).toBe(false);
    expect(summerModeActive({ ...base, enabled: true })).toBe(true);
  });

  it('firstChargeAllowed requires master switch ON and release RELEASED', () => {
    expect(firstChargeAllowed({ ...base, enabled: true, firstChargeRelease: 'HELD' })).toBe(false);
    expect(firstChargeAllowed({ ...base, enabled: false, firstChargeRelease: 'RELEASED' })).toBe(false);
    expect(firstChargeAllowed({ ...base, enabled: true, firstChargeRelease: 'RELEASED' })).toBe(true);
  });

  it('default config holds the first charge (no money until explicitly released)', () => {
    expect(firstChargeAllowed(SUMMER_CONFIG_DEFAULTS)).toBe(false);
  });
});

describe('summerBannerPhase — never empty, switches at SUMMER_FREE_UNTIL', () => {
  it('phase1 before Aug 16, phase2 on/after (evergreen)', () => {
    expect(summerBannerPhase('2026-08-16', '2026-07-01')).toBe('phase1');
    expect(summerBannerPhase('2026-08-16', '2026-08-15')).toBe('phase1');
    expect(summerBannerPhase('2026-08-16', '2026-08-16')).toBe('phase2');
    expect(summerBannerPhase('2026-08-16', '2027-01-01')).toBe('phase2');
  });
});
