/** Normalize user input to +20… for signup validation and APIs (Egypt mobile). */
export function toSignupIntlPhone(raw: string): string {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return trimmed.startsWith('+') ? trimmed : '';
  if (digits.startsWith('0')) return '+20' + digits.slice(1);
  if (digits.startsWith('20')) return '+' + digits;
  if (digits.length === 10 && /^1[0125]/.test(digits)) return '+20' + digits;
  return trimmed.startsWith('+') ? '+' + digits.replace(/^\+/, '') : '+' + digits;
}
