import { describe, expect, it } from 'vitest';
import {
  formatCurrency,
  formatPercent,
  formatGrowth,
  formatNumber,
} from '@/lib/formatNumber';

describe('formatCurrency', () => {
  it('uses NBSP and suffix order for en', () => {
    expect(formatCurrency(1234, 'en')).toBe(`1,234${'\u00A0'}EGP`);
  });
});

describe('formatPercent', () => {
  it('does not emit U+061C for ar', () => {
    const s = formatPercent(15, 'ar');
    expect(s.includes('\u061C')).toBe(false);
  });
});

describe('formatGrowth', () => {
  it('returns null when prior is 0', () => {
    expect(formatGrowth(50, 0, 'en')).toBeNull();
  });
  it('returns minus 100.0% when current is 0 and prior positive', () => {
    expect(formatGrowth(0, 50, 'en')).toBe(`${'\u2212'}100.0%`);
  });
});

describe('formatNumber integerOnly', () => {
  it('rounds to integer display', () => {
    expect(formatNumber(849.917, 'en', { integerOnly: true })).toBe('850');
  });
});
