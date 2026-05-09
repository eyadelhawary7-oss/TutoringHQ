import { z } from 'zod';
import { toSignupIntlPhone } from '@/lib/signup/phoneIntl';

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

function phoneDigitsOk(d: string): boolean {
  if (!/^\+20(10|11|12|15)\d{8}$/.test(d)) return false;
  const body = d.slice(3);
  if (/^0+$/.test(body)) return false;
  if (/^(\d)\1{9}$/.test(body)) return false;
  return true;
}

/** Step 1 — Egyptian mobile as +20… per regex; referral codes: see signupSchema (8 A–Z0–9). */
export const signupStep1Schema = z.object({
  phone: z
    .string()
    .transform((v) => toSignupIntlPhone(v))
    .refine((v) => phoneDigitsOk(v), { message: 'invalidPhone' }),
  email: z.union([z.literal(''), z.string().trim().email()]),
  centerName: z.string().trim().min(2).max(80),
  ownerName: z.string().trim().min(2).max(80),
  city: z.enum(CITY_IDS),
});

export type SignupStep1Values = z.infer<typeof signupStep1Schema>;
