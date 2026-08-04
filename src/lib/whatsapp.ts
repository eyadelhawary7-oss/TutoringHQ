const WHATSAPP_API_URL = 'https://graph.facebook.com/v19.0';

export async function sendWhatsAppMessage(
  toPhone: string,
  message: string
): Promise<boolean> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    console.warn('[WhatsApp] Credentials not set, skipping message to', toPhone);
    return false;
  }

  try {
    const response = await fetch(`${WHATSAPP_API_URL}/${phoneNumberId}/messages`, {
      method: 'POST',
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: toPhone,
        type: 'text',
        text: { body: message },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[WhatsApp] Send failed:', JSON.stringify(data));
      return false;
    }

    return true;
  } catch (err) {
    console.error('[WhatsApp] Error:', err);
    return false;
  }
}

/**
 * Business-initiated send to a number with no open 24-hour session window.
 *
 * `sendWhatsAppMessage` above posts `type: 'text'`, which Meta rejects outside a
 * session window — so it cannot be used to reach someone who has never messaged
 * us, which is every public data-rights requester. This posts `type: 'template'`
 * against a template name that must already be approved in the Meta console.
 *
 * Returns `false` (never throws, never pretends) when credentials are missing or
 * Meta rejects the send, so callers can report the truth to the user instead of
 * claiming a message went out.
 */
export async function sendWhatsAppTemplate(
  toPhone: string,
  templateName: string,
  languageCode: string,
): Promise<boolean> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    console.warn('[WhatsApp] Credentials not set, skipping template to', toPhone);
    return false;
  }

  try {
    const response = await fetch(`${WHATSAPP_API_URL}/${phoneNumberId}/messages`, {
      method: 'POST',
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: toPhone,
        type: 'template',
        template: { name: templateName, language: { code: languageCode } },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[WhatsApp] Template send failed:', JSON.stringify(data));
      return false;
    }

    return true;
  } catch (err) {
    console.error('[WhatsApp] Template error:', err);
    return false;
  }
}

/**
 * Egyptian normalization: 01X → 201X (no + prefix for Meta Cloud API)
 */
export function normalizeWhatsAppNumber(phone: string): string {
  return phone
    .replace(/^\+/, '')
    .replace(/^0(\d{10})$/, '20$1');
}
