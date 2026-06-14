import { normalizePhone, isValidEgyptianMobileE164 } from '@/lib/utils/phone';
// Crypto + masking are identical to the student self-enrollment OTP flow, so we
// reuse them rather than fork a second copy (one source of truth for "how an OTP
// code is generated / hashed / masked").
import { generateOtp, hashOtp, maskPhone } from '@/lib/enrollmentOtp';

/**
 * Shared bits for the teacher-signup phone OTP (the WhatsApp live-number proof
 * added before account creation). Mirrors src/lib/enrollmentOtp.ts: same
 * generation, SHA-256 hashing, 10-minute expiry, and per-row attempts<5 cap.
 *
 * The teacher_signup_otps row stores only phone + code_hash (no PII), keyed by
 * the normalized E.164 phone. The signup route re-derives everything else from
 * its own validated body on verify.
 */

export { generateOtp, hashOtp, maskPhone };

/** OTP lifetime - 10 minutes, matching the enrollment flow. */
export const TEACHER_SIGNUP_OTP_TTL_MS = 10 * 60 * 1000;

/** Per-row brute-force ceiling - matches enrollment verify (attempts<5). */
export const TEACHER_SIGNUP_OTP_MAX_ATTEMPTS = 5;

/** webhook_outbox job type + Meta template for the signup OTP WhatsApp send. */
export const TEACHER_SIGNUP_OTP_JOB_TYPE = 'send_teacher_signup_otp_wa';
export const TEACHER_SIGNUP_OTP_TEMPLATE = 'chq_teacher_signup_otp';

export type PhoneParseResult =
  | { ok: true; phone: string; phoneDigits: string }
  | { ok: false; code: string };

/** Validate + normalize the signup phone to E.164 (Egyptian mobile). */
export function parseSignupPhone(rawPhone: unknown): PhoneParseResult {
  const phone = normalizePhone(typeof rawPhone === 'string' ? rawPhone : '');
  if (!isValidEgyptianMobileE164(phone)) {
    return { ok: false, code: 'INVALID_PHONE' };
  }
  return { ok: true, phone, phoneDigits: phone.replace(/\D/g, '') };
}

/**
 * Non-prod test bypass: when set, the send-otp route echoes the real generated
 * code back in its JSON response so dev/E2E can complete the flow without a live
 * WhatsApp send. Gated on VERCEL_ENV !== 'production' AND this flag - NEVER in
 * prod. The OTP itself is still real and still hash-verified; only its delivery
 * is short-circuited for testability.
 */
export function devOtpEchoEnabled(): boolean {
  return (
    process.env.VERCEL_ENV !== 'production' &&
    process.env.TEACHER_SIGNUP_OTP_TEST_ECHO === '1'
  );
}
