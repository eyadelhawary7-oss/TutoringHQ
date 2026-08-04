import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeWhatsAppNumber, sendWhatsAppTemplate } from '@/lib/whatsapp';

/**
 * The confirmation the design's "Request sent" screen promises: "A confirmation
 * is on its way to your phone."
 *
 * Nothing sent anything to the requester before this — the route wrote the row,
 * alerted platform admins, and returned 201. Two real obstacles stood in the
 * way, and this is the single config point that closes both:
 *
 *  1. `wa_templates.center_id` is NOT NULL (verified in the live catalog), so
 *     that table cannot hold a platform-level template. The name therefore
 *     lives in `platform_config`, the existing key/value jsonb store.
 *  2. Meta rejects business-initiated `type: 'text'` messages to a number with
 *     no open 24-hour session, which is every public requester. So this posts a
 *     pre-approved template via `sendWhatsAppTemplate`.
 *
 * CONFIG POINT: `platform_config.privacy_request_confirmation_wa_template`, a
 * jsonb string holding an approved Meta template name. It ships unset. Going
 * live is one row edit and nothing else — no code change.
 *
 * FAILS VISIBLY, NEVER FALSELY. Unset key, missing credentials, or a non-OK
 * response all return `sent: false` with a reason. The caller returns
 * `confirmationSent: false` and the confirmation screen renders the truthful
 * email line instead of the phone line. The request itself is still recorded,
 * which is the legally material part.
 *
 * CAUTION worth carrying to whoever flips this on: the requester's phone is
 * unverified free text, so enabling this makes the endpoint send WhatsApp
 * messages to an attacker-supplied number. The 5/hour/IP limit on the route is
 * the only brake. Leave the key unset until Meta template approval and Adsero
 * have both settled.
 */
export const PRIVACY_REQUEST_CONFIRMATION_TEMPLATE_KEY =
  'privacy_request_confirmation_wa_template';

export type ConfirmationResult = {
  sent: boolean;
  /** Machine-readable reason, for Sentry. Never shown to the requester. */
  reason: 'sent' | 'template_not_configured' | 'send_failed' | 'config_read_failed';
};

/** Read the configured template name, or null when unset/blank/not a string. */
export async function getPrivacyConfirmationTemplateName(
  supabase: SupabaseClient,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('platform_config')
    .select('value')
    .eq('key', PRIVACY_REQUEST_CONFIRMATION_TEMPLATE_KEY)
    .maybeSingle();

  if (error) return null;
  const v = (data as { value?: unknown } | null)?.value;
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export async function sendPrivacyRequestConfirmation(
  supabase: SupabaseClient,
  phone: string,
  locale: string,
): Promise<ConfirmationResult> {
  let templateName: string | null;
  try {
    templateName = await getPrivacyConfirmationTemplateName(supabase);
  } catch {
    return { sent: false, reason: 'config_read_failed' };
  }

  if (!templateName) return { sent: false, reason: 'template_not_configured' };

  const languageCode = locale === 'ar' || locale.startsWith('ar-') ? 'ar' : 'en';
  const ok = await sendWhatsAppTemplate(
    normalizeWhatsAppNumber(phone),
    templateName,
    languageCode,
  );

  return ok ? { sent: true, reason: 'sent' } : { sent: false, reason: 'send_failed' };
}
