import { SITE } from '@/config/site';

/**
 * Public / internal WhatsApp routing.
 *
 * PUBLIC surfaces (signup, suspended, settings/support — and the marketing
 * footer, which reads `SITE` directly) get the support number from
 * `src/config/site.ts`. A constant cannot be unset, so a public page can never
 * render a blank column or a stale number again; changing the support line is
 * one edit in SITE. `NEXT_PUBLIC_SUPPORT_WHATSAPP` no longer feeds any public
 * link.
 *
 * SERVER alerts (cron, vendor failure) keep their env channel unchanged:
 * - ADMIN_WHATSAPP_NUMBER - optional; digits or E.164. Falls back to
 *   NEXT_PUBLIC_SUPPORT_WHATSAPP if unset.
 */

function digitsOnly(raw: string | undefined): string {
  return (raw ?? '').replace(/\D/g, '');
}

/** Digits for WhatsApp Cloud API `to` field on SERVER alert paths. */
export function getAdminOrSupportWhatsAppDigits(): string {
  const fromAdmin = digitsOnly(process.env.ADMIN_WHATSAPP_NUMBER);
  if (fromAdmin.length > 0) return fromAdmin;
  return digitsOnly(process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP);
}

/** `https://wa.me/<digits>` — always populated, from the SITE constant. */
export function getSupportWhatsAppWaMeBase(): string {
  return `https://wa.me/${SITE.supportWhatsAppIntl}`;
}

export function getSupportWhatsAppWaMeWithText(text: string): string {
  return `${getSupportWhatsAppWaMeBase()}?text=${encodeURIComponent(text)}`;
}

/** Human-readable label (e.g. "+20 106 4668885") for UI display. */
export function getSupportWhatsAppDisplayLabel(): string {
  return SITE.supportWhatsAppDisplay;
}
