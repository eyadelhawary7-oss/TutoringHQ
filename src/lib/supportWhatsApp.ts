/**
 * Public / internal WhatsApp routing - no hardcoded numbers in app code.
 *
 * Env checklist (Vercel + `.env.local`):
 * - NEXT_PUBLIC_SUPPORT_WHATSAPP - digits only (e.g. 201234567890), used for wa.me marketing & support links
 * - ADMIN_WHATSAPP_NUMBER - optional; digits or E.164; server alerts (cron, vendor failure). Falls back to NEXT_PUBLIC_SUPPORT_WHATSAPP if unset
 */

function digitsOnly(raw: string | undefined): string {
  return (raw ?? '').replace(/\D/g, '');
}

/** Digits for WhatsApp Cloud API `to` field and wa.me paths. */
export function getAdminOrSupportWhatsAppDigits(): string {
  const fromAdmin = digitsOnly(process.env.ADMIN_WHATSAPP_NUMBER);
  if (fromAdmin.length > 0) return fromAdmin;
  return digitsOnly(process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP);
}

/** `https://wa.me/<digits>` or empty string if not configured. */
export function getSupportWhatsAppWaMeBase(): string {
  const d = digitsOnly(process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP);
  return d ? `https://wa.me/${d}` : '';
}

export function getSupportWhatsAppWaMeWithText(text: string): string {
  const base = getSupportWhatsAppWaMeBase();
  return base ? `${base}?text=${encodeURIComponent(text)}` : '';
}

/** Human-readable label (e.g. +20 1XX XXX XXXX) for footer; empty if unset. */
export function getSupportWhatsAppDisplayLabel(): string {
  const d = digitsOnly(process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP);
  if (!d) return '';
  if (d.startsWith('20') && d.length >= 11) {
    const rest = d.slice(2);
    const a = rest.slice(0, 3);
    const b = rest.slice(3, 6);
    const c = rest.slice(6);
    return ['+20', a, b, c].filter(Boolean).join(' ');
  }
  return d.startsWith('+') ? d : `+${d}`;
}
