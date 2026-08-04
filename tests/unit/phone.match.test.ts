import { describe, it, expect } from 'vitest';
import {
  phonesMatch,
  authEmailFromPhone,
  phoneFromCenterhqAuthEmail,
  normalizePhone,
} from '@/lib/utils/phone';

/**
 * Canonical phone-identity comparison + the ONE auth-email derivation.
 *
 * These lock in the fix for the trailing-substring / last-N / `endsWith(slice(-10))`
 * defect: identity is decided by normalizing BOTH sides to +20 E.164 and comparing
 * EXACTLY — never by a shared digit tail, which lets two different numbers collide
 * and (because `slice(-N)` returns the whole string when the input is shorter than
 * N) lets short/garbage input match everything.
 */

const CANONICAL = '+201234567890';
const LOCAL = '01234567890';
const CC_NO_PLUS = '201234567890';

describe('phonesMatch — equal numbers in any input form match', () => {
  it('matches +E.164, local 0-prefix, and country-code-no-plus forms pairwise', () => {
    // Sanity: all three inputs are the same human number.
    expect(normalizePhone(CANONICAL)).toBe(CANONICAL);
    expect(normalizePhone(LOCAL)).toBe(CANONICAL);
    expect(normalizePhone(CC_NO_PLUS)).toBe(CANONICAL);

    expect(phonesMatch(CANONICAL, LOCAL)).toBe(true);
    expect(phonesMatch(LOCAL, CC_NO_PLUS)).toBe(true);
    expect(phonesMatch(CC_NO_PLUS, CANONICAL)).toBe(true);
    // Whitespace / separators must not defeat equality.
    expect(phonesMatch('+20 123 456 7890', '0123-456-7890')).toBe(true);
    // International 00 access prefix is the same number.
    expect(phonesMatch('00201234567890', CANONICAL)).toBe(true);
  });
});

describe('phonesMatch — different numbers do NOT match (the defect)', () => {
  it('two different numbers that share the last 10 digits do not match', () => {
    // '1234567890' is the trailing 10 digits of both a valid Egyptian number and
    // a longer/foreign number. A last-10 `endsWith` compare would falsely match;
    // canonical compare must not.
    expect(phonesMatch(CANONICAL, '+9991234567890')).toBe(false);
    expect(phonesMatch(CC_NO_PLUS, '9991234567890')).toBe(false);
    expect(phonesMatch(LOCAL, '00991234567890')).toBe(false);
  });

  it('two genuinely different valid Egyptian mobiles do not match', () => {
    expect(phonesMatch('+201234567890', '+201234567891')).toBe(false);
    expect(phonesMatch('01000000000', '01100000000')).toBe(false);
  });
});

describe('phonesMatch — short/garbage never matches and never throws', () => {
  it('returns false for empty, short, and non-numeric input without throwing', () => {
    expect(() => phonesMatch('123', '123')).not.toThrow();
    expect(phonesMatch('123', '123')).toBe(false); // too short to be a valid mobile
    expect(phonesMatch('abc', 'abc')).toBe(false);
    expect(phonesMatch('', '')).toBe(false);
    expect(phonesMatch('', CANONICAL)).toBe(false);
    expect(phonesMatch(CANONICAL, '')).toBe(false);
    expect(phonesMatch(null, null)).toBe(false);
    expect(phonesMatch(undefined, CANONICAL)).toBe(false);
    expect(phonesMatch(CANONICAL, undefined)).toBe(false);
    // A valid number never matches invalid junk, even if junk normalizes oddly.
    expect(phonesMatch(CANONICAL, '00')).toBe(false);
    expect(phonesMatch(CANONICAL, '+20')).toBe(false);
  });

  it('landline / wrong-prefix Egyptian numbers are not valid mobiles and do not match', () => {
    // 02 landline and 019 (non-existent mobile prefix) must fail closed.
    expect(phonesMatch('0221234567', '0221234567')).toBe(false);
    expect(phonesMatch('01912345678', '01912345678')).toBe(false);
  });
});

describe('authEmailFromPhone — the ONE auth-email derivation', () => {
  it('produces <digits>@centerhq.local (digits WITHOUT the plus)', () => {
    expect(authEmailFromPhone(CANONICAL)).toBe('201234567890@centerhq.local');
    expect(authEmailFromPhone(LOCAL)).toBe('201234567890@centerhq.local');
    expect(authEmailFromPhone(CC_NO_PLUS)).toBe('201234567890@centerhq.local');
  });

  it('is form-independent: login-path and signup-path inputs yield the identical local-part', () => {
    // This equality is what keeps logins working across signup/login/provision.
    const a = authEmailFromPhone(LOCAL);
    const b = authEmailFromPhone(CANONICAL);
    const c = authEmailFromPhone('00201234567890');
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(a).not.toBeNull();
  });

  it('returns null on invalid / short / garbage / empty input', () => {
    expect(authEmailFromPhone('abc')).toBeNull();
    expect(authEmailFromPhone('123')).toBeNull();
    expect(authEmailFromPhone('')).toBeNull();
    expect(authEmailFromPhone('   ')).toBeNull();
    expect(authEmailFromPhone(null)).toBeNull();
    expect(authEmailFromPhone(undefined)).toBeNull();
    expect(authEmailFromPhone('0221234567')).toBeNull(); // landline, not a mobile
    expect(authEmailFromPhone('+9991234567890')).toBeNull(); // foreign / invalid
  });

  it('round-trips with the shared decode (phoneFromCenterhqAuthEmail)', () => {
    const email = authEmailFromPhone(CANONICAL);
    expect(email).toBe('201234567890@centerhq.local');
    const digits = phoneFromCenterhqAuthEmail(email);
    expect(digits).toBe('201234567890');
    expect(normalizePhone(digits ?? '')).toBe(CANONICAL);
  });
});
