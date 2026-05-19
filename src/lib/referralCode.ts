/**
 * Client-side helpers for capturing a referral code with an explicit TTL.
 *
 * Without expiry, a code persists indefinitely and leaks attribution between
 * tenants on shared kiosks (Owner A's code applies to Owner B's signup).
 */

const STORAGE_KEY = 'referral_code';
const EXPIRY_KEY = 'referral_code_expires_at';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function setReferralCode(code: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, code);
    localStorage.setItem(EXPIRY_KEY, String(Date.now() + TTL_MS));
  } catch {
    /* ignore quota / private-mode errors */
  }
}

export function readReferralCode(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const code = localStorage.getItem(STORAGE_KEY);
    if (!code) return null;
    const expiresAt = Number(localStorage.getItem(EXPIRY_KEY) ?? 0);
    if (!expiresAt || Date.now() > expiresAt) {
      clearReferralCode();
      return null;
    }
    return code;
  } catch {
    return null;
  }
}

export function clearReferralCode(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(EXPIRY_KEY);
  } catch {
    /* ignore */
  }
}
