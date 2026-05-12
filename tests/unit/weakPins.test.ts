import { describe, it, expect } from 'vitest';
import { isWeakPin, WEAK_PINS } from '../../src/lib/weakPins';

describe('isWeakPin', () => {
  it('rejects sequential ascending patterns', () => {
    expect(isWeakPin('123456')).toBe(true);
    expect(isWeakPin('234567')).toBe(true);
  });

  it('rejects sequential descending patterns', () => {
    expect(isWeakPin('654321')).toBe(true);
    expect(isWeakPin('987654')).toBe(true);
  });

  it('rejects repeating digits', () => {
    expect(isWeakPin('111111')).toBe(true);
    expect(isWeakPin('000000')).toBe(true);
    expect(isWeakPin('999999')).toBe(true);
  });

  it('rejects non-numeric input', () => {
    expect(isWeakPin('abc123')).toBe(true);
    expect(isWeakPin('!@#$%^')).toBe(true);
  });

  it('rejects wrong-length input', () => {
    expect(isWeakPin('12345')).toBe(true);
    expect(isWeakPin('1234567')).toBe(true);
    expect(isWeakPin('')).toBe(true);
  });

  it('accepts a strong PIN not in the list', () => {
    expect(isWeakPin('739182')).toBe(false);
    expect(isWeakPin('428173')).toBe(false);
    expect(isWeakPin('517394')).toBe(false);
  });

  it('handles leading/trailing whitespace defensively', () => {
    expect(isWeakPin(' 123456 ')).toBe(true);
    expect(isWeakPin('  000000  ')).toBe(true);
  });

  it('WEAK_PINS set contains only 6-digit numeric strings', () => {
    for (const pin of WEAK_PINS) {
      expect(pin).toMatch(/^\d{6}$/);
    }
  });
});
