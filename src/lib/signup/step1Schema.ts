import { z } from 'zod';
import { normalizePhone, isValidEgyptianMobileE164 } from '@/lib/utils/phone';

const CITY_IDS = [
  'cairo',
  'giza',
  'alexandria',
  'sixth_october',
  'sheikh_zayed',
  'nasr_city',
  'new_cairo',
  'heliopolis',
  'maadi',
  'other',
] as const;

/**
 * Signup-only policy: refuse obvious junk (all zeros, or the same digit ten
 * times) even though it is a well-formed Egyptian mobile.
 *
 * Deliberately SEPARATE from `isValidEgyptianMobileE164`. That function answers
 * "is this a valid Egyptian number", and it must have exactly one answer across
 * the whole product. This function answers "will we open an account on it",
 * which is a different question and only signup asks it. Folding the two
 * together is what produced three disagreeing validators here in the first
 * place.
 */
function isAcceptableSignupNumber(normalized: string): boolean {
  const body = normalized.slice(3); // the 10 digits after "+20"
  if (/^0+$/.test(body)) return false;
  if (/^(\d)\1{9}$/.test(body)) return false;
  return true;
}

/** Step 1 - Egyptian mobile as +20… ; referral codes: see signupSchema (8 A–Z0–9). */
export const signupStep1Schema = z.object({
  phone: z
    .string()
    .transform((v) => normalizePhone(v))
    .refine((v) => isValidEgyptianMobileE164(v) && isAcceptableSignupNumber(v), {
      message: 'invalidPhone',
    }),
  email: z.union([z.literal(''), z.string().trim().email()]),
  centerName: z.string().trim().min(2).max(80),
  ownerName: z.string().trim().min(2).max(80),
  city: z.enum(CITY_IDS),
});

export type SignupStep1Values = z.infer<typeof signupStep1Schema>;
