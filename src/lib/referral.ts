/**
 * Referral code generation utility.
 * Format: XXXX-XXXX (4 latin chars from center name + 4 random alphanumeric)
 */
export function generateReferralCode(centerName: string): string {
  const latin = centerName
    .replace(/[\u0600-\u06FF]/g, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase()
    .slice(0, 4)
    .padEnd(4, 'CTRH');
  const suffix = Math.random().toString(36).toUpperCase().slice(2, 6);
  return `${latin}-${suffix}`;
}
