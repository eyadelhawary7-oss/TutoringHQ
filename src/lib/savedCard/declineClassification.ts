/**
 * Phase 2 (2c) — classify a Paymob decline so the midnight engine knows whether
 * to retry, or to stop and route the customer to the manual / OTP fallback.
 *
 * Egyptian banks (CIB, Banque Misr, NBE, QNB, …) frequently REFUSE an
 * unauthenticated recurring (MIT) charge that skips the OTP. That refusal must
 * NOT be retried — it will keep bouncing — it goes straight to the OTP fallback
 * (a manual one-tap payment link). Only genuinely transient declines retry.
 *
 *   'auth_required'  — bank wants OTP / 3DS on the MIT (or an ambiguous refusal).
 *                      → OTP fallback. NEVER silently retry.
 *   'hard_final'     — card unusable (stolen / lost / expired / invalid / closed).
 *                      → manual fallback; needs a new card. NEVER retry.
 *   'soft_retryable' — transient (insufficient funds, issuer/system blip, timeout).
 *                      → eligible for the capped retry schedule.
 *
 * Unknown codes default to 'auth_required' (fallback, no retry) — the safe choice
 * for MIT, since the dominant unknown case here IS the bank's OTP refusal.
 */

export type DeclineKind = 'auth_required' | 'soft_retryable' | 'hard_final';

export interface PaymobDeclineInput {
  /** Paymob/issuer response code (txn_response_code / acq response code). */
  code?: string | null;
  /** Human-readable decline message from Paymob. */
  message?: string | null;
}

// ISO-8583-style issuer codes that mean the card itself is unusable.
const HARD_FINAL_CODES = new Set([
  '04', '07', '14', '15', '41', '43', '46', '54', '57', '62', '78', 'R0', 'R1', 'R3',
]);

// Codes that are transient and safe to retry later.
const SOFT_CODES = new Set([
  '51', '61', '65', '75', '91', '92', '96', '98', 'N7',
]);

export function classifyPaymobDecline(input: PaymobDeclineInput): DeclineKind {
  const code = String(input.code ?? '').trim().toUpperCase();
  const msg = String(input.message ?? '').toLowerCase();

  // Auth / 3DS / OTP required (or the bank's catch-all "do not honour" refusal of
  // an unauthenticated MIT) → manual OTP fallback, never silent-retry.
  if (
    /(3ds|3-d|three.?d|\botp\b|authenticat|secure\b|not honou?r)/.test(msg) ||
    code === '3DS' ||
    code === 'AUTHENTICATION_REQUIRED' ||
    code === '05'
  ) {
    return 'auth_required';
  }

  // Card unusable → manual fallback, needs a new card. Never retry.
  if (
    HARD_FINAL_CODES.has(code) ||
    /(stolen|lost|pick.?up|expired|invalid card|closed account|revoked|restricted)/.test(msg)
  ) {
    return 'hard_final';
  }

  // Transient → eligible for the capped retry schedule.
  if (
    SOFT_CODES.has(code) ||
    /(insufficient|limit exceed|try again|temporar|issuer (unavailable|inoperative)|timeout|unavailable|system (error|malfunction))/.test(msg)
  ) {
    return 'soft_retryable';
  }

  // Unknown → safest is the manual fallback (no blind MIT retries).
  return 'auth_required';
}
