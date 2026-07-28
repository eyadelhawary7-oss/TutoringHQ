import { describe, it, expect } from 'vitest';
import { normalizePhone, isValidEgyptianMobileE164 } from '@/lib/utils/phone';
import { signupStep1Schema } from '@/lib/signup/step1Schema';

/**
 * Guards the single-normalizer rule.
 *
 * `/signup` used to carry three normalizers — `toSignupIntlPhone`, an inline
 * block in the submit handler, and this one via the APIs — which agreed by
 * luck rather than by construction and all mishandled the 00 international
 * prefix. These tests exist so a second one cannot quietly reappear.
 */

const CANONICAL = '+201004427318';

describe('normalizePhone → E.164', () => {
  it.each([
    ['local 0-prefix', '01004427318'],
    ['already E.164', '+201004427318'],
    ['country code, no plus', '201004427318'],
    ['international 00 prefix', '00201004427318'],
    ['00 prefix with spaces', '0020 100 442 7318'],
    ['E.164 with spaces', '+20 100 442 7318'],
    ['bare 10-digit', '1004427318'],
    ['local with spaces', '010 0442 7318'],
    ['mixed separators', '+2-010-044-273-18'],
  ])('%s → canonical', (_label, input) => {
    expect(normalizePhone(input)).toBe(CANONICAL);
  });

  it('accepts every Egyptian mobile prefix', () => {
    for (const p of ['10', '11', '12', '15']) {
      const normalized = normalizePhone(`0${p}04427318`);
      expect(normalized).toBe(`+20${p}04427318`);
      expect(isValidEgyptianMobileE164(normalized)).toBe(true);
    }
  });

  it('returns empty for empty or junk-only input', () => {
    expect(normalizePhone('')).toBe('');
    expect(normalizePhone('   ')).toBe('');
    expect(normalizePhone('abc')).toBe('');
    expect(normalizePhone('00')).toBe('');
  });

  it('is idempotent — normalizing twice changes nothing', () => {
    for (const input of ['01004427318', '00201004427318', '+20 100 442 7318']) {
      const once = normalizePhone(input);
      expect(normalizePhone(once)).toBe(once);
    }
  });
});

describe('signup step 1 and the shared validator agree', () => {
  const base = {
    email: '',
    centerName: 'Nile Prep Academy',
    ownerName: 'Aly Shady',
    city: 'nasr_city' as const,
  };

  it.each([
    '01004427318',
    '+201004427318',
    '201004427318',
    '00201004427318',
    '0020 100 442 7318',
    '+20 100 442 7318',
  ])('signup accepts %s and stores it canonically', (phone) => {
    const parsed = signupStep1Schema.safeParse({ ...base, phone });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.phone).toBe(CANONICAL);
  });

  it('every form signup accepts is also valid to the shared validator', () => {
    for (const phone of ['01004427318', '00201004427318', '+20 100 442 7318']) {
      const parsed = signupStep1Schema.safeParse({ ...base, phone });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(isValidEgyptianMobileE164(parsed.data.phone)).toBe(true);
      }
    }
  });

  it.each([
    ['landline', '0221234567'],
    ['too short', '0100442'],
    ['non-Egyptian mobile prefix', '01904427318'],
  ])('signup rejects %s', (_label, phone) => {
    expect(signupStep1Schema.safeParse({ ...base, phone }).success).toBe(false);
  });

  it('signup policy still refuses a repeated-digit number the format allows', () => {
    // Well-formed Egyptian mobile, refused at signup only. Unchanged behaviour:
    // the pre-existing `phoneDigitsOk` rejected the same value.
    const phone = '+201111111111';
    expect(isValidEgyptianMobileE164(phone)).toBe(true);
    expect(signupStep1Schema.safeParse({ ...base, phone }).success).toBe(false);

    // Not junk by that rule, and never was: the body is 1 then nine zeros,
    // which is neither all-zeros nor all-one-digit. Pinned so the policy is
    // not "tightened" later without someone deciding to.
    const allowed = '+201000000000';
    expect(signupStep1Schema.safeParse({ ...base, phone: allowed }).success).toBe(true);
  });
});
