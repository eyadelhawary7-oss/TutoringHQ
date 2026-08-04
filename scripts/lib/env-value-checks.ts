/**
 * Value-level env checks for `scripts/check-env.ts`.
 *
 * `check-env.ts` on its own only compares env NAMES: the `process.env.X`
 * references under `src/` against the keys in `.env.example`. That catches a
 * key nobody declared. It cannot catch a declared key whose VALUE is wrong,
 * and for `SUPER_ADMIN_PHONES` the value is the whole security boundary — it
 * is the env var that, on its own, confers full super-admin authority with no
 * `admin_users` row behind it (S10 in design/BUILD-AFTER-REDESIGN.md).
 *
 * Today `SUPER_ADMIN_PHONES=placeholder` in `.env.example` satisfies the name
 * check completely, so "set, unset, typo'd, or extended by one extra number"
 * all pass silently. This module is the value check that closes that.
 *
 * It deliberately reuses `normalizePhone` / `isValidEgyptianMobileE164` from
 * `src/lib/utils/phone.ts` — the SAME normalizer `isSuperAdminPhone()` uses at
 * runtime. A second phone parser here would be able to disagree with the gate
 * it is supposed to be checking, which is worse than no check at all.
 *
 * Pure functions only: no process.exit, no console, no env reads. The caller
 * decides what is fatal. That also makes it unit-testable.
 */
import { createHash } from 'crypto';
import { normalizePhone, isValidEgyptianMobileE164 } from '@/lib/utils/phone';

export type EnvIssue = {
  level: 'error' | 'warning';
  message: string;
};

export type SuperAdminPhonesEntry = {
  /** Exactly as written in the env var, trimmed. */
  raw: string;
  /** Canonical +20 E.164, or '' when the raw value does not normalize. */
  normalized: string;
  valid: boolean;
};

export type SuperAdminPhonesReport = {
  /**
   * True when no grant list is configured here at all — the variable is unset
   * or empty, OR it still holds the untouched `.env.example` stock literal.
   * Both mean the same thing operationally (nobody is granted) and neither is
   * an error. `notConfiguredReason` says which.
   */
  unset: boolean;
  /** Why `unset` is true. `null` when a real list is present. */
  notConfiguredReason: 'absent' | 'stock_placeholder' | null;
  entries: SuperAdminPhonesEntry[];
  /** Count of entries that normalize to a valid Egyptian mobile E.164. */
  validCount: number;
  /** Normalized values that appear more than once. */
  duplicates: string[];
  /**
   * Stable short digest of the sorted, de-duplicated, valid entries. Two runs
   * that print the same fingerprint are granting super-admin to the same set
   * of humans; a changed fingerprint means the grant list changed. Null when
   * there is nothing valid to fingerprint.
   */
  fingerprint: string | null;
  issues: EnvIssue[];
};

/** `+201234567890` -> `+2012*****90`. Enough to recognise, not enough to reuse. */
export function maskPhone(normalized: string): string {
  if (normalized.length <= 6) return normalized;
  const head = normalized.slice(0, 6);
  const tail = normalized.slice(-2);
  return head + '*'.repeat(normalized.length - head.length - tail.length) + tail;
}

/**
 * Stock "not configured yet" literals as they are actually written in
 * `.env.example`. `placeholder` is the dominant one — 20 of the file's keys
 * carry it, including SUPER_ADMIN_PHONES itself.
 *
 * These are whitelisted as NOT CONFIGURED rather than treated as typos. The
 * alternative was tried and is wrong: without this, `export`ing `.env.example`
 * into a shell makes `npm run check:env` exit non-zero on an unmodified repo
 * value, so the first thing a new developer sees is a red gate complaining
 * about a line nobody touched. That teaches people the gate is noise, which is
 * the opposite of what an authority-grant check is for. Every other variable
 * in that file tolerates its own stock value; this one now does too.
 *
 * The whitelist is exact-match on a WHOLE entry, so a real list is never
 * softened by it: `placeholder,+201234567890` is a half-finished edit, and the
 * `placeholder` entry there still errors on the normal path below.
 */
const STOCK_PLACEHOLDERS = new Set(['placeholder']);

/**
 * Validate a raw `SUPER_ADMIN_PHONES` value.
 *
 * Rules, and why each one is where it is:
 *  - unset/empty -> WARNING, not an error. No env-phone super-admins is the
 *    SAFE state and the direction S10 wants to travel in. It is reported
 *    loudly because it is also what a lost/blanked Vercel variable looks like,
 *    and the two are indistinguishable from here.
 *  - the untouched `.env.example` stock literal -> WARNING, same reasoning
 *    plus the whitelist note above. Operationally identical to unset: at
 *    runtime `isSuperAdminPhone('placeholder')` grants nobody anything.
 *  - an entry that does not normalize to a valid Egyptian mobile E.164 ->
 *    ERROR. This is the typo case, and at runtime `isSuperAdminPhone` matches
 *    it against nobody: the intended human silently has no authority.
 *  - a duplicate -> WARNING. It grants nothing extra, but it is the fingerprint
 *    of a botched edit to the list.
 */
export function checkSuperAdminPhones(raw: string | undefined | null): SuperAdminPhonesReport {
  const issues: EnvIssue[] = [];
  const text = typeof raw === 'string' ? raw : '';
  const parts = text.split(',').map((p) => p.trim()).filter(Boolean);

  if (parts.length === 0) {
    issues.push({
      level: 'warning',
      message:
        'SUPER_ADMIN_PHONES is unset or empty. No env-phone super-admin exists. ' +
        'That is the safe state, but it is also what a blanked Vercel variable ' +
        'looks like — confirm it is deliberate.',
    });
    return {
      unset: true,
      notConfiguredReason: 'absent',
      entries: [],
      validCount: 0,
      duplicates: [],
      fingerprint: null,
      issues,
    };
  }

  if (parts.every((p) => STOCK_PLACEHOLDERS.has(p.toLowerCase()))) {
    issues.push({
      level: 'warning',
      message:
        'SUPER_ADMIN_PHONES still holds the stock .env.example value ' +
        `("${parts.join(',')}"). Treated as NOT CONFIGURED, not as a typo: no ` +
        'env-phone super-admin exists, which is the safe state. If this is a ' +
        'real environment that is supposed to have one, the value was never set.',
    });
    return {
      unset: true,
      notConfiguredReason: 'stock_placeholder',
      entries: [],
      validCount: 0,
      duplicates: [],
      fingerprint: null,
      issues,
    };
  }

  const entries: SuperAdminPhonesEntry[] = parts.map((p) => {
    const normalized = normalizePhone(p);
    return { raw: p, normalized, valid: isValidEgyptianMobileE164(normalized) };
  });

  for (const e of entries) {
    if (!e.valid) {
      issues.push({
        level: 'error',
        message:
          `SUPER_ADMIN_PHONES entry "${e.raw}" does not normalize to a valid ` +
          'Egyptian mobile E.164 (+20 then 10, 11, 12 or 15). At runtime ' +
          'isSuperAdminPhone() logs it and matches it against nobody, so the ' +
          'person it was meant to authorise has no authority at all.',
      });
    }
  }

  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const e of entries) {
    if (!e.valid) continue;
    if (seen.has(e.normalized)) {
      if (!duplicates.includes(e.normalized)) duplicates.push(e.normalized);
    }
    seen.add(e.normalized);
  }
  for (const d of duplicates) {
    issues.push({
      level: 'warning',
      message:
        `SUPER_ADMIN_PHONES lists ${maskPhone(d)} more than once. It grants ` +
        'nothing extra, but a duplicate is usually a half-finished edit.',
    });
  }

  const unique = [...seen].sort();
  const fingerprint =
    unique.length > 0
      ? createHash('sha256').update(unique.join(',')).digest('hex').slice(0, 12)
      : null;

  return {
    unset: false,
    notConfiguredReason: null,
    entries,
    validCount: unique.length,
    duplicates,
    fingerprint,
    issues,
  };
}
