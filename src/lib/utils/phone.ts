import { CENTERHQ_LOCAL_SUFFIX } from '@/lib/ownerPhone';

// The reverse mapping (auth email -> phone digits) lives in ownerPhone.ts. It is
// re-exported here so callers have ONE import for the whole phone<->auth-email
// mapping and never re-implement the decode. Do not duplicate its logic.
export { phoneFromCenterhqAuthEmail } from '@/lib/ownerPhone';

/**
 * Normalize Egyptian phone numbers to E.164 format (+20XXXXXXXXX).
 *
 * THE single normalizer. Signup, login, OTP and every API share it, so that no
 * two surfaces can disagree about what a valid Egyptian number looks like. Do
 * not add a second one: the reason this function exists in this shape is that
 * `/signup` previously carried two of its own (a `toSignupIntlPhone` helper and
 * an inline block in the submit handler) which normalized the same input three
 * different ways and agreed only by luck.
 *
 * E.164 is the canonical form because `users.phone` — the auth identity table
 * that signup writes and login reads — is uniformly `+20…`, and the Supabase
 * auth email (`{digits}@centerhq.local`) derives from it.
 *
 * Handles:
 * - 01xx, 201xx, +201xx → +201xx
 * - 00201xx (international access prefix, what a phone dials from abroad) → +201xx
 * - Strips spaces, dashes, and other non-digits
 * - Already has +20 prefix → return as-is (normalized)
 * - Has 20 prefix without + → add +
 * - Starts with 0 → replace leading 0 with +20
 *
 * Egyptian mobile: 010, 011, 012, 015 (10 digits after 0)
 * Full format: +20 followed by 10 digits (without leading 0)
 * Example: 01234567890 → +201234567890
 */
export function normalizePhone(phone: string): string {
  if (!phone || typeof phone !== 'string') return '';

  // Remove all non-digit characters (keeps only 0-9)
  let digits = phone.replace(/\D/g, '');

  if (digits.length === 0) return '';

  // "00" is the international access prefix — 00201… is the same number as
  // +201…. Strip it FIRST, before the leading-zero rule below claims it and
  // produces +200201… (a number that then fails every validity check).
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
    if (digits.length === 0) return '';
  }

  // Has 20 prefix (e.g. "201234567890") → add + and return
  if (digits.startsWith('20') && digits.length >= 12) {
    return '+' + digits;
  }

  // Egyptian local format: starts with 0 (e.g. "01220601410")
  if (digits.startsWith('0') && digits.length >= 11) {
    return '+20' + digits.slice(1);
  }

  // 10 digits starting with 1 (e.g. "1220601410") - Egyptian mobile
  if (digits.length >= 10 && digits.startsWith('1')) {
    return '+20' + digits.slice(0, 10);
  }

  // Shorter input with 20 prefix (e.g. "2012...") - still normalize
  if (digits.startsWith('20')) {
    return '+' + digits;
  }

  // Fallback: prepend +20
  return '+20' + digits;
}

/** True when `normalized` is +20 followed by a valid Egyptian mobile (10, 11, 12, 15). */
export function isValidEgyptianMobileE164(normalized: string): boolean {
  return /^\+20(1[0125]\d{8})$/.test(normalized);
}

/**
 * Canonical phone-identity comparison. Normalizes BOTH sides to +20 E.164, then
 * compares the two canonical strings with `===`.
 *
 * This exists to kill the trailing-substring/`endsWith(x.slice(-10))`/last-N
 * family of bugs: two genuinely different numbers can share the last N digits
 * and falsely match, and `slice(-N)` on a too-short string returns the whole
 * string, so a short/garbage value "matches" everything. There is exactly one
 * correct way to know if two phones are the same human number — canonicalize
 * both and compare exactly — and this is it. No substring/last-N anywhere.
 *
 * FAILS CLOSED: if either side does not normalize to a valid Egyptian mobile
 * E.164, returns `false` (never match on invalid). Accepts null/undefined.
 */
export function phonesMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const na = normalizePhone(typeof a === 'string' ? a : '');
  const nb = normalizePhone(typeof b === 'string' ? b : '');
  if (!isValidEgyptianMobileE164(na) || !isValidEgyptianMobileE164(nb)) return false;
  return na === nb;
}

/**
 * The ONE Supabase-Auth email derivation: phone -> `<digits>@centerhq.local`
 * (canonical local-part = the E.164 digits WITHOUT the leading `+`, e.g.
 * `+201234567890` -> `201234567890@centerhq.local`).
 *
 * Normalizes the input first, so the login path and the signup path produce the
 * IDENTICAL local-part for the same human phone regardless of input form — which
 * is what keeps logins working. Returns `null` if the phone does not normalize
 * to a valid Egyptian mobile E.164; callers must surface their invalid-phone
 * error path rather than write a `null@centerhq.local` identity.
 */
export function authEmailFromPhone(phone: string | null | undefined): string | null {
  const e164 = normalizePhone(typeof phone === 'string' ? phone : '');
  if (!isValidEgyptianMobileE164(e164)) return null;
  return e164.replace(/^\+/, '') + CENTERHQ_LOCAL_SUFFIX;
}
