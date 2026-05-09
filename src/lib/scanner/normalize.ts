/**
 * Student number normalization for manual scanner entry.
 * Canonical display: STU- + 5 digits.
 */

const ARABIC_INDIC_START = 0x0660;
const EXTENDED_ARABIC_START = 0x06f0;

export function normalizeStudentNumber(input: string): string {
  let s = input.trim();
  if (!s) return '';

  s = s.replace(/^#+\s*/, '');

  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= ARABIC_INDIC_START && code <= ARABIC_INDIC_START + 9) {
      out += String(code - ARABIC_INDIC_START);
    } else if (code >= EXTENDED_ARABIC_START && code <= EXTENDED_ARABIC_START + 9) {
      out += String(code - EXTENDED_ARABIC_START);
    } else {
      out += ch;
    }
  }

  out = out.replace(/\s+/g, '').toUpperCase();

  const digitsOnly = out.replace(/\D/g, '');
  if (/^\d+$/.test(out) || (/^\d+$/.test(digitsOnly) && !out.includes('STU'))) {
    const pad = digitsOnly.padStart(5, '0').slice(-5);
    return `STU-${pad}`;
  }

  if (out.startsWith('STU-')) return out;
  return out;
}

export function isValidCanonicalStudentNumber(normalized: string): boolean {
  return /^STU-\d{5}$/.test(normalized);
}
