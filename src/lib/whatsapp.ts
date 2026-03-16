const WHATSAPP_API_URL = 'https://graph.facebook.com/v19.0';

export async function sendWhatsAppMessage(
  toPhone: string,
  message: string
): Promise<boolean> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    console.warn('[WhatsApp] Credentials not set — skipping message to', toPhone);
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

    console.log('[WhatsApp] Sent to', toPhone, '— message ID:', data.messages?.[0]?.id);
    return true;
  } catch (err) {
    console.error('[WhatsApp] Error:', err);
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
