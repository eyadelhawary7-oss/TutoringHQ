/**
 * S10 (c): `SUPER_ADMIN_PHONES` is an authority grant that lives entirely in an
 * env var — it confers full super-admin with no `admin_users` row behind it —
 * and nothing warned when it was missing, typo'd or extended. `check-env.ts`
 * only ever compared env NAMES, which `SUPER_ADMIN_PHONES=placeholder` in
 * `.env.example` satisfies perfectly.
 *
 * These tests pin the value check that closes that. The property that matters
 * most is the last describe block: this validator must agree with
 * `isSuperAdminPhone()` about what a usable entry is, entry by entry. A
 * validator that disagreed with the gate would be worse than none — it would
 * bless a value the gate ignores.
 */
import { describe, it, expect } from 'vitest';
import { checkSuperAdminPhones, maskPhone } from '../../scripts/lib/env-value-checks';
import { isSuperAdminPhone } from '@/lib/admin-access';

describe('checkSuperAdminPhones — missing', () => {
  it('treats undefined as unset: a warning, not an error (no env-phone super-admin is the safe state)', () => {
    const r = checkSuperAdminPhones(undefined);
    expect(r.unset).toBe(true);
    expect(r.validCount).toBe(0);
    expect(r.fingerprint).toBeNull();
    expect(r.issues.map((i) => i.level)).toEqual(['warning']);
  });

  it('treats an empty string and a bare comma the same as unset', () => {
    for (const raw of ['', '   ', ',', ' , , ']) {
      const r = checkSuperAdminPhones(raw);
      expect(r.unset, `raw=${JSON.stringify(raw)}`).toBe(true);
      expect(r.issues.some((i) => i.level === 'error')).toBe(false);
    }
  });
});

describe('checkSuperAdminPhones — typos', () => {
  it('errors on a value that does not normalize to an Egyptian mobile', () => {
    const r = checkSuperAdminPhones('notaphone');
    expect(r.unset).toBe(false);
    expect(r.validCount).toBe(0);
    expect(r.issues.filter((i) => i.level === 'error')).toHaveLength(1);
    expect(r.issues[0]!.message).toContain('notaphone');
  });

  it('errors on the literal .env.example placeholder, which the name check accepts', () => {
    const r = checkSuperAdminPhones('placeholder');
    expect(r.issues.some((i) => i.level === 'error')).toBe(true);
  });

  it('errors on a wrong-length number (one digit short) while accepting its correct form', () => {
    expect(checkSuperAdminPhones('+2012345678').issues.some((i) => i.level === 'error')).toBe(true);
    expect(checkSuperAdminPhones('+201234567890').issues.some((i) => i.level === 'error')).toBe(false);
  });

  it('errors on a non-mobile prefix (+2013…) — 10/11/12/15 only', () => {
    expect(checkSuperAdminPhones('+201334567890').issues.some((i) => i.level === 'error')).toBe(true);
  });

  it('reports one error per bad entry and still keeps the good ones', () => {
    const r = checkSuperAdminPhones('+201234567890, oops, +2019, 01098765432');
    expect(r.issues.filter((i) => i.level === 'error')).toHaveLength(2);
    expect(r.validCount).toBe(2);
  });
});

describe('checkSuperAdminPhones — extension and drift', () => {
  it('counts grants, so appending a phone is visible in the output', () => {
    expect(checkSuperAdminPhones('+201234567890').validCount).toBe(1);
    expect(checkSuperAdminPhones('+201234567890,+201098765432').validCount).toBe(2);
  });

  it('fingerprint changes when a phone is appended', () => {
    const before = checkSuperAdminPhones('+201234567890').fingerprint;
    const after = checkSuperAdminPhones('+201234567890,+201098765432').fingerprint;
    expect(before).not.toBeNull();
    expect(after).not.toBe(before);
  });

  it('fingerprint is stable across ordering and input format — the same humans hash the same', () => {
    const a = checkSuperAdminPhones('+201234567890,+201098765432').fingerprint;
    const b = checkSuperAdminPhones('01098765432, 01234567890').fingerprint;
    expect(a).toBe(b);
  });

  it('warns (does not error) on a duplicate entry', () => {
    const r = checkSuperAdminPhones('+201234567890, 01234567890');
    expect(r.duplicates).toEqual(['+201234567890']);
    expect(r.validCount).toBe(1);
    expect(r.issues.filter((i) => i.level === 'error')).toHaveLength(0);
    expect(r.issues.filter((i) => i.level === 'warning')).toHaveLength(1);
  });
});

describe('maskPhone', () => {
  it('leaves enough to recognise and not enough to reuse', () => {
    expect(maskPhone('+201234567890')).toBe('+20123*****90');
  });

  it('does not throw on short input', () => {
    expect(maskPhone('+20')).toBe('+20');
  });
});

describe('the validator agrees with the runtime gate', () => {
  // The whole point: this check is only meaningful if "valid here" means
  // exactly "matchable by isSuperAdminPhone there". Both sides run the same
  // normalizer; this asserts that they cannot drift apart.
  const CASES = [
    '+201234567890',
    '01234567890',
    '00201234567890',
    '+201098765432',
    'notaphone',
    'placeholder',
    '+2012345678',
    '+201334567890',
    '',
  ];

  it('an entry the validator accepts is an entry the gate will match, and vice versa', () => {
    const PREV = process.env.SUPER_ADMIN_PHONES;
    try {
      for (const raw of CASES) {
        const report = checkSuperAdminPhones(raw);
        const validatorAccepts = !report.unset && report.validCount === 1;

        process.env.SUPER_ADMIN_PHONES = raw;
        // Feed the gate the canonical form of the same input; if the validator
        // says the entry is usable, the gate must match that human.
        const gateMatches = report.entries[0]
          ? isSuperAdminPhone(report.entries[0].normalized)
          : false;

        expect(gateMatches, `raw=${JSON.stringify(raw)}`).toBe(validatorAccepts);
      }
    } finally {
      process.env.SUPER_ADMIN_PHONES = PREV;
    }
  });
});
