import { createHash, randomInt } from 'crypto';
import { normalizePhone, isValidEgyptianMobileE164 } from '@/lib/utils/phone';

/**
 * Shared input parsing / hashing / masking for the public student
 * self-enrollment OTP flow (/api/join/[groupId]/send-otp + verify-otp).
 *
 * The enrollment_otps row only stores group_id + phone + code_hash, so the
 * student details are re-sent on verify (the client retains them through the
 * OTP step). Both routes parse identically via parseEnrollmentInput so the
 * derived payer phone - where the code is sent and the bills land - matches.
 */

export type EnrollmentInput = {
  studentName: string;
  studentPhone: string; // E.164
  payer: 'student' | 'parent';
  parentName: string | null;
  parentPhone: string | null; // E.164 when payer = parent
  /** The phone that receives the OTP / future bills. */
  payerPhone: string; // E.164
};

export type ParseResult =
  | { ok: true; value: EnrollmentInput }
  | { ok: false; code: string };

export function parseEnrollmentInput(body: unknown): ParseResult {
  const {
    studentName: rawName,
    studentMobile: rawMobile,
    payerType: rawPayer,
    parentName: rawParentName,
    parentMobile: rawParentMobile,
  } = (body ?? {}) as {
    studentName?: unknown;
    studentMobile?: unknown;
    payerType?: unknown;
    parentName?: unknown;
    parentMobile?: unknown;
  };

  const studentName = typeof rawName === 'string' ? rawName.trim() : '';
  if (studentName.length < 1 || studentName.length > 120) {
    return { ok: false, code: 'invalid_name' };
  }

  const studentPhone = normalizePhone(typeof rawMobile === 'string' ? rawMobile : '');
  if (!isValidEgyptianMobileE164(studentPhone)) {
    return { ok: false, code: 'invalid_phone' };
  }

  const payer = rawPayer === 'parent' ? 'parent' : rawPayer === 'student' ? 'student' : null;
  if (!payer) {
    return { ok: false, code: 'invalid_payer' };
  }

  let parentName: string | null = null;
  let parentPhone: string | null = null;
  if (payer === 'parent') {
    parentName = typeof rawParentName === 'string' ? rawParentName.trim() : '';
    if (parentName.length < 1 || parentName.length > 120) {
      return { ok: false, code: 'invalid_parent_name' };
    }
    parentPhone = normalizePhone(typeof rawParentMobile === 'string' ? rawParentMobile : '');
    if (!isValidEgyptianMobileE164(parentPhone)) {
      return { ok: false, code: 'invalid_parent_phone' };
    }
    if (parentPhone === studentPhone) {
      return { ok: false, code: 'parent_phone_same' };
    }
  }

  const payerPhone = payer === 'parent' ? (parentPhone as string) : studentPhone;

  return {
    ok: true,
    value: { studentName, studentPhone, payer, parentName, parentPhone, payerPhone },
  };
}

/** SHA-256 hex of the OTP code (codes are never stored in the clear). */
export function hashOtp(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/** Six-digit numeric OTP as a zero-padded string (crypto-random, unbiased). */
export function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** Mask an E.164 Egyptian number to local form: "010•••••789". */
export function maskPhone(e164: string): string {
  const local = e164.startsWith('+20') ? '0' + e164.slice(3) : e164;
  if (local.length < 7) return local;
  return `${local.slice(0, 3)}•••••${local.slice(-3)}`;
}
