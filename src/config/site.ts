/**
 * Central public site configuration — single source of truth for PUBLIC,
 * non-secret values used across the app (marketing pages + authenticated app).
 *
 * HARD SECURITY RULE: PUBLIC values only. Everything here is safe to ship to
 * the browser. NEVER put secrets here — no API tokens, no WhatsApp Cloud API
 * token, no Paymob keys, no Supabase service-role keys, nothing the browser
 * must not see. Secrets belong in environment variables (server-only) and must
 * never be imported into this file.
 *
 * Change a value once here and it updates everywhere it is referenced.
 */
export const SITE = {
  /** Product / brand wordmark. */
  brandName: 'TutoringHQ',

  /** WhatsApp number in wa.me format — digits only, no '+' and no leading zero. */
  supportWhatsAppIntl: '201039646403',
  /** Human-readable WhatsApp number for display in UI. */
  supportWhatsAppDisplay: '+20 10 3964 6403',
  /** Pre-filled greeting used when opening the WhatsApp support deep link. */
  supportWhatsAppGreeting: 'السلام عليكم، حابب أعرف أكتر عن TutoringHQ',

  /** Public support inbox. */
  supportEmail: 'support@ehgintelligence.com',

  /** Legal/operating company name. */
  companyName: 'EHG Intelligence Egypt',

  /**
   * Primary/canonical public domain. Keep the cutover to a one-line change
   * here — canonical/og/sitemap/robots all derive from `SITE_URL` below.
   */
  domain: 'tutoringhq.app',

  /** Social profiles — empty placeholders to fill in later. */
  socials: {
    instagram: '',
    facebook: '',
    tiktok: '',
  },
} as const;

/**
 * Canonical public site origin (`https://<domain>`) — the single source for
 * SEO metadata (metadataBase, og:url, sitemap, robots, structured data).
 */
export const SITE_URL = `https://${SITE.domain}` as const;

/** `https://wa.me/<digits>?text=<greeting>` deep link from the public config. */
export function supportWhatsAppLink(): string {
  return `https://wa.me/${SITE.supportWhatsAppIntl}?text=${encodeURIComponent(
    SITE.supportWhatsAppGreeting,
  )}`;
}
